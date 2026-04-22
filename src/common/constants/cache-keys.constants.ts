import { Chain } from '@types';
import { createCacheKey } from '../config/cache.config';

/**
 * Raw key names for reference
 */
const RAW_KEYS = {
  RESERVE_HOLDINGS: 'reserve-holdings',
  RESERVE_COMPOSITION: 'reserve-composition',
  RESERVE_HOLDINGS_GROUPED: 'reserve-holdings-grouped',
  RESERVE_STATS: 'reserve-stats',
  STABLECOINS: 'stablecoins',
  HEALTH: 'health',
};

/**
 * Cache keys with prefix applied
 */
export const CACHE_KEYS = {
  RESERVE_HOLDINGS: createCacheKey(RAW_KEYS.RESERVE_HOLDINGS),
  RESERVE_COMPOSITION: createCacheKey(RAW_KEYS.RESERVE_COMPOSITION),
  RESERVE_HOLDINGS_GROUPED: createCacheKey(RAW_KEYS.RESERVE_HOLDINGS_GROUPED),
  RESERVE_STATS: createCacheKey(RAW_KEYS.RESERVE_STATS),
  STABLECOINS: createCacheKey(RAW_KEYS.STABLECOINS),
  HEALTH: createCacheKey(RAW_KEYS.HEALTH),

  // Chain-specific cache keys
  RESERVE_HOLDINGS_FOR_CHAIN: (chain: Chain) => createCacheKey(`${RAW_KEYS.RESERVE_HOLDINGS}-${chain}`),
};

/**
 * v2 raw key names
 */
const V2_RAW_KEYS = {
  OVERVIEW: 'v2-overview',
  STABLECOINS: 'v2-stablecoins',
  RESERVE: 'v2-reserve',
  ADDRESSES: 'v2-addresses',
  SUPPLY_BREAKDOWN: 'v2-supply-breakdown',
};

/**
 * v2 cache keys with prefix applied
 */
export const V2_CACHE_KEYS = {
  OVERVIEW: createCacheKey(V2_RAW_KEYS.OVERVIEW),
  STABLECOINS: createCacheKey(V2_RAW_KEYS.STABLECOINS),
  RESERVE: createCacheKey(V2_RAW_KEYS.RESERVE),
  ADDRESSES: createCacheKey(V2_RAW_KEYS.ADDRESSES),
  SUPPLY_BREAKDOWN: createCacheKey(V2_RAW_KEYS.SUPPLY_BREAKDOWN),
};

/**
 * Array of all known cache keys for iteration
 */
export const ALL_CACHE_KEYS = [...Object.values(CACHE_KEYS), ...Object.values(V2_CACHE_KEYS)];

/**
 * Mapping raw keys to prefixed keys for backward compatibility
 */
export const RAW_TO_PREFIXED_MAP: Record<string, string> = {
  [RAW_KEYS.RESERVE_HOLDINGS]: CACHE_KEYS.RESERVE_HOLDINGS,
  [RAW_KEYS.RESERVE_COMPOSITION]: CACHE_KEYS.RESERVE_COMPOSITION,
  [RAW_KEYS.RESERVE_HOLDINGS_GROUPED]: CACHE_KEYS.RESERVE_HOLDINGS_GROUPED,
  [RAW_KEYS.RESERVE_STATS]: CACHE_KEYS.RESERVE_STATS,
  [RAW_KEYS.STABLECOINS]: CACHE_KEYS.STABLECOINS,
  [RAW_KEYS.HEALTH]: CACHE_KEYS.HEALTH,
};
