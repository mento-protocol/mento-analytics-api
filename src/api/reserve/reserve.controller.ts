import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReserveService } from './services/reserve.service';
import {
  ReserveHoldingsResponseDto,
  ReserveCompositionResponseDto,
  ReserveAddressesResponseDto,
  GroupedReserveHoldingsResponseDto,
} from './dto/reserve.dto';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { RESERVE_ADDRESS_CONFIGS } from './config/addresses.config';

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
    // Group addresses by network and category
    const groupedAddresses = RESERVE_ADDRESS_CONFIGS.reduce((acc, addr) => {
      // Create a key for the group
      const key = `${addr.chain}-${addr.category}`;

      // If the key doesn't exist, create it and initialize the array
      if (!acc[key]) {
        acc[key] = {
          network: addr.chain,
          category: addr.category,
          addresses: [],
        };
      }

      // Add the address to the array for the group with the same key
      acc[key].addresses.push({
        address: addr.address,
        label: addr.label,
      });
      return acc;
    }, {});

    // Return the grouped addresses
    return {
      addresses: Object.values(groupedAddresses),
    };
  }

  @Get('holdings/grouped')
  @CacheTTL(300)
  @ApiOperation({ summary: 'Get grouped reserve holdings by asset' })
  @ApiResponse({
    status: 200,
    description: 'Current reserve holdings grouped by asset',
    type: GroupedReserveHoldingsResponseDto,
  })
  async getGroupedReserveHoldings(): Promise<GroupedReserveHoldingsResponseDto> {
    return this.reserveService.getGroupedReserveHoldings();
  }
}
