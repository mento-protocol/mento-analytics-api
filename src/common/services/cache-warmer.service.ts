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

const BLOCK_THRESHOLDS: Partial<Record<Chain, number>> = {
  [Chain.CELO]: CACHE_CONFIG.TTL.WARM / 5, // TTL in blocks - Celo block time is 5 seconds https://celoscan.io/chart/blocktime
  [Chain.ETHEREUM]: CACHE_CONFIG.TTL.WARM / 12, // TTL in blocks - Ethereum block time is 12 seconds https://etherscan.io/chart/blocktime
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

  constructor(
    private readonly cacheService: CacheService,
    private readonly reserveService: ReserveService,
    private readonly stablecoinsService: StablecoinsService,
    private readonly chainClientService: ChainClientService,
    private readonly configService: ConfigService,
  ) {
    this.isCacheWarmingEnabled = this.configService.get('CACHE_WARMING_ENABLED') === 'true';

    this.lastProcessedBlock.set(Chain.CELO, 0);
    this.lastProcessedBlock.set(Chain.ETHEREUM, 0);
  }

  async onModuleInit() {
    this.logger.log('Initializing cache warmer...');

    if (!this.isCacheWarmingEnabled) {
      this.logger.log('Cache warming is disabled. Skipping initialization.');
      return;
    }

    // Initial cache warm-up
    await this.warmCache();

    this.setupBlockWatchers();
  }

  private setupBlockWatchers() {
    // Watch Celo blocks
    this.chainClientService.watchBlocks(Chain.CELO, (blockNumber) => {
      this.handleNewBlock(Chain.CELO, blockNumber);
    });

    // Watch Ethereum blocks
    this.chainClientService.watchBlocks(Chain.ETHEREUM, (blockNumber) => {
      this.handleNewBlock(Chain.ETHEREUM, blockNumber);
    });
  }

  private async handleNewBlock(chain: Chain, blockNumber: bigint) {
    const lastBlock = this.lastProcessedBlock.get(chain) || 0;
    const currentBlock = Number(blockNumber);
    const threshold = BLOCK_THRESHOLDS[chain];

    // Only process if we've moved enough blocks to avoid excessive updating
    if (currentBlock - lastBlock >= threshold) {
      this.logger.log(`New ${chain} block ${currentBlock}, triggering cache update`);
      this.lastProcessedBlock.set(chain, currentBlock);

      await this.warmCache();
    }
  }

  async warmCache() {
    if (!this.isCacheWarmingEnabled) {
      this.logger.log('Cache warming is disabled. Skipping update.');
      return;
    }

    this.logger.log('Starting cache warm-up based on new blocks...');

    try {
      await Promise.all([this.warmReserveEndpoints(), this.warmStablecoinsEndpoints()]);

      this.logger.log('Cache warm-up completed successfully');
    } catch (error) {
      const errorMessage = 'Cache warm-up failed';
      this.logger.error(error, errorMessage);
      Sentry.captureException(error, {
        level: 'error',
        extra: {
          description: errorMessage,
        },
      });
    }
  }

  /**
   * Warms the cache for the reserve endpoints.
   */
  private async warmReserveEndpoints() {
    // The endpoints to be cached as well as the functions to fetch the data
    const endpoints = {
      [CACHE_KEYS.RESERVE_HOLDINGS]: async () => {
        const holdings = await this.reserveService.getReserveHoldings();
        const total_holdings_usd = holdings.reduce((sum, asset) => sum + asset.usdValue, 0);
        const response = { total_holdings_usd, assets: holdings };
        return response;
      },
      [CACHE_KEYS.RESERVE_COMPOSITION]: async () => {
        const { total_holdings_usd, assets } = await this.reserveService.getGroupedReserveHoldings();
        const composition = assets.map((asset) => ({
          symbol: asset.symbol,
          percentage: (asset.usdValue / total_holdings_usd) * 100,
          usd_value: asset.usdValue,
        }));
        return { composition };
      },
      [CACHE_KEYS.RESERVE_HOLDINGS_GROUPED]: () => this.reserveService.getGroupedReserveHoldings(),
      [CACHE_KEYS.RESERVE_STATS]: async () => {
        const { total_holdings_usd } = await this.reserveService.getGroupedReserveHoldings();
        const { total_supply_usd } = await this.stablecoinsService.getStablecoins();
        return {
          total_reserve_value_usd: total_holdings_usd,
          total_outstanding_stables_usd: total_supply_usd,
          collateralization_ratio: total_holdings_usd / total_supply_usd,
          timestamp: new Date().toISOString(),
        };
      },
    };

    // Now execute all the endpoints and cache the results
    await Promise.all(
      Object.entries(endpoints).map(async ([key, fetcher]) => {
        try {
          const data = await fetcher();
          await this.cacheService.set(key, data, CACHE_CONFIG.TTL.WARM);
          this.logger.log(`Cached ${key} successfully`);
        } catch (error) {
          this.logger.error(error, `Failed to cache ${key}`);
        }
      }),
    );
  }

  private async warmStablecoinsEndpoints() {
    try {
      const stablecoins = await this.stablecoinsService.getStablecoins();
      await this.cacheService.set(CACHE_KEYS.STABLECOINS, stablecoins, CACHE_CONFIG.TTL.WARM);
      this.logger.log('Cached stablecoins successfully');
    } catch (error) {
      const errorMessage = 'Failed to cache stablecoins';
      this.logger.error(error, errorMessage);
      Sentry.captureException(error, {
        level: 'error',
        extra: {
          description: errorMessage,
        },
      });
    }
  }
}
