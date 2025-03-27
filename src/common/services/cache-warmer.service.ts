import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReserveService } from '@api/reserve/services/reserve.service';
import { StablecoinsService } from '@api/stablecoins/stablecoins.service';
import { CACHE_KEYS } from '../constants';
import { CACHE_CONFIG } from '../config/cache.config';
import { CacheService } from './cache.service';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
/**
 * Warms the cache for reserve and stablecoins endpoints on a schedule.
 * Data is cached for 15 minutes more than the refresh interval
 * to ensure data availability during cache updates.
 * Cache warming is disabled in development environment.
 */
@Injectable()
export class CacheWarmerService implements OnModuleInit {
  private readonly logger = new Logger(CacheWarmerService.name);
  private readonly isCacheWarmingEnabled: boolean;

  constructor(
    private readonly cacheService: CacheService,
    private readonly reserveService: ReserveService,
    private readonly stablecoinsService: StablecoinsService,
    private readonly configService: ConfigService,
  ) {
    this.isCacheWarmingEnabled = this.configService.get('CACHE_WARMING_ENABLED');
  }

  @Cron(CronExpression.EVERY_3_HOURS)
  async warmCache() {
    if (!this.isCacheWarmingEnabled) {
      this.logger.log('Cache warming is disabled. Skipping scheduled cache warm-up.');
      return;
    }

    this.logger.log('Starting cache warm-up...');

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

  async onModuleInit() {
    this.logger.log('Initializing cache warmer...');

    if (!this.isCacheWarmingEnabled) {
      this.logger.log('Cache warming is disabled. Skipping initial cache warm-up.');
      return;
    }

    await this.warmCache();
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
