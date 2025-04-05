import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ALL_CACHE_KEYS, RAW_TO_PREFIXED_MAP } from '@common/constants';
import { CACHE_CONFIG, createCacheKey } from '@common/config/cache.config';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  /**
   * Get value from cache with proper key handling
   */
  async get<T>(key: string): Promise<T | undefined> {
    const processedKey = this.processKey(key);
    try {
      return await this.cacheManager.get<T>(processedKey);
    } catch (error) {
      this.logger.error(`Failed to get cache for key '${processedKey}'`, error);
      return undefined;
    }
  }

  /**
   * Set value in cache with consistent TTL handling
   */
  async set<T>(key: string, value: T, ttl = CACHE_CONFIG.TTL.DEFAULT): Promise<void> {
    const processedKey = this.processKey(key);
    try {
      await this.cacheManager.set(processedKey, value, ttl);
      this.logger.debug(`Cache set for key '${processedKey}'`);
    } catch (error) {
      this.logger.error(`Failed to set cache for key '${processedKey}'`, error);
    }
  }

  /**
   * Clear a specific cache key
   */
  async clearCacheKey(key: string): Promise<boolean> {
    const processedKey = this.processKey(key);
    try {
      await this.cacheManager.del(processedKey);
      this.logger.log(`Cache key '${processedKey}' cleared successfully`);

      // Try to clear the legacy key version too for backward compatibility
      if (processedKey.includes(CACHE_CONFIG.KEY_PREFIX)) {
        const legacyKey = processedKey.replace(CACHE_CONFIG.KEY_PREFIX, '');
        await this.cacheManager.del(legacyKey);
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to clear cache key '${processedKey}'`, error);
      return false;
    }
  }

  /**
   * Clear all cache keys
   */
  async clearAllCache(): Promise<{ success: boolean; clearedKeys: string[] }> {
    const clearedKeys: string[] = [];
    let hasError = false;

    // Clear new prefixed keys
    await Promise.all(
      ALL_CACHE_KEYS.map(async (key) => {
        try {
          await this.cacheManager.del(key as string);
          clearedKeys.push(key as string);
        } catch (error) {
          hasError = true;
          this.logger.error(`Failed to clear cache key '${key}'`, error);
        }
      }),
    );

    // Also try to clear legacy non-prefixed keys
    for (const rawKey of Object.keys(RAW_TO_PREFIXED_MAP)) {
      try {
        await this.cacheManager.del(rawKey);
        clearedKeys.push(rawKey);
      } catch {
        // No need to log errors for legacy keys
      }
    }

    return {
      success: !hasError,
      clearedKeys,
    };
  }

  /**
   * Check if a key is a known cache key
   */
  public isKnownCacheKey(key: string): boolean {
    const processedKey = this.processKey(key);
    return ALL_CACHE_KEYS.includes(processedKey);
  }

  /**
   * Get all known cache keys
   */
  getKnownCacheKeys(): string[] {
    return ALL_CACHE_KEYS.map((key) => key as string);
  }

  /**
   * Process a cache key to ensure it has proper prefix
   */
  private processKey(key: string): string {
    // If it's a known raw key, use the prefixed version
    if (RAW_TO_PREFIXED_MAP[key]) {
      return RAW_TO_PREFIXED_MAP[key];
    }

    // If it already has our prefix, use it as is
    if (key.startsWith(CACHE_CONFIG.KEY_PREFIX)) {
      return key;
    }

    // Otherwise, add the prefix
    return createCacheKey(key);
  }
}
