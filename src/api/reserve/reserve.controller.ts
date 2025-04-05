import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReserveService } from './services/reserve.service';
import {
  ReserveHoldingsResponseDto,
  ReserveCompositionResponseDto,
  ReserveAddressesResponseDto,
  GroupedReserveHoldingsResponseDto,
  ReserveStatsResponseDto,
  AddressGroup,
} from './dto/reserve.dto';
import { RESERVE_ADDRESS_CONFIGS } from './config/addresses.config';
import { StablecoinsService } from '../stablecoins/stablecoins.service';
import { CacheService } from '@common/services/cache.service';
import { CACHE_KEYS } from '@common/constants';
import { createCacheKey } from '@common/config/cache.config';

@ApiTags('reserve')
@Controller('api/v1/reserve')
export class ReserveController {
  constructor(
    private readonly reserveService: ReserveService,
    private readonly stablecoinsService: StablecoinsService,
    private readonly cacheService: CacheService,
  ) {}

  @Get('holdings')
  @ApiOperation({ summary: 'Get detailed information on the reserve holdings' })
  @ApiResponse({
    status: 200,
    description: 'Current reserve holdings by asset',
    type: ReserveHoldingsResponseDto,
  })
  async getReserveHoldings(): Promise<ReserveHoldingsResponseDto> {
    const cached = await this.cacheService.get<ReserveHoldingsResponseDto>(CACHE_KEYS.RESERVE_HOLDINGS);
    if (cached) {
      return cached;
    }

    const holdings = await this.reserveService.getReserveHoldings();
    const total_holdings_usd = holdings.reduce((sum, asset) => sum + asset.usdValue, 0);
    const response = { total_holdings_usd, assets: holdings };

    await this.cacheService.set(CACHE_KEYS.RESERVE_HOLDINGS, response);
    return response;
  }

  @Get('composition')
  @ApiOperation({ summary: 'Get reserve composition percentages' })
  @ApiResponse({
    status: 200,
    description: 'Current reserve composition breakdown',
    type: ReserveCompositionResponseDto,
  })
  async getReserveComposition(): Promise<ReserveCompositionResponseDto> {
    const cached = await this.cacheService.get<ReserveCompositionResponseDto>(CACHE_KEYS.RESERVE_COMPOSITION);
    if (cached) {
      return cached;
    }

    const { total_holdings_usd, assets } = await this.reserveService.getGroupedReserveHoldings();

    const composition = assets.map((asset) => ({
      symbol: asset.symbol,
      percentage: (asset.usdValue / total_holdings_usd) * 100,
      usd_value: asset.usdValue,
    }));

    const response = { composition };
    await this.cacheService.set(CACHE_KEYS.RESERVE_COMPOSITION, response);
    return response;
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Get all reserve addresses' })
  @ApiResponse({
    status: 200,
    description: 'List of all reserve addresses by chain and category',
    type: ReserveAddressesResponseDto,
  })
  async getReserveAddresses(): Promise<ReserveAddressesResponseDto> {
    // Use a separate cache key for addresses
    const cacheKey = createCacheKey('reserve-addresses');
    const cached = await this.cacheService.get<ReserveAddressesResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const groupedAddresses = RESERVE_ADDRESS_CONFIGS.reduce<Record<string, AddressGroup>>((acc, addr) => {
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

    const response = {
      addresses: Object.values(groupedAddresses),
    };

    await this.cacheService.set(cacheKey, response);
    return response;
  }

  @Get('holdings/grouped')
  @ApiOperation({ summary: 'Get grouped reserve holdings by asset' })
  @ApiResponse({
    status: 200,
    description: 'Current reserve holdings grouped by asset',
    type: GroupedReserveHoldingsResponseDto,
  })
  async getGroupedReserveHoldings(): Promise<GroupedReserveHoldingsResponseDto> {
    const cached = await this.cacheService.get<GroupedReserveHoldingsResponseDto>(CACHE_KEYS.RESERVE_HOLDINGS_GROUPED);
    if (cached) {
      return cached;
    }

    const response = await this.reserveService.getGroupedReserveHoldings();
    await this.cacheService.set(CACHE_KEYS.RESERVE_HOLDINGS_GROUPED, response);
    return response;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get reserve statistics including value and collateralization ratio' })
  @ApiResponse({
    status: 200,
    type: ReserveStatsResponseDto,
  })
  async getReserveStats(): Promise<ReserveStatsResponseDto> {
    const cached = await this.cacheService.get<ReserveStatsResponseDto>(CACHE_KEYS.RESERVE_STATS);
    if (cached) {
      return cached;
    }

    // TODO: Move this calculation to a service so it can be reused by the cache warmer
    const { total_holdings_usd: total_reserve_value_usd } = await this.reserveService.getGroupedReserveHoldings();
    const { total_supply_usd: total_outstanding_stables_usd } = await this.stablecoinsService.getStablecoins();

    const response = {
      total_reserve_value_usd,
      total_outstanding_stables_usd,
      collateralization_ratio: total_reserve_value_usd / total_outstanding_stables_usd,
      timestamp: new Date().toISOString(),
    };

    await this.cacheService.set(CACHE_KEYS.RESERVE_STATS, response);
    return response;
  }
}
