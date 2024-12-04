import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { ReserveService } from '@api/reserve/services/reserve.service';
import { StablecoinsService } from '@api/stablecoins/stablecoins.service';
import { Cache } from 'cache-manager';
import { CACHE_TTL } from '../constants';

/**
 * Warms the cache for reserve and stablecoins endpoints on an hourly schedule.
 * Data is cached for 75 minutes (leaving a 15-minute buffer over the hourly refresh)
 * to ensure data availability during cache updates.
 */
@Injectable()
export class CacheWarmerService implements OnModuleInit {
  private readonly logger = new Logger(CacheWarmerService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly reserveService: ReserveService,
    private readonly stablecoinsService: StablecoinsService,
  ) {}

  @Cron(CronExpression.EVERY_3_HOURS)
  async warmCache() {
    this.logger.log('Starting cache warm-up...');

    try {
      await Promise.all([this.warmReserveEndpoints(), this.warmStablecoinsEndpoints()]);

      this.logger.log('Cache warm-up completed successfully');
    } catch (error) {
      this.logger.error('Cache warm-up failed:', error);
    }
  }

  async onModuleInit() {
    this.logger.log('Initializing cache warmer...');
    await this.warmCache();
  }

  /**
   * Warms the cache for the reserve endpoints.
   */
  private async warmReserveEndpoints() {
    // The endpoints to be cached as well as the functions to fetch the data
    const endpoints = {
      'reserve-holdings': async () => {
        const holdings = await this.reserveService.getReserveHoldings();
        const total_holdings_usd = holdings.reduce((sum, asset) => sum + asset.usdValue, 0);
        const response = { total_holdings_usd, assets: holdings };
        return response;
      },
      'reserve-composition': async () => {
        const { total_holdings_usd, assets } = await this.reserveService.getGroupedReserveHoldings();
        const composition = assets.map((asset) => ({
          symbol: asset.symbol,
          percentage: (asset.usdValue / total_holdings_usd) * 100,
          usd_value: asset.usdValue,
        }));
        return { composition };
      },
      'reserve-holdings-grouped': () => this.reserveService.getGroupedReserveHoldings(),
      'reserve-stats': async () => {
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
          await this.cacheManager.set(key, data, CACHE_TTL);
          this.logger.debug(`Cached ${key} successfully`);
        } catch (error) {
          this.logger.error(`Failed to cache ${key}:`, error);
        }
      }),
    );
  }

  private async warmStablecoinsEndpoints() {
    try {
      const stablecoins = await this.stablecoinsService.getStablecoins();
      await this.cacheManager.set('stablecoins', stablecoins, CACHE_TTL);
      this.logger.debug('Cached stablecoins successfully');
    } catch (error) {
      this.logger.error('Failed to cache stablecoins:', error);
    }
  }
}
