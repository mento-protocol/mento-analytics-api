import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { ReserveService } from '@api/reserve/services/reserve.service';
import { StablecoinsService } from '@api/stablecoins/stablecoins.service';
import { Cache } from 'cache-manager';
import { CACHE_TTL } from '../constants';
import { PriceFetcherService } from './price-fetcher.service';

/**
 * Warms the cache for reserve and stablecoins endpoints on a schedule.
 * Data is cached for 15 minutes more than the refresh interval
 * to ensure data availability during cache updates.
 */
@Injectable()
export class CacheWarmerService implements OnModuleInit {
  private readonly logger = new Logger(CacheWarmerService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly reserveService: ReserveService,
    private readonly stablecoinsService: StablecoinsService,
    private readonly priceFetcherService: PriceFetcherService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async warmCache() {
    this.logger.log('Starting cache warm-up...');

    try {
      await this.primePriceFetcher();

      await Promise.all([this.warmReserveEndpoints(), this.warmStablecoinsEndpoints()]);

      this.logger.log('Cache warm-up completed successfully');
    } catch (error) {
      this.logger.error(error, 'Cache warm-up failed');
    }
  }

  async onModuleInit() {
    this.logger.log('Initializing cache warmer...');
    await this.warmCache();
  }

  /**
   * Prime the price fetcher service to ensure it's ready to use.
   * This is useful for ensuring that the price fetcher service is ready to use
   * and to avoid the initial delay when the first price fetch is made.
   */
  private async primePriceFetcher() {
    try {
      // Fetch a known ticker like BTC to "warm up" the connection
      this.logger.log('Priming PriceFetcherService...');
      await this.priceFetcherService.getPrice('BTC');
      this.logger.log('PriceFetcherService primed successfully');
    } catch (err) {
      this.logger.warn(`Failed to prime price fetcher (it should retry automatically anyway). Error: ${err.message}`);
    }
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
      await this.cacheManager.set('stablecoins', stablecoins, CACHE_TTL);
      this.logger.log('Cached stablecoins successfully');
    } catch (error) {
      this.logger.error(error, 'Failed to cache stablecoins');
    }
  }
}
