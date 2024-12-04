import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReserveService } from './services/reserve.service';
import {
  ReserveHoldingsResponseDto,
  ReserveCompositionResponseDto,
  ReserveAddressesResponseDto,
  GroupedReserveHoldingsResponseDto,
  ReserveStatsResponseDto,
} from './dto/reserve.dto';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { RESERVE_ADDRESS_CONFIGS } from './config/addresses.config';
import { StablecoinsService } from '../stablecoins/stablecoins.service';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';

@ApiTags('reserve')
@Controller('api/v1/reserve')
@UseInterceptors(CacheInterceptor)
export class ReserveController {
  constructor(
    private readonly reserveService: ReserveService,
    private readonly stablecoinsService: StablecoinsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  @Get('holdings')
  @CacheTTL(300)
  @ApiOperation({ summary: 'Get detailed information on the reserve holdings' })
  @ApiResponse({
    status: 200,
    description: 'Current reserve holdings by asset',
    type: ReserveHoldingsResponseDto,
  })
  async getReserveHoldings(): Promise<ReserveHoldingsResponseDto> {
    const cached = await this.cacheManager.get('reserve-holdings');
    if (cached) {
      return cached as ReserveHoldingsResponseDto;
    }

    const holdings = await this.reserveService.getReserveHoldings();
    const total_holdings_usd = holdings.reduce((sum, asset) => sum + asset.usdValue, 0);
    const response = { total_holdings_usd, assets: holdings };

    return response;
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
    const cached = await this.cacheManager.get('reserve-composition');
    if (cached) {
      return cached as ReserveCompositionResponseDto;
    }

    const { total_holdings_usd, assets } = await this.reserveService.getGroupedReserveHoldings();

    const composition = assets.map((asset) => ({
      symbol: asset.symbol,
      percentage: (asset.usdValue / total_holdings_usd) * 100,
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
    const groupedAddresses = RESERVE_ADDRESS_CONFIGS.reduce((acc, addr) => {
      const key = `${addr.chain}-${addr.category}`;

      if (!acc[key]) {
        acc[key] = {
          network: addr.chain,
          category: addr.category,
          addresses: [],
        };
      }

      acc[key].addresses.push({
        address: addr.address,
        label: addr.label,
      });
      return acc;
    }, {});

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
    const cached = await this.cacheManager.get('reserve-holdings-grouped');
    if (cached) {
      return cached as GroupedReserveHoldingsResponseDto;
    }

    return await this.reserveService.getGroupedReserveHoldings();
  }

  @Get('stats')
  @CacheTTL(300)
  @ApiOperation({ summary: 'Get reserve statistics including value and collateralization ratio' })
  @ApiResponse({
    status: 200,
    type: ReserveStatsResponseDto,
  })
  async getReserveStats(): Promise<ReserveStatsResponseDto> {
    const cached = await this.cacheManager.get('reserve-stats');
    if (cached) {
      return cached as ReserveStatsResponseDto;
    }

    const { total_holdings_usd: total_reserve_value_usd } = await this.reserveService.getGroupedReserveHoldings();
    const { total_supply_usd: total_outstanding_stables_usd } = await this.stablecoinsService.getStablecoins();

    return {
      total_reserve_value_usd,
      total_outstanding_stables_usd,
      collateralization_ratio: total_reserve_value_usd / total_outstanding_stables_usd,
      timestamp: new Date().toISOString(),
    };
  }
}
