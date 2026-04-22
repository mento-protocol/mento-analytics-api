import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { V2StablecoinsResponseDto } from '../dto/v2-stablecoins.dto';
import { V2StablecoinsService } from '../services/v2-stablecoins.service';
import { V2CacheWarmerService } from '../services/v2-cache-warmer.service';
import { V2_CACHE_KEYS } from '@common/constants';

@ApiTags('v2-stablecoins')
@Controller('api/v2/stablecoins')
export class V2StablecoinsController {
  constructor(
    private readonly stablecoinsService: V2StablecoinsService,
    private readonly cacheWarmerService: V2CacheWarmerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all stablecoins with decomposed supply, backing type, and networks' })
  @ApiResponse({ status: 200, type: V2StablecoinsResponseDto })
  async getStablecoins(): Promise<V2StablecoinsResponseDto> {
    return this.cacheWarmerService.getOrRevalidate<V2StablecoinsResponseDto>(V2_CACHE_KEYS.STABLECOINS, () =>
      this.stablecoinsService.getStablecoins(),
    );
  }
}
