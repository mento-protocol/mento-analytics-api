import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STABLE_TOKEN_FIAT_MAPPING } from '@mento-protocol/mento-sdk';

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
  private readonly baseUrl: string;

  private ratesCache: Record<string, number> | null = null;
  private lastFetchTimestamp: number = 0;
  private readonly CACHE_DURATION = 1000 * 60 * 5; // 5 minutes
  private fiatSymbols: string[] = [];

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('EXCHANGE_RATES_API_KEY');
    this.baseUrl = this.configService.get<string>('EXCHANGE_RATES_API_URL');

    // Get all the fiat symbols from the sdk
    this.fiatSymbols = Object.values(STABLE_TOKEN_FIAT_MAPPING);
  }

  private async fetchRates(): Promise<Record<string, number>> {
    const now = Date.now();
    if (this.ratesCache && now - this.lastFetchTimestamp < this.CACHE_DURATION) {
      return this.ratesCache;
    }
    try {
      const requestUrl = new URL(this.baseUrl);
      requestUrl.pathname = '/latest';
      requestUrl.searchParams.set('base', 'USD');
      requestUrl.searchParams.set('symbols', this.fiatSymbols.join(','));
      requestUrl.searchParams.set('access_key', this.apiKey);

      const response = await fetch(requestUrl.toString());
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
