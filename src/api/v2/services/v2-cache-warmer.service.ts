import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { CacheService } from '@common/services/cache.service';
import { ChainClientService } from '@common/services/chain-client.service';
import { MentoService } from '@common/services/mento.service';
import { V2_CACHE_KEYS } from '@common/constants';
import { CACHE_CONFIG } from '@common/config/cache.config';
import { Chain } from '@types';

import { V2ReserveService } from './v2-reserve.service';
import { V2StablecoinsService } from './v2-stablecoins.service';
import { V2OverviewService } from './v2-overview.service';
import { V2SupplyBreakdownService } from './v2-supply-breakdown.service';
import { V2PositionsService } from './v2-positions.service';
import { FpmmPositionsService } from './fpmm-positions.service';
import { PrimitiveCacheService } from './primitive-cache.service';

// ---------------------------------------------------------------------------
// Tiering constants
// ---------------------------------------------------------------------------

/**
 * Block thresholds for Tier 1 warming, derived from a ~5 min target and each
 * chain's block time.  Only chains with an RPC block watcher are listed.
 */
const TIER1_BLOCK_THRESHOLDS: Partial<Record<Chain, number>> = {
  [Chain.CELO]: (30 * 60) / 1, // ~1800 Celo blocks (1 s block time)
  [Chain.ETHEREUM]: (30 * 60) / 12, // ~150 Ethereum blocks (12 s block time)
};

/** Tier 2 interval in milliseconds (~30 min). */
const TIER2_INTERVAL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Stale-while-revalidate helpers (exported for controllers)
// ---------------------------------------------------------------------------

/**
 * Wraps a cached value together with a timestamp so controllers can decide
 * whether to trigger a background refresh.
 */
export interface CacheEntry<T> {
  data: T;
  /** ISO-8601 timestamp of when this entry was computed. */
  timestamp: string;
}

/**
 * Default staleness window: data older than this triggers a background
 * refresh even though it is still returned to the caller immediately.
 */
const STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Tiered cache warmer for v2 endpoints.
 *
 * Tier 1 (~5 min / N blocks)
 *   Recomputes the four composed v2 endpoints (overview, stablecoins,
 *   reserve, supply-breakdown) and persists results to CacheService.
 *   Triggered by block watchers on Celo and Ethereum.
 *
 * Tier 2 (~30 min, setInterval)
 *   Refreshes structural / slow-moving data such as FPMM pool discovery and
 *   the stablecoin address list from the SDK.
 *
 * Tier 3 (startup only)
 *   Loads the stablecoin address set from the Mento SDK into the primitive
 *   cache so that position readers can classify tokens without an SDK call.
 *
 * Stale-while-revalidate
 *   {@link getOrRevalidate} returns cached data immediately and, if the entry
 *   is older than {@link STALE_AFTER_MS}, fires a non-blocking background
 *   refresh.  Controllers should call this instead of manually checking the
 *   cache.
 */
@Injectable()
export class V2CacheWarmerService implements OnModuleInit {
  private readonly logger = new Logger(V2CacheWarmerService.name);
  private readonly isCacheWarmingEnabled: boolean;

  /** Last block number processed per chain (Tier 1). */
  private lastProcessedBlock = new Map<Chain, number>();
  /** Guard against overlapping Tier 1 refreshes per chain. */
  private chainUpdateInProgress = new Map<Chain, boolean>();
  /** Guard against overlapping Tier 2 refreshes. */
  private tier2InProgress = false;
  /** Handle returned by setInterval for Tier 2 so it can be cleared. */
  private tier2Timer: ReturnType<typeof setInterval> | null = null;

  /** Guards for per-key background revalidation (prevents stampede). */
  private revalidationInProgress = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly chainClientService: ChainClientService,
    private readonly mentoService: MentoService,
    private readonly primitiveCacheService: PrimitiveCacheService,
    private readonly v2ReserveService: V2ReserveService,
    private readonly v2StablecoinsService: V2StablecoinsService,
    private readonly v2OverviewService: V2OverviewService,
    private readonly v2SupplyBreakdownService: V2SupplyBreakdownService,
    private readonly v2PositionsService: V2PositionsService,
    private readonly fpmmPositionsService: FpmmPositionsService,
  ) {
    this.isCacheWarmingEnabled = this.configService.get('CACHE_WARMING_ENABLED') === 'true';

    for (const chain of Object.keys(TIER1_BLOCK_THRESHOLDS)) {
      this.lastProcessedBlock.set(chain as Chain, 0);
      this.chainUpdateInProgress.set(chain as Chain, false);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onModuleInit(): Promise<void> {
    this.logger.log('Initialising v2 cache warmer…');

    if (!this.isCacheWarmingEnabled) {
      this.logger.log('Cache warming disabled (CACHE_WARMING_ENABLED != "true"). Skipping.');
      return;
    }

    // Tier 3: one-off startup tasks
    await this.warmTier3();

    // Tier 1: initial warm + block watchers
    await this.warmAllChainsTier1();
    this.setupBlockWatchers();

    // Tier 2: periodic interval
    await this.warmTier2();
    this.tier2Timer = setInterval(() => {
      this.warmTier2().catch((err) => {
        this.logger.error('Tier 2 interval error', err);
        Sentry.captureException(err);
      });
    }, TIER2_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.tier2Timer) {
      clearInterval(this.tier2Timer);
      this.tier2Timer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Stale-while-revalidate — called by controllers
  // -------------------------------------------------------------------------

  /**
   * Return cached data immediately.  If the cached entry is stale (older than
   * {@link STALE_AFTER_MS}), trigger a non-blocking background refresh using
   * the provided `computeFn`.
   *
   * On a cold cache the data is computed synchronously (blocks the request).
   *
   * @param cacheKey  One of the V2_CACHE_KEYS
   * @param computeFn Async function that produces a fresh value
   */
  async getOrRevalidate<T>(cacheKey: string, computeFn: () => Promise<T>): Promise<T> {
    const entry = await this.cacheService.get<CacheEntry<T>>(cacheKey);

    if (entry?.data !== undefined) {
      // Check staleness
      if (this.isStale(entry)) {
        this.refreshInBackground(cacheKey, computeFn);
      }
      return entry.data;
    }

    // Cold cache — compute synchronously and persist
    const fresh = await computeFn();
    await this.cacheService.set<CacheEntry<T>>(
      cacheKey,
      {
        data: fresh,
        timestamp: new Date().toISOString(),
      },
      CACHE_CONFIG.TTL.DEFAULT,
    );
    return fresh;
  }

  // -------------------------------------------------------------------------
  // Tier 1 — block-driven, ~5 min
  // -------------------------------------------------------------------------

  private setupBlockWatchers(): void {
    for (const chain of Object.keys(TIER1_BLOCK_THRESHOLDS)) {
      this.chainClientService.watchBlocks(chain as Chain, (blockNumber: bigint) => {
        this.handleNewBlock(chain as Chain, blockNumber);
      });
    }
  }

  private async handleNewBlock(chain: Chain, blockNumber: bigint): Promise<void> {
    const lastBlock = this.lastProcessedBlock.get(chain) ?? 0;
    const currentBlock = Number(blockNumber);
    const threshold = TIER1_BLOCK_THRESHOLDS[chain];
    if (!threshold) return;

    if (currentBlock - lastBlock >= threshold && !this.chainUpdateInProgress.get(chain)) {
      this.logger.log(`Tier 1: ${chain} block ${currentBlock} — triggering v2 refresh`);
      this.lastProcessedBlock.set(chain, currentBlock);
      await this.warmChainTier1(chain);
    }
  }

  /**
   * Warm all chains for Tier 1, then update the composed endpoints.
   */
  private async warmAllChainsTier1(): Promise<void> {
    // Warm all chains, then build composed responses
    for (const chain of Object.keys(TIER1_BLOCK_THRESHOLDS)) {
      await this.warmChainTier1(chain as Chain);
    }
  }

  /**
   * Warm Tier 1 for a single chain: pre-warm positions into primitive cache,
   * then rebuild all composed endpoints.
   */
  private async warmChainTier1(chain: Chain): Promise<void> {
    if (this.chainUpdateInProgress.get(chain)) return;
    this.chainUpdateInProgress.set(chain, true);

    try {
      this.logger.log(`Tier 1: starting v2 warm for ${chain}…`);

      // Step 1: Pre-warm positions (populates primitive cache via readers)
      // This ensures subsequent composed endpoint builds hit cache, not RPC.
      await this.v2PositionsService.getPositions();

      // Step 2: Rebuild all composed v2 endpoints and persist.
      // Order matters: stablecoins & reserve feed into overview & breakdown.
      const [stablecoins, reserve] = await Promise.all([
        this.v2StablecoinsService.getStablecoins(),
        this.v2ReserveService.getReserve(),
      ]);
      await this.persistEntry(V2_CACHE_KEYS.STABLECOINS, stablecoins);
      await this.persistEntry(V2_CACHE_KEYS.RESERVE, reserve);

      const [overview, breakdown] = await Promise.all([
        this.v2OverviewService.getOverview(),
        this.v2SupplyBreakdownService.getBreakdown(),
      ]);
      await this.persistEntry(V2_CACHE_KEYS.OVERVIEW, overview);
      await this.persistEntry(V2_CACHE_KEYS.SUPPLY_BREAKDOWN, breakdown);

      this.logger.log(`Tier 1: v2 warm for ${chain} completed`);
    } catch (error) {
      const msg = `Tier 1 warm failed for ${chain}`;
      this.logger.error(msg, error);
      Sentry.captureException(error, { level: 'error', extra: { chain, description: msg } });
    } finally {
      this.chainUpdateInProgress.set(chain, false);
    }
  }

  // -------------------------------------------------------------------------
  // Tier 2 — periodic, ~30 min
  // -------------------------------------------------------------------------

  /**
   * Refresh structural data that changes infrequently:
   * - Stablecoin address list (SDK → primitive cache)
   * - FPMM pool discovery per chain (factory → primitive cache)
   */
  private async warmTier2(): Promise<void> {
    if (this.tier2InProgress) return;
    this.tier2InProgress = true;

    try {
      this.logger.log('Tier 2: starting structural refresh…');

      await this.loadStablecoinAddresses();

      // Pre-warm FPMM pool lists — getPositions() caches the discovered pools
      for (const chain of [Chain.CELO, Chain.MONAD]) {
        try {
          await this.fpmmPositionsService.getPositions(chain);
        } catch (e) {
          this.logger.warn(`Tier 2: FPMM discovery failed for ${chain}: ${e}`);
        }
      }

      this.logger.log('Tier 2: structural refresh completed');
    } catch (error) {
      const msg = 'Tier 2 structural refresh failed';
      this.logger.error(msg, error);
      Sentry.captureException(error, { level: 'error', extra: { description: msg } });
    } finally {
      this.tier2InProgress = false;
    }
  }

  // -------------------------------------------------------------------------
  // Tier 3 — startup only
  // -------------------------------------------------------------------------

  /**
   * One-time tasks that run during module initialisation.
   */
  private async warmTier3(): Promise<void> {
    this.logger.log('Tier 3: loading startup data…');
    await this.loadStablecoinAddresses();
    this.logger.log('Tier 3: startup data loaded');
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  /**
   * Load the set of Mento stablecoin addresses from the SDK and persist to
   * the primitive cache.  Used by both Tier 2 and Tier 3.
   */
  private async loadStablecoinAddresses(): Promise<void> {
    try {
      const mento = this.mentoService.getMentoInstance();
      const tokens = await mento.tokens.getStableTokens();
      const addresses = new Set(tokens.map((t) => t.address.toLowerCase()));
      await this.primitiveCacheService.setStablecoinAddresses(addresses);
      this.logger.log(`Loaded ${addresses.size} stablecoin addresses into primitive cache`);
    } catch (error) {
      this.logger.warn(`Failed to load stablecoin addresses from SDK: ${error}`);
    }
  }

  /**
   * Persist a computed value wrapped in a {@link CacheEntry} so the
   * stale-while-revalidate logic can inspect the timestamp.
   */
  private async persistEntry<T>(cacheKey: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: new Date().toISOString(),
    };
    await this.cacheService.set(cacheKey, entry, CACHE_CONFIG.TTL.DEFAULT);
  }

  /**
   * Returns true if the entry's timestamp is older than {@link STALE_AFTER_MS}.
   */
  private isStale<T>(entry: CacheEntry<T>): boolean {
    const age = Date.now() - new Date(entry.timestamp).getTime();
    return age > STALE_AFTER_MS;
  }

  /**
   * Fire-and-forget: recompute a value and persist to cache.
   * Prevents stampede by tracking in-flight keys.
   */
  private refreshInBackground<T>(cacheKey: string, computeFn: () => Promise<T>): void {
    if (this.revalidationInProgress.has(cacheKey)) return;
    this.revalidationInProgress.add(cacheKey);

    computeFn()
      .then(async (fresh) => {
        await this.persistEntry(cacheKey, fresh);
        this.logger.debug(`Background revalidation complete for ${cacheKey}`);
      })
      .catch((error) => {
        this.logger.warn(`Background revalidation failed for ${cacheKey}: ${error}`);
        Sentry.captureException(error, {
          level: 'warning',
          extra: { cacheKey, description: 'stale-while-revalidate background refresh' },
        });
      })
      .finally(() => {
        this.revalidationInProgress.delete(cacheKey);
      });
  }
}
