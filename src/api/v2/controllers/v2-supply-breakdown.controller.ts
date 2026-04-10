import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { V2SupplyBreakdownResponseDto } from '../dto/v2-supply-breakdown.dto';
import { V2SupplyBreakdownService } from '../services/v2-supply-breakdown.service';
import { CacheService } from '@common/services/cache.service';
import { V2_CACHE_KEYS } from '@common/constants';

@ApiTags('v2-supply')
@Controller('api/v2/supply')
export class V2SupplyBreakdownController {
  constructor(
    private readonly breakdownService: V2SupplyBreakdownService,
    private readonly cacheService: CacheService,
  ) {}

  @Get('breakdown')
  @ApiOperation({ summary: 'Get hierarchical supply breakdown tree for visualizations' })
  @ApiResponse({ status: 200, type: V2SupplyBreakdownResponseDto })
  async getBreakdown(): Promise<V2SupplyBreakdownResponseDto> {
    const cached = await this.cacheService.get<V2SupplyBreakdownResponseDto>(V2_CACHE_KEYS.SUPPLY_BREAKDOWN);
    if (cached) return cached;

    const response = await this.breakdownService.getBreakdown();
    await this.cacheService.set(V2_CACHE_KEYS.SUPPLY_BREAKDOWN, response);
    return response;
  }
}
