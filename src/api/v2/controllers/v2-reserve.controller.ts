import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { V2ReserveResponseDto } from '../dto/v2-reserve.dto';
import { V2ReserveService } from '../services/v2-reserve.service';
import { CacheService } from '@common/services/cache.service';
import { V2_CACHE_KEYS } from '@common/constants';

@ApiTags('v2-reserve')
@Controller('api/v2/reserve')
export class V2ReserveController {
  constructor(
    private readonly reserveService: V2ReserveService,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get reserve collateral, LP positions, operational holdings, and CDP troves' })
  @ApiResponse({ status: 200, type: V2ReserveResponseDto })
  async getReserve(): Promise<V2ReserveResponseDto> {
    const cached = await this.cacheService.get<V2ReserveResponseDto>(V2_CACHE_KEYS.RESERVE);
    if (cached) return cached;

    const response = await this.reserveService.getReserve();
    await this.cacheService.set(V2_CACHE_KEYS.RESERVE, response);
    return response;
  }
}
