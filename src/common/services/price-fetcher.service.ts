import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface CMCQuote {
  data?: Record<
    string,
    {
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
      // Check cache first
      const cached = this.priceCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
        return cached.price;
      }

      const response = await fetch(
        `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbol}`,
        {
          headers: {
            'X-CMC_PRO_API_KEY': this.apiKey,
            Accept: 'application/json',
          },
        },
      );

      const data = (await response.json()) as CMCQuote;

      if (!data.data?.[symbol]) {
        throw new Error(data.status.error_message || `Price not found for ${symbol}`);
      }

      const price = data.data[symbol].quote.USD.price;

      // Update cache
      this.priceCache.set(symbol, {
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