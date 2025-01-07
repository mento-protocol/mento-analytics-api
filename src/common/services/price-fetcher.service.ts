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
  private readonly CACHE_DURATION = 15 * 60 * 1000;
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
    const normalizedSymbol = symbol.toUpperCase();

    const cached = this.priceCache.get(normalizedSymbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.price;
    }

    const pending = this.pendingRequests.get(normalizedSymbol);
    if (pending) {
      return pending;
    }

    const pricePromise = this.fetchPriceWithRetry(normalizedSymbol);
    this.pendingRequests.set(normalizedSymbol, pricePromise);

    try {
      const price = await pricePromise;
      this.pendingRequests.delete(normalizedSymbol);
      return price;
    } catch (error) {
      this.pendingRequests.delete(normalizedSymbol);
      throw error;
    }
  }

  private async fetchPriceWithRetry(symbol: string): Promise<number> {
    return withRetry(
      async () => {
        const price = await this.fetchPrice(symbol);
        return price;
      },
      `Failed to fetch price for ${symbol}`,
      {
        maxRetries: 5,
        baseDelay: 10000,
      },
    );
  }

  private async fetchPrice(symbol: string): Promise<number> {
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

    // Update cache
    this.priceCache.set(symbol, {
      price,
      timestamp: Date.now(),
    });

    return price;
  }
}
