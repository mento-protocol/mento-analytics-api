import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  private readonly priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('COINMARKETCAP_KEY');
    if (!this.apiKey) {
      throw new Error('COINMARKETCAP_KEY is not defined in environment variables');
    }
  }

  async getPrice(symbol: string): Promise<number> {
    try {
      const normalizedSymbol = symbol.toUpperCase();

      // Check cache first
      const cached = this.priceCache.get(normalizedSymbol);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.price;
      }

      const requestUrl = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${normalizedSymbol}`;

      const response = await fetch(requestUrl, {
        headers: {
          'X-CMC_PRO_API_KEY': this.apiKey,
          Accept: 'application/json',
        },
      });

      const data = (await response.json()) as CMCQuote;

      if (data.status.error_code !== 0) {
        this.logger.error(`Request url: ${requestUrl} returned error: ${data.status.error_message}`);
        throw new Error(data.status.error_message || `Failed to fetch price for ${symbol} from CoinMarketCap API`);
      }

      const tokenData = Object.values(data.data || {}).find((token) => token.symbol.toUpperCase() === normalizedSymbol);

      if (!tokenData) {
        this.logger.error(`No data found for symbol ${normalizedSymbol} in CoinMarketCap API response`);
        throw new Error(`Price not found for ${symbol} in CoinMarketCap API response`);
      }

      const price = tokenData.quote.USD.price;

      // Update cache
      this.priceCache.set(normalizedSymbol, {
        price,
        timestamp: Date.now(),
      });

      return price;
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${symbol}:`, error);
      throw error;
    }
  }
}
