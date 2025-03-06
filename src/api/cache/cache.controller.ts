import { Controller, Get, Delete, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { CacheService } from '@common/services/cache.service';

class CacheClearResponse {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: ['reserve-holdings', 'stablecoins'] })
  clearedKeys?: string[];

  @ApiProperty({ example: 'Cache key not found' })
  message?: string;
}

@ApiTags('cache')
@Controller('api/v1/cache')
export class CacheController {
  constructor(private readonly cacheService: CacheService) {}

  @Delete('clear-all')
  @ApiOperation({ summary: 'Clear all cache keys' })
  @ApiResponse({
    status: 200,
    description: 'All cache keys have been cleared',
    type: CacheClearResponse,
  })
  async clearAllCache(): Promise<CacheClearResponse> {
    const result = await this.cacheService.clearAllCache();
    return {
      success: result.success,
      clearedKeys: result.clearedKeys,
    };
  }

  @Delete('clear/:key')
  @ApiOperation({ summary: 'Clear a specific cache key' })
  @ApiResponse({
    status: 200,
    description: 'Cache key cleared successfully',
    type: CacheClearResponse,
  })
  async clearCacheKey(@Param('key') key: string): Promise<CacheClearResponse> {
    if (!this.cacheService.isKnownCacheKey(key)) {
      return {
        success: false,
        message: `Unknown cache key: ${key}. Available keys: ${this.cacheService.getKnownCacheKeys().join(', ')}`,
      };
    }

    const success = await this.cacheService.clearCacheKey(key);
    return {
      success,
      clearedKeys: success ? [key] : [],
    };
  }

  @Get('keys')
  @ApiOperation({ summary: 'Get all available cache keys' })
  @ApiResponse({
    status: 200,
    description: 'List of all available cache keys',
  })
  getAvailableCacheKeys() {
    return {
      keys: this.cacheService.getKnownCacheKeys(),
    };
  }
}
