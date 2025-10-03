import { withRetry, RETRY_CONFIGS } from '@/utils';
import { STABLE_TOKEN_FIAT_MAPPING } from '@common/constants';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';

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
  private readonly CACHE_DURATION = 1000 * 60 * 60 * 6; // 6 hours

  private ratesCache: Record<string, number> | null = null;
  private lastFetchTimestamp = 0;
  private ongoingFetch: Promise<Record<string, number>> | null = null;
  private fiatSymbols: string[];

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.getRequiredConfig('EXCHANGE_RATES_API_KEY');
    this.baseUrl = this.getRequiredConfig('EXCHANGE_RATES_API_URL');
    this.fiatSymbols = Object.values(STABLE_TOKEN_FIAT_MAPPING);
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value || value === 'null' || value === 'undefined') {
      throw new Error(`${key} is not defined in environment variables`);
    }
    return value;
  }

  /**
   * Fetch exchange rates with caching and deduplication
   */
  private async fetchRates(): Promise<Record<string, number>> {
    // Return cached rates if still valid
    if (this.ratesCache && Date.now() - this.lastFetchTimestamp < this.CACHE_DURATION) {
      this.logger.debug('Returning cached exchange rates');
      return this.ratesCache;
    }

    // Deduplicate concurrent requests
    if (this.ongoingFetch) {
      this.logger.debug('Joining ongoing exchange rates fetch');
      return await this.ongoingFetch;
    }

    // Start new fetch
    this.logger.log('Fetching fresh exchange rates');
    this.ongoingFetch = this.fetchFromAPI();

    try {
      return await this.ongoingFetch;
    } finally {
      this.ongoingFetch = null;
    }
  }

  /**
   * Perform the actual API fetch
   */
  private async fetchFromAPI(): Promise<Record<string, number>> {
    try {
      const url = new URL(this.baseUrl);
      url.pathname = '/latest';
      url.searchParams.set('base', 'USD');
      url.searchParams.set('symbols', this.fiatSymbols.join(','));
      url.searchParams.set('access_key', this.apiKey);

      const response = await fetch(url.toString());

      // Validate response
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      // Validate content type
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        const text = await response.text();
        this.logger.warn(`Non-JSON response (${contentType}): ${text.substring(0, 100)}`);
        throw new Error('API returned HTML instead of JSON - likely rate limited');
      }

      const data: ExchangeRatesResponse = await response.json();

      // Check for API errors
      if (data.error) {
        throw new Error(`API error ${data.error.code}: ${data.error.message}`);
      }

      // Validate data
      if (!data.rates || Object.keys(data.rates).length === 0) {
        throw new Error('API returned empty rates data');
      }

      // Update cache
      this.ratesCache = data.rates;
      this.lastFetchTimestamp = Date.now();
      this.logger.log(`Successfully fetched ${Object.keys(data.rates).length} exchange rates`);

      return data.rates;
    } catch (error) {
      this.logger.error(error, 'Failed to fetch exchange rates');
      Sentry.captureException(error, { level: 'error' });
      throw error;
    }
  }

  /**
   * Get exchange rate for a specific currency
   */
  async getRate(currency: string): Promise<number> {
    const rates = await withRetry(() => this.fetchRates(), 'Failed to fetch exchange rates', {
      ...RETRY_CONFIGS.EXTERNAL_API,
      logger: this.logger,
    });

    const rate = rates[currency.toUpperCase()];
    if (rate === undefined) {
      const error = new Error(`Exchange rate not found for currency: ${currency}`);
      this.logger.error(error.message);
      Sentry.captureException(error, { level: 'error' });
      throw error;
    }

    return rate;
  }

  /**
   * Convert amount from one currency to another via USD
   */
  async convert(amount: number, from: string, to: string): Promise<number> {
    const rates = await withRetry(() => this.fetchRates(), 'Failed to fetch exchange rates', {
      ...RETRY_CONFIGS.EXTERNAL_API,
      logger: this.logger,
    });

    const fromRate = rates[from.toUpperCase()];
    const toRate = rates[to.toUpperCase()];

    if (fromRate === undefined || toRate === undefined) {
      const error = new Error(`Exchange rate not found for conversion ${from} to ${to}`);
      this.logger.error(error.message);
      Sentry.captureException(error, { level: 'error' });
      throw error;
    }

    // Convert to USD first, then to target currency
    return (amount / fromRate) * toRate;
  }
}
