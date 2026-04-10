import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { V2AddressesResponseDto } from '../dto/v2-addresses.dto';
import { V2AddressesService } from '../services/v2-addresses.service';
import { CacheService } from '@common/services/cache.service';
import { V2_CACHE_KEYS } from '@common/constants';

@ApiTags('v2-addresses')
@Controller('api/v2/addresses')
export class V2AddressesController {
  constructor(
    private readonly addressesService: V2AddressesService,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get reserve addresses grouped by network and category' })
  @ApiResponse({ status: 200, type: V2AddressesResponseDto })
  async getAddresses(): Promise<V2AddressesResponseDto> {
    const cached = await this.cacheService.get<V2AddressesResponseDto>(V2_CACHE_KEYS.ADDRESSES);
    if (cached) return cached;

    const response = this.addressesService.getAddresses();
    await this.cacheService.set(V2_CACHE_KEYS.ADDRESSES, response);
    return response;
  }
}
