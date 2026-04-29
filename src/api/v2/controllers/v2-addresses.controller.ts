import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { V2AddressesResponseDto } from '../dto/v2-addresses.dto';
import { V2AddressesService } from '../services/v2-addresses.service';
import { V2CacheWarmerService } from '../services/v2-cache-warmer.service';
import { V2_CACHE_KEYS } from '@common/constants';

@ApiTags('v2-addresses')
@Controller('api/v2/addresses')
export class V2AddressesController {
  constructor(
    private readonly addressesService: V2AddressesService,
    private readonly cacheWarmerService: V2CacheWarmerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get reserve addresses with chain and custodian metadata' })
  @ApiResponse({ status: 200, type: V2AddressesResponseDto })
  async getAddresses(): Promise<V2AddressesResponseDto> {
    return this.cacheWarmerService.getOrRevalidate<V2AddressesResponseDto>(V2_CACHE_KEYS.ADDRESSES, () =>
      Promise.resolve(this.addressesService.getAddresses()),
    );
  }
}
