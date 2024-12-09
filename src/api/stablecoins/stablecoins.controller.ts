import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StablecoinsService } from './stablecoins.service';
import { StablecoinsResponseDto } from './dto/stablecoin.dto';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';

@ApiTags('stablecoins')
@Controller('api/v1/stablecoins')
@UseInterceptors(CacheInterceptor)
export class StablecoinsController {
  constructor(
    private readonly stablecoinsService: StablecoinsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all stablecoins' })
  @ApiResponse({
    status: 200,
    description: 'List of all stablecoins with their supply information',
    type: StablecoinsResponseDto,
  })
  async getStablecoins(): Promise<StablecoinsResponseDto> {
    const cached = await this.cacheManager.get('stablecoins');
    if (cached) {
      return cached as StablecoinsResponseDto;
    }

    const response = await this.stablecoinsService.getStablecoins();
    return response;
  }
}
