import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { V2SupplyBreakdownResponseDto } from '../dto/v2-supply-breakdown.dto';
import { V2SupplyBreakdownService } from '../services/v2-supply-breakdown.service';
import { V2CacheWarmerService } from '../services/v2-cache-warmer.service';
import { V2_CACHE_KEYS } from '@common/constants';

@ApiTags('v2-supply')
@Controller('api/v2/supply')
export class V2SupplyBreakdownController {
  constructor(
    private readonly breakdownService: V2SupplyBreakdownService,
    private readonly cacheWarmerService: V2CacheWarmerService,
  ) {}

  @Get('breakdown')
  @ApiOperation({ summary: 'Get hierarchical supply breakdown tree for visualizations' })
  @ApiResponse({ status: 200, type: V2SupplyBreakdownResponseDto })
  async getBreakdown(): Promise<V2SupplyBreakdownResponseDto> {
    return this.cacheWarmerService.getOrRevalidate<V2SupplyBreakdownResponseDto>(V2_CACHE_KEYS.SUPPLY_BREAKDOWN, () =>
      this.breakdownService.getBreakdown(),
    );
  }
}
