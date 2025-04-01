import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ReserveService } from '@api/reserve/services/reserve.service';
import { StablecoinsService } from '@api/stablecoins/stablecoins.service';
import { CACHE_KEYS } from '../constants';
import { CACHE_CONFIG } from '../config/cache.config';
import { CacheService } from './cache.service';
import { ChainClientService } from './chain-client.service';
import { Chain } from '@types';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';

/**
 * The number of blocks between cache warmings for each chain.
 * This is used to prevent the cache from being warmed too often and also
 * protects from spamming the RPC with requests.
 * The value is the number of blocks that must elapse before the cache is warmed again.
 * The value is based on the block time of the chain.
 *
 */
const BLOCK_THRESHOLDS: Partial<Record<Chain, number>> = {
  [Chain.CELO]: CACHE_CONFIG.TTL.WARM / 1, // TTL in blocks - Celo block time is 1 seconds
  [Chain.ETHEREUM]: CACHE_CONFIG.TTL.WARM / 12, // TTL in blocks - Ethereum block time is 12 seconds
};

/**
 * Warms the cache for reserve and stablecoins endpoints on blockchain updates.
 * Listens for new blocks on Celo and Ethereum chains and updates data accordingly.
 * Cache warming is disabled in development environment.
 */
@Injectable()
export class CacheWarmerService implements OnModuleInit {
  private readonly logger = new Logger(CacheWarmerService.name);
  private readonly isCacheWarmingEnabled: boolean;
  private lastProcessedBlock: Map<Chain, number> = new Map();
  private chainUpdateInProgress: Map<Chain, boolean> = new Map();

  constructor(
    private readonly cacheService: CacheService,
    private readonly reserveService: ReserveService,
    private readonly stablecoinsService: StablecoinsService,
    private readonly chainClientService: ChainClientService,
    private readonly configService: ConfigService,
  ) {
    // Only enable cache warming if the env var is exactly 'true'. Will be false if not set.
    this.isCacheWarmingEnabled = this.configService.get('CACHE_WARMING_ENABLED') === 'true';

    // Initialize maps for tracked chains
    Object.keys(BLOCK_THRESHOLDS).forEach((chain) => {
      this.lastProcessedBlock.set(chain as Chain, 0);
      this.chainUpdateInProgress.set(chain as Chain, false);
    });
  }

  async onModuleInit() {
    this.logger.log('Initializing cache warmer...');

    if (!this.isCacheWarmingEnabled) {
      this.logger.log('Cache warming is disabled. Skipping initialization.');
      return;
    }

    // Initial cache warm-up for all chains
    await this.warmAllCaches();
    this.setupBlockWatchers();
  }

  /**
   * Sets up block watchers for all chains.
   */
  private setupBlockWatchers() {
    Object.keys(BLOCK_THRESHOLDS).forEach((chain) => {
      this.chainClientService.watchBlocks(chain as Chain, (blockNumber) => {
        this.handleNewBlock(chain as Chain, blockNumber);
      });
    });
  }

  /**
   * Handles a new block event.
   * @param chain - The chain the block belongs to.
   * @param blockNumber - The number of the block.
   */
  private async handleNewBlock(chain: Chain, blockNumber: bigint) {
    const lastBlock = this.lastProcessedBlock.get(chain) || 0;
    const currentBlock = Number(blockNumber);
    const threshold = BLOCK_THRESHOLDS[chain];
    const isUpdateInProgress = this.chainUpdateInProgress.get(chain);

    // If the block threshold has been met and the chain is not already being updated, warm the cache
    if (currentBlock - lastBlock >= threshold && !isUpdateInProgress) {
      this.logger.log(`New ${chain} block ${currentBlock}, triggering chain-specific cache update`);
      this.lastProcessedBlock.set(chain, currentBlock);

      await this.warmChainSpecificCache(chain);
    }
  }

  /**
   * Warms the chain-specific cache.
   * @param chain - The chain to warm the cache for.
   */
  private async warmChainSpecificCache(chain: Chain) {
    if (!this.isCacheWarmingEnabled) return;

    this.chainUpdateInProgress.set(chain, true);

    try {
      this.logger.log(`Starting cache warm-up for ${chain}...`);

      // Warm chain-specific reserve data
      await this.warmReserveEndpointsForChain(chain);

      // Only update stablecoins if we're processing Celo
      if (chain === Chain.CELO) {
        await this.warmStablecoinsEndpoints();
      }

      this.logger.log(`Cache warm-up for ${chain} completed successfully`);
    } catch (error) {
      const errorMessage = `Cache warm-up failed for ${chain}`;
      this.logger.error(error, errorMessage);
      Sentry.captureException(error, {
        level: 'error',
        extra: {
          chain,
          description: errorMessage,
        },
      });
    } finally {
      this.chainUpdateInProgress.set(chain, false);
    }
  }

  /**
   * Warms data for all chains.
   */
  private async warmAllCaches() {
    await Promise.all(Object.keys(BLOCK_THRESHOLDS).map((chain) => this.warmChainSpecificCache(chain as Chain)));
  }

  /**
   * Warms the reserve endpoints for a given chain then updates the aggregated data.
   * @param chain - The chain to warm the reserve endpoints for.
   */
  private async warmReserveEndpointsForChain(chain: Chain) {
    try {
      // Get chain-specific holdings
      const chainSpecificHoldings = await this.reserveService.getReserveHoldingsForChain(chain);

      // Update chain-specific cache
      await this.cacheService.set(CACHE_KEYS.RESERVE_HOLDINGS_FOR_CHAIN(chain), chainSpecificHoldings);

      // After updating chain-specific data, update aggregated data
      await this.updateAggregatedReserveData();
    } catch (error) {
      this.logger.error(`Failed to warm reserve endpoints for ${chain}`, error);
      Sentry.captureException(error);
    }
  }

  private async updateAggregatedReserveData() {
    try {
      // Get all cached chain-specific data
      const allChainData = await Promise.all(
        Object.keys(BLOCK_THRESHOLDS).map(async (chain) => {
          const chainData = await this.cacheService.get(CACHE_KEYS.RESERVE_HOLDINGS_FOR_CHAIN(chain as Chain));
          return chainData || [];
        }),
      );

      // Combine all chain data
      const allHoldings = allChainData.flat();

      // Update the main cache with all holdings
      await this.cacheService.set(CACHE_KEYS.RESERVE_HOLDINGS, allHoldings);

      // Update the composition cache
      const composition = await this.reserveService.getReserveComposition();
      await this.cacheService.set(CACHE_KEYS.RESERVE_COMPOSITION, composition);

      // Update the grouped holdings cache
      const holdingsGrouped = await this.reserveService.getGroupedReserveHoldings();
      await this.cacheService.set(CACHE_KEYS.RESERVE_HOLDINGS_GROUPED, holdingsGrouped);

      // Update the stats cache
      const stats = await this.calculateReserveStats();
      await this.cacheService.set(CACHE_KEYS.RESERVE_STATS, stats);
    } catch (error) {
      this.logger.error('Failed to update aggregated reserve data', error);
      Sentry.captureException(error);
    }
  }

  // TODO: Move this calculation to a service
  private async calculateReserveStats() {
    const { total_holdings_usd: total_reserve_value_usd } = await this.reserveService.getGroupedReserveHoldings();
    const { total_supply_usd: total_outstanding_stables_usd } = await this.stablecoinsService.getStablecoins();

    return {
      total_reserve_value_usd,
      total_outstanding_stables_usd,
      collateralization_ratio: total_reserve_value_usd / total_outstanding_stables_usd,
      timestamp: new Date().toISOString(),
    };
  }

  private async warmStablecoinsEndpoints() {
    try {
      const stablecoins = await this.stablecoinsService.getStablecoins();
      await this.cacheService.set(CACHE_KEYS.STABLECOINS, stablecoins);
    } catch (error) {
      this.logger.error('Failed to warm stablecoins endpoints', error);
      Sentry.captureException(error);
    }
  }
}
