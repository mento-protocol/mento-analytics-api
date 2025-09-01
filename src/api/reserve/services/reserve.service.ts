import * as Sentry from '@sentry/nestjs';
import { Injectable, Logger } from '@nestjs/common';

import { AssetBalance, AssetSymbol, GroupedAssetBalance, Chain } from '@types';
import { RESERVE_ADDRESS_CONFIGS } from '../config/addresses.config';
import { ASSET_GROUPS } from '../config/assets.config';
import { ReserveBalanceService } from './reserve-balance.service';
import { ReserveCompositionResponseDto } from '../dto/reserve.dto';

@Injectable()
export class ReserveService {
  private readonly logger = new Logger(ReserveService.name);
  private readonly ongoingRequests = new Map<string, Promise<unknown>>();

  constructor(private readonly balanceService: ReserveBalanceService) {}

  /**
   * Get the reserve holdings for a given chain with request deduplication
   * @param chain - The chain to get the reserve holdings for.
   * @returns The reserve holdings for the given chain.
   */
  async getReserveHoldingsByChain(chain: Chain): Promise<AssetBalance[]> {
    return this.deduplicateRequest(`reserve-holdings-${chain}`, () => this.fetchReserveHoldingsByChainInternal(chain));
  }

  /**
   * Internal method that performs the actual chain-specific reserve holdings fetch
   */
  private async fetchReserveHoldingsByChainInternal(chain: Chain): Promise<AssetBalance[]> {
    try {
      const configsForChain = RESERVE_ADDRESS_CONFIGS.filter((config) => config.chain === chain);

      this.logger.debug(`Fetching reserve holdings for chain ${chain} (${configsForChain.length} addresses)`);

      const balances = await Promise.all(
        configsForChain.map((config) => this.balanceService.fetchBalancesByConfig(config)),
      );

      const flatBalances = balances.flat();
      this.logger.debug(`Completed reserve holdings fetch for chain ${chain} - ${flatBalances.length} balances`);

      return flatBalances;
    } catch (error) {
      this.logger.error(`Failed to fetch reserve holdings for chain ${chain}:`, error);
      Sentry.captureException(error, {
        level: 'error',
        extra: {
          chain,
          description: `Failed to fetch reserve holdings for chain ${chain}`,
        },
      });
      return [];
    }
  }

  /**
   * Get the balances of all reserve holdings with request deduplication
   * @returns The balances of all reserve holdings
   */
  async getReserveHoldings(): Promise<AssetBalance[]> {
    return this.deduplicateRequest('reserve-holdings', () => this.fetchReserveHoldingsInternal());
  }

  /**
   * Internal method that performs the actual reserve holdings fetch
   */
  private async fetchReserveHoldingsInternal(): Promise<AssetBalance[]> {
    try {
      this.logger.debug('Starting reserve holdings fetch');

      const allBalances = (
        await Promise.all(RESERVE_ADDRESS_CONFIGS.map((config) => this.balanceService.fetchBalancesByConfig(config)))
      ).flat();

      this.logger.debug(`Completed reserve holdings fetch - ${allBalances.length} balances`);
      return allBalances;
    } catch (error) {
      this.logger.error('Failed to fetch reserve holdings:', error);
      Sentry.captureException(error);
      return [];
    }
  }

  /**
   * Deduplicates concurrent requests to prevent race conditions
   * @param key - Unique key for the request type
   * @param fetcher - Function that performs the actual data fetch
   * @returns Promise that resolves with the fetched data
   */
  private async deduplicateRequest<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    // Check if this request is already in progress
    if (this.ongoingRequests.has(key)) {
      this.logger.debug(`Request deduplication: joining existing request for ${key}`);
      return this.ongoingRequests.get(key) as Promise<T>;
    }

    // Start new request with timeout safety
    this.logger.debug(`Request deduplication: starting new request for ${key}`);
    const promise = Promise.race([
      fetcher(),
      this.createTimeoutPromise<T>(60000, `Request ${key} timed out`), // 60 second timeout
    ]).finally(() => {
      // Clean up the cache when request completes (success or failure)
      this.ongoingRequests.delete(key);
      this.logger.debug(`Request deduplication: cleaned up cache for ${key}`);
    });

    // Cache the promise so concurrent requests can join it
    this.ongoingRequests.set(key, promise);

    return promise;
  }

  /**
   * Creates a timeout promise for safety
   */
  private createTimeoutPromise<T>(timeoutMs: number, errorMessage: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);
    });
  }

  /**
   * Get the grouped reserve holdings with total USD value
   */
  async getGroupedReserveHoldings(): Promise<{
    total_holdings_usd: number;
    assets: GroupedAssetBalance[];
  }> {
    const holdings = await this.getReserveHoldings();
    return this.groupHoldings(holdings);
  }

  /**
   * Get the reserve composition
   * @returns The reserve composition
   */
  async getReserveComposition(): Promise<ReserveCompositionResponseDto> {
    const { total_holdings_usd, assets } = await this.getGroupedReserveHoldings();
    const composition = assets.map((asset) => ({
      symbol: asset.symbol,
      percentage: (asset.usdValue / total_holdings_usd) * 100,
      usd_value: asset.usdValue,
    }));
    return { composition };
  }

  private groupHoldings(holdings: AssetBalance[]): {
    total_holdings_usd: number;
    assets: GroupedAssetBalance[];
  } {
    const symbolToGroup = this.createSymbolToGroupMapping();
    const groupedHoldings = this.groupHoldingsBySymbol(holdings, symbolToGroup);
    const assets = Object.values(groupedHoldings);

    return {
      total_holdings_usd: this.calculateTotalUsdValue(assets),
      assets: this.sortAssetsByUsdValue(assets),
    };
  }

  private createSymbolToGroupMapping(): Record<AssetSymbol, AssetSymbol> {
    return Object.entries(ASSET_GROUPS).reduce(
      (acc, [mainSymbol, symbols]) => {
        symbols.forEach((symbol) => {
          acc[symbol] = mainSymbol as AssetSymbol;
        });
        return acc;
      },
      {} as Record<AssetSymbol, AssetSymbol>,
    );
  }

  private groupHoldingsBySymbol(
    holdings: AssetBalance[],
    symbolToGroup: Record<string, AssetSymbol>,
  ): Record<AssetSymbol, GroupedAssetBalance> {
    return holdings.reduce(
      (acc, curr) => {
        const mainSymbol = symbolToGroup[curr.symbol] || curr.symbol;

        if (!acc[mainSymbol]) {
          acc[mainSymbol] = this.createInitialGroupedBalance(mainSymbol);
        }

        acc[mainSymbol] = this.updateGroupedBalance(acc[mainSymbol], curr);
        return acc;
      },
      {} as Record<AssetSymbol, GroupedAssetBalance>,
    );
  }

  private createInitialGroupedBalance(symbol: AssetSymbol): GroupedAssetBalance {
    return {
      symbol,
      totalBalance: '0',
      usdValue: 0,
    };
  }

  private updateGroupedBalance(grouped: GroupedAssetBalance, current: AssetBalance): GroupedAssetBalance {
    return {
      ...grouped,
      totalBalance: (Number(grouped.totalBalance) + Number(current.balance)).toString(),
      usdValue: grouped.usdValue + current.usdValue,
    };
  }

  private calculateTotalUsdValue(assets: GroupedAssetBalance[]): number {
    return assets.reduce((sum, asset) => sum + asset.usdValue, 0);
  }

  private sortAssetsByUsdValue(assets: GroupedAssetBalance[]): GroupedAssetBalance[] {
    return [...assets].sort((a, b) => b.usdValue - a.usdValue);
  }
}
