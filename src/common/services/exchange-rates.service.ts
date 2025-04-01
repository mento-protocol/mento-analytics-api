import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { withRetry } from '@/utils';
import { STABLE_TOKEN_FIAT_MAPPING } from '@common/constants';

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
  private readonly CACHE_DURATION = 1000 * 60 * 60 * 6; // 6 hours
  private fiatSymbols: string[] = [];

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('EXCHANGE_RATES_API_KEY');
    if (!this.apiKey) {
      throw new Error('EXCHANGE_RATES_API_KEY is not defined in environment variables');
    }
    this.baseUrl = this.configService.get<string>('EXCHANGE_RATES_API_URL');
    if (!this.baseUrl) {
      throw new Error('EXCHANGE_RATES_API_URL is not defined in environment variables');
    }

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
        const errorMessage = `Exchange rates API error: ${data.error.message}`;
        const errorContext = {
          error_code: data.error.code,
          error_message: data.error.message,
        };
        this.logger.warn(errorContext, errorMessage);
        throw new Error(errorMessage);
      }

      this.ratesCache = data.rates;
      this.lastFetchTimestamp = now;
      return data.rates;
    } catch (error) {
      const errorMessage = 'Failed to fetch exchange rates';
      this.logger.error(error, errorMessage);
      Sentry.captureException(error, {
        level: 'error',
        extra: {
          description: errorMessage,
        },
      });
      throw error;
    }
  }

  async getRate(currency: string): Promise<number> {
    const rates = await withRetry(async () => await this.fetchRates(), 'Failed to fetch exchange rates', {
      maxRetries: 3,
      baseDelay: 5000,
    });

    const rate = rates[currency.toUpperCase()];

    if (rate === undefined) {
      const errorMessage = `Exchange rate not found for currency: ${currency}`;
      this.logger.error(errorMessage);
      Sentry.captureException(new Error(errorMessage), {
        level: 'error',
        extra: {
          description: errorMessage,
        },
      });
      throw new Error(errorMessage);
    }

    return rate;
  }

  async convert(amount: number, from: string, to: string): Promise<number> {
    const rates = await withRetry(async () => await this.fetchRates(), 'Failed to fetch exchange rates', {
      maxRetries: 3,
      baseDelay: 5000,
    });

    const fromRate = rates[from.toUpperCase()];
    const toRate = rates[to.toUpperCase()];

    if (fromRate === undefined || toRate === undefined) {
      const errorMessage = `Exchange rate not found for conversion ${from} to ${to}`;
      this.logger.error(errorMessage);
      Sentry.captureException(new Error(errorMessage), {
        level: 'error',
        extra: {
          description: errorMessage,
        },
      });
      throw new Error(errorMessage);
    }

    // Convert to USD first, then to target currency
    const usdAmount = amount / fromRate;
    return usdAmount * toRate;
  }
}
