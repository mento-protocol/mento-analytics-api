import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReserveService } from './reserve.service';
import {
  ReserveHoldingsResponseDto,
  ReserveCompositionResponseDto,
  ReserveAddressesResponseDto,
} from './dto/reserve.dto';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { RESERVE_ADDRESSES } from './config/addresses.config';

@ApiTags('reserve')
@Controller('api/v1/reserve')
@UseInterceptors(CacheInterceptor)
export class ReserveController {
  constructor(private readonly reserveService: ReserveService) {}

  @Get('holdings')
  @CacheTTL(300)
  @ApiOperation({ summary: 'Get reserve holdings across all chains' })
  @ApiResponse({
    status: 200,
    description: 'Current reserve holdings by asset',
    type: ReserveHoldingsResponseDto,
  })
  async getReserveHoldings(): Promise<ReserveHoldingsResponseDto> {
    const holdings = await this.reserveService.getReserveHoldings();
    const total_holdings_usd = holdings.reduce((sum, asset) => sum + asset.usdValue, 0);

    return {
      total_holdings_usd,
      assets: holdings,
    };
  }

  @Get('composition')
  @CacheTTL(300)
  @ApiOperation({ summary: 'Get reserve composition percentages' })
  @ApiResponse({
    status: 200,
    description: 'Current reserve composition breakdown',
    type: ReserveCompositionResponseDto,
  })
  async getReserveComposition(): Promise<ReserveCompositionResponseDto> {
    const holdings = await this.reserveService.getReserveHoldings();
    const total_value = holdings.reduce((sum, asset) => sum + asset.usdValue, 0);

    const composition = holdings.map((asset) => ({
      symbol: asset.symbol,
      percentage: (asset.usdValue / total_value) * 100,
      usd_value: asset.usdValue,
    }));

    return { composition };
  }

  @Get('addresses')
  @CacheTTL(300)
  @ApiOperation({ summary: 'Get all reserve addresses' })
  @ApiResponse({
    status: 200,
    description: 'List of all reserve addresses by chain and category',
    type: ReserveAddressesResponseDto,
  })
  getReserveAddresses(): ReserveAddressesResponseDto {
    return {
      addresses: RESERVE_ADDRESSES.map((addr) => ({
        network: addr.chain,
        category: addr.category,
        addresses: [
          {
            address: addr.address,
            label: addr.label,
          },
        ],
      })),
    };
  }
}
