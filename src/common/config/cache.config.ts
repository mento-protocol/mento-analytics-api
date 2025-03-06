/**
 * Centralized cache configuration for the application
 */
export const CACHE_CONFIG = {
  /**
   * Standard TTLs in milliseconds
   */
  TTL: {
    DEFAULT: 60 * 60 * 1000, // 1 hour
    SHORT: 30 * 60 * 1000, // 30 minutes
    MEDIUM: 45 * 60 * 1000, // 45 minutes
    LONG: 2 * 60 * 60 * 1000, // 2 hours
    WARM: 3 * 60 * 60 * 1000 + 15 * 60 * 1000, // 3h15m (warming TTL)
  },
  /**
   * Cache key prefix to avoid naming collisions
   */
  KEY_PREFIX: 'mento-analytics:',
};

/**
 * Helper function to ensure cache keys have the proper prefix
 */
export const createCacheKey = (key: string): string => {
  return key.startsWith(CACHE_CONFIG.KEY_PREFIX) ? key : `${CACHE_CONFIG.KEY_PREFIX}${key}`;
};
