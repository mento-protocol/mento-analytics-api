import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { withRetry } from '@/utils';
import { RateLimiter } from 'limiter';
import * as Sentry from '@sentry/nestjs';
interface CMCQuote {
  data?: Record<
    string,
    {
      symbol: string;
      quote: {
        USD: {
          price: number;
          last_updated: string;
        };
      };
    }
  >;
  status: {
    error_code: number;
    error_message: string;
  };
}

@Injectable()
export class PriceFetcherService {
  private readonly logger = new Logger(PriceFetcherService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  private readonly priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly pendingRequests: Map<string, Promise<number>> = new Map();

  // Rate limiter: 30 requests per minute - In line with CMC basic tier :(
  private readonly rateLimiter = new RateLimiter({
    tokensPerInterval: 30,
    interval: 'minute',
  });

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('COINMARKETCAP_API_KEY');
    if (!this.apiKey) {
      throw new Error('COINMARKETCAP_API_KEY is not defined in environment variables');
    }

    this.baseUrl = this.configService.get<string>('COINMARKETCAP_API_URL');
    if (!this.baseUrl) {
      throw new Error('COINMARKETCAP_API_URL is not defined in environment variables');
    }
  }

  async getPrice(symbol: string): Promise<number> {
    // Check if there's already a pending request for this symbol
    const pending = this.pendingRequests.get(symbol);
    if (pending) {
      return pending;
    }

    // Create a new request promise and store it
    const requestPromise = (async () => {
      try {
        // First attempt to get fresh price data
        const price = await this.fetchFreshPrice(symbol);
        return price;
      } catch (error) {
        // If fresh price fetch fails, try to get from cache
        const cachedPrice = await this.priceCache.get(symbol);
        if (cachedPrice) {
          const ageInHours = (Date.now() - cachedPrice.timestamp) / (1000 * 60 * 60);
          this.logger.warn(
            `Failed to fetch fresh price for ${symbol}, using ${ageInHours} hours old cached price: ${cachedPrice.price}`,
          );
          return cachedPrice.price;
        }

        // If no cached price exists, rethrow the error
        this.logger.error(error, `Failed to fetch price for ${symbol} and no cached price available`);
        throw error;
      } finally {
        // Clean up the pending request
        this.pendingRequests.delete(symbol);
      }
    })();

    // Store the promise
    this.pendingRequests.set(symbol, requestPromise);
    return requestPromise;
  }

  private async fetchFreshPrice(symbol: string): Promise<number> {
    const retryOptions = {
      maxRetries: 5,
      baseDelay: 10000,
    };

    const price = await withRetry(
      async () => this.fetchCMCPrice(symbol),
      `Failed to fetch price for ${symbol}`,
      retryOptions,
    );

    // Cache the successfully fetched price
    this.priceCache.set(symbol, {
      price,
      timestamp: Date.now(),
    });
    return price;
  }

  private async fetchCMCPrice(symbol: string): Promise<number> {
    await this.rateLimiter.removeTokens(1);

    const requestUrl = new URL(`${this.baseUrl}/cryptocurrency/quotes/latest`);
    requestUrl.searchParams.set('symbol', symbol);

    const response = await fetch(requestUrl.toString(), {
      headers: {
        'X-CMC_PRO_API_KEY': this.apiKey,
        Accept: 'application/json',
      },
    });

    const data = (await response.json()) as CMCQuote;

    if (data.status.error_code !== 0) {
      const errorMessage = `CoinmarketCap API error: ${data.status.error_message}`;
      const errorContext = {
        error_code: data.status.error_code,
        error_message: data.status.error_message,
      };

      this.logger.error({ ...errorContext }, errorMessage);
      Sentry.captureException(new Error(errorMessage), {
        level: 'error',
        extra: {
          ...errorContext,
          description: errorMessage,
        },
      });
      throw new Error(errorMessage);
    }

    const tokenData = Object.values(data.data || {}).find((token) => token.symbol.toUpperCase() === symbol);

    if (!tokenData) {
      throw new Error(`Price not found for symbol: ${symbol}`);
    }

    const price = tokenData.quote.USD.price;

    return price;
  }
}
