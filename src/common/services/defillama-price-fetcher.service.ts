import { withRetry } from '@/utils';
import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

interface DefiLlamaResponse {
  coins: Record<
    string,
    {
      decimals: number;
      price: number;
      symbol: string;
      timestamp: number;
      confidence: number;
    }
  >;
}

@Injectable()
export class DefiLlamaPriceFetcherService {
  private readonly logger = new Logger(DefiLlamaPriceFetcherService.name);
  private readonly baseUrl = 'https://coins.llama.fi';

  private readonly priceCache: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
  private readonly pendingRequests: Map<string, Promise<number>> = new Map();

  /**
   * Get price from DeFiLlama by token ID
   * @param defiLlamaId - Token ID in format "chain:address" (e.g., "ethereum:0xa3931d71877c0e7a3148cb7eb4463524fec27fbd")
   */
  async getPrice(defiLlamaId: string): Promise<number> {
    const normalizedId = defiLlamaId.toLowerCase();

    const cached = this.priceCache.get(normalizedId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.price;
    }

    const pending = this.pendingRequests.get(normalizedId);
    if (pending) {
      return pending;
    }

    const pricePromise = this.fetchPriceWithRetry(normalizedId);
    this.pendingRequests.set(normalizedId, pricePromise);

    try {
      const price = await pricePromise;
      this.pendingRequests.delete(normalizedId);
      return price;
    } catch (error) {
      this.pendingRequests.delete(normalizedId);
      throw error;
    }
  }

  private async fetchPriceWithRetry(defiLlamaId: string): Promise<number> {
    return withRetry(
      async () => {
        const price = await this.fetchPrice(defiLlamaId);
        return price;
      },
      `Failed to fetch price for ${defiLlamaId} from DeFiLlama`,
      {
        maxRetries: 5,
        baseDelay: 5000,
      },
    );
  }

  private async fetchPrice(defiLlamaId: string): Promise<number> {
    let response: Response;

    try {
      const requestUrl = `${this.baseUrl}/prices/current/${defiLlamaId}`;

      response = await fetch(requestUrl, {
        headers: {
          Accept: 'application/json',
        },
      });
    } catch (error) {
      const description = `Failed to fetch price for ${defiLlamaId} from DeFiLlama API`;
      this.logger.error(error, description);
      Sentry.captureException(error, {
        level: 'error',
        extra: { description },
      });
      throw error;
    }

    if (!response.ok) {
      const errorMessage = `DeFiLlama API error: ${response.status} ${response.statusText}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as DefiLlamaResponse;
    const tokenData = data.coins[defiLlamaId];

    if (!tokenData) {
      throw new Error(`Price not found for DeFiLlama ID: ${defiLlamaId}`);
    }

    const price = tokenData.price;

    // Update cache
    this.priceCache.set(defiLlamaId, {
      price,
      timestamp: Date.now(),
    });

    this.logger.debug(`Fetched price for ${defiLlamaId}: $${price}`);

    return price;
  }
}
