import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ExchangeRatesResponse {
  success: boolean;
  rates: Record<string, number>;
  date: string;
  error?: {
    code: number;
    message: string;
  };
}

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private readonly apiKey: string;
  private ratesCache: Record<string, number> | null = null;
  private lastFetchTimestamp: number = 0;
  private readonly CACHE_DURATION = 1000 * 60 * 5; // 5 minutes

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('EXCHANGE_RATE_API');
  }

  private async fetchRates(): Promise<Record<string, number>> {
    const now = Date.now();
    if (this.ratesCache && now - this.lastFetchTimestamp < this.CACHE_DURATION) {
      return this.ratesCache;
    }

    // TODO: This api supports an additional symbols param to reduce bandwith. We should use this and add
    //       the supported fiat currencies to the url.
    //       e.g. curl --request GET 'https://api.apilayer.com/exchangerates_data/live?base=USD&symbols=EUR,GBP' \
    //      --header 'apikey: YOUR API KEY'
    //      Fiat currencies we support can be fetched from the sdk stablecoins endpoint.
    //      May be better to make the hard coded mapping public to reduce network calls.

    try {
      // TODO: We have hardcoded URLS littered all over the place. We should refactor so these are not being hardcoded..
      //       Something like this:
      //  export const API_CONFIG = {
      //   exchangeRates: {
      //     baseUrl: process.env.EXCHANGE_RATES_API_URL || 'https://api.exchangeratesapi.io/v1',
      //     endpoints: {
      //       latest: '/latest',
      //     },
      //   },
      // };
      const response = await fetch(`https://api.exchangeratesapi.io/v1/latest?base=USD&access_key=${this.apiKey}`);
      const data: ExchangeRatesResponse = await response.json();

      if (data.error) {
        this.logger.warn('Exchange rates API error', data.error);
        throw new Error(data.error.message);
      }

      this.ratesCache = data.rates;
      this.lastFetchTimestamp = now;
      return data.rates;
    } catch (error) {
      this.logger.error('Failed to fetch exchange rates', error);
      throw error;
    }
  }

  async getRate(currency: string): Promise<number> {
    const rates = await this.fetchRates();
    const rate = rates[currency.toUpperCase()];

    if (rate === undefined) {
      throw new Error(`Exchange rate not found for currency: ${currency}`);
    }

    return rate;
  }

  async convert(amount: number, from: string, to: string): Promise<number> {
    const rates = await this.fetchRates();
    const fromRate = rates[from.toUpperCase()];
    const toRate = rates[to.toUpperCase()];

    if (fromRate === undefined || toRate === undefined) {
      throw new Error(`Exchange rate not found for conversion ${from} to ${to}`);
    }

    // Convert to USD first, then to target currency
    const usdAmount = amount / fromRate;
    return usdAmount * toRate;
  }
}
