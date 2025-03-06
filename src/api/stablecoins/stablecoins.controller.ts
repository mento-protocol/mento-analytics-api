import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { StablecoinsService } from './stablecoins.service';
import { StablecoinsResponseDto } from './dto/stablecoin.dto';
import { CacheService } from '@common/services/cache.service';
import { CACHE_KEYS } from '@common/constants';

@ApiTags('stablecoins')
@Controller('api/v1/stablecoins')
export class StablecoinsController {
  constructor(
    private readonly stablecoinsService: StablecoinsService,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all stablecoins' })
  @ApiResponse({
    status: 200,
    description: 'List of all stablecoins with their supply information',
    type: StablecoinsResponseDto,
  })
  async getStablecoins(): Promise<StablecoinsResponseDto> {
    const cached = await this.cacheService.get<StablecoinsResponseDto>(CACHE_KEYS.STABLECOINS);
    if (cached) {
      return cached;
    }

    const response = await this.stablecoinsService.getStablecoins();
    await this.cacheService.set(CACHE_KEYS.STABLECOINS, response);
    return response;
  }
}
