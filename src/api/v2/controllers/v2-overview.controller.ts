import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { V2OverviewResponseDto } from '../dto/v2-overview.dto';
import { V2OverviewService } from '../services/v2-overview.service';
import { CacheService } from '@common/services/cache.service';
import { V2_CACHE_KEYS } from '@common/constants';

@ApiTags('v2-overview')
@Controller('api/v2/overview')
export class V2OverviewController {
  constructor(
    private readonly overviewService: V2OverviewService,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get overview with supply decomposition and backing mechanisms' })
  @ApiResponse({ status: 200, type: V2OverviewResponseDto })
  async getOverview(): Promise<V2OverviewResponseDto> {
    const cached = await this.cacheService.get<V2OverviewResponseDto>(V2_CACHE_KEYS.OVERVIEW);
    if (cached) return cached;

    const response = await this.overviewService.getOverview();
    await this.cacheService.set(V2_CACHE_KEYS.OVERVIEW, response);
    return response;
  }
}
