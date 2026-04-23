import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@common/services/cache.service';
import { Chain } from '@types';

/**
 * Tiered TTLs for v2 primitive cache entries, in milliseconds.
 *
 * - BALANCE / POOL_RESERVES: Short-lived data that changes every block.
 * - STRUCTURAL: Pool lists, trove ownership — changes infrequently.
 * - STABLECOIN_LIST: Essentially static; only changes on protocol upgrades.
 */
export const PRIMITIVE_TTL = {
  BALANCE: 10 * 60 * 1000, // 10 minutes
  POOL_RESERVES: 10 * 60 * 1000, // 10 minutes
  STRUCTURAL: 30 * 60 * 1000, // 30 minutes
  STABLECOIN_LIST: 60 * 60 * 1000, // 1 hour
  READER_SNAPSHOT: 24 * 60 * 60 * 1000, // 24 hours — long-lived fallback
} as const;

/** Threshold beyond which cached reader data triggers a staleness warning. */
export const STALE_WARNING_THRESHOLD_MS = 5 * 60 * 60 * 1000; // 5 hours

/** A cached reader snapshot with its timestamp for staleness tracking. */
export interface ReaderSnapshot<T> {
  data: T;
  /** ISO-8601 timestamp of when this snapshot was captured. */
  timestamp: string;
}

/**
 * Key prefix shared by all primitive cache entries.
 * Namespaced under the global `mento-analytics:` prefix that CacheService adds.
 */
const PREFIX = 'v2:primitive';

/**
 * Build a deterministic cache key from typed segments.
 * Format: `v2:primitive:{type}:{chain}:{identifier}`
 *
 * Examples:
 *   v2:primitive:balance:celo:0xabc…:0x123…
 *   v2:primitive:pool-reserves:celo:0xdef…
 *   v2:primitive:fpmm-pools:celo
 *   v2:primitive:stablecoin-addresses
 */
function primitiveKey(type: string, ...segments: string[]): string {
  return [PREFIX, type, ...segments].join(':');
}

/**
 * Granular caching layer for individual on-chain data points.
 *
 * Each category has its own TTL that reflects how quickly the underlying
 * data is expected to change.  All reads/writes go through the existing
 * {@link CacheService} which wraps NestJS cache-manager, so the same
 * backing store (in-memory or Redis) is shared with v1.
 *
 * Position readers call `set*` after every successful RPC read so that
 * subsequent requests (or the stale-while-revalidate path) can serve
 * data without hitting the chain again.
 */
@Injectable()
export class PrimitiveCacheService {
  private readonly logger = new Logger(PrimitiveCacheService.name);

  constructor(private readonly cacheService: CacheService) {}

  // ---------------------------------------------------------------------------
  // Balance cache (5 min TTL)
  // Key: v2:primitive:balance:{chain}:{token}:{holder}
  // ---------------------------------------------------------------------------

  async getBalance(chain: Chain, token: string, holder: string): Promise<string | null> {
    const key = primitiveKey('balance', chain, token.toLowerCase(), holder.toLowerCase());
    const cached = await this.cacheService.get<string>(key);
    return cached ?? null;
  }

  async setBalance(chain: Chain, token: string, holder: string, value: string): Promise<void> {
    const key = primitiveKey('balance', chain, token.toLowerCase(), holder.toLowerCase());
    await this.cacheService.set(key, value, PRIMITIVE_TTL.BALANCE);
    this.logger.debug(`Cached balance ${chain}:${token.slice(0, 10)}:${holder.slice(0, 10)}`);
  }

  // ---------------------------------------------------------------------------
  // Pool reserves cache (5 min TTL)
  // Key: v2:primitive:pool-reserves:{chain}:{pool}
  // ---------------------------------------------------------------------------

  async getPoolReserves(chain: Chain, pool: string): Promise<{ reserve0: string; reserve1: string } | null> {
    const key = primitiveKey('pool-reserves', chain, pool.toLowerCase());
    const cached = await this.cacheService.get<{ reserve0: string; reserve1: string }>(key);
    return cached ?? null;
  }

  async setPoolReserves(chain: Chain, pool: string, reserves: { reserve0: string; reserve1: string }): Promise<void> {
    const key = primitiveKey('pool-reserves', chain, pool.toLowerCase());
    await this.cacheService.set(key, reserves, PRIMITIVE_TTL.POOL_RESERVES);
    this.logger.debug(`Cached pool reserves ${chain}:${pool.slice(0, 10)}`);
  }

  // ---------------------------------------------------------------------------
  // FPMM pool list cache (30 min TTL — structural)
  // Key: v2:primitive:fpmm-pools:{chain}
  // ---------------------------------------------------------------------------

  async getFpmmPools(chain: Chain): Promise<string[] | null> {
    const key = primitiveKey('fpmm-pools', chain);
    const cached = await this.cacheService.get<string[]>(key);
    return cached ?? null;
  }

  async setFpmmPools(chain: Chain, pools: string[]): Promise<void> {
    const key = primitiveKey('fpmm-pools', chain);
    await this.cacheService.set(key, pools, PRIMITIVE_TTL.STRUCTURAL);
    this.logger.debug(`Cached ${pools.length} FPMM pools for ${chain}`);
  }

  // ---------------------------------------------------------------------------
  // Stablecoin address list cache (1 hr TTL)
  // Key: v2:primitive:stablecoin-addresses
  // ---------------------------------------------------------------------------

  async getStablecoinAddresses(): Promise<Set<string> | null> {
    const key = primitiveKey('stablecoin-addresses');
    // Sets are not JSON-serialisable, so we store as an array and re-hydrate.
    const cached = await this.cacheService.get<string[]>(key);
    if (!cached) return null;
    return new Set(cached);
  }

  async setStablecoinAddresses(addresses: Set<string>): Promise<void> {
    const key = primitiveKey('stablecoin-addresses');
    await this.cacheService.set(key, [...addresses], PRIMITIVE_TTL.STABLECOIN_LIST);
    this.logger.debug(`Cached ${addresses.size} stablecoin addresses`);
  }

  // ---------------------------------------------------------------------------
  // Reader snapshot cache (24 hr TTL — fallback for when fresh reads fail)
  // Key: v2:primitive:reader-snapshot:{reader-name}
  // ---------------------------------------------------------------------------

  async getReaderSnapshot<T>(readerName: string): Promise<ReaderSnapshot<T> | null> {
    const key = primitiveKey('reader-snapshot', readerName);
    const cached = await this.cacheService.get<ReaderSnapshot<T>>(key);
    return cached ?? null;
  }

  async setReaderSnapshot<T>(readerName: string, data: T): Promise<void> {
    const key = primitiveKey('reader-snapshot', readerName);
    const snapshot: ReaderSnapshot<unknown> = { data, timestamp: new Date().toISOString() };
    await this.cacheService.set(key, snapshot, PRIMITIVE_TTL.READER_SNAPSHOT);
    this.logger.debug(`Cached reader snapshot: ${readerName}`);
  }
}
