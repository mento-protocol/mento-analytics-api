import { Injectable, Logger } from '@nestjs/common';
import { V2OverviewResponseDto } from '../dto/v2-overview.dto';
import { V2StablecoinsService } from './v2-stablecoins.service';
import { V2ReserveService } from './v2-reserve.service';
import { ReserveService } from '@api/reserve/services/reserve.service';

@Injectable()
export class V2OverviewService {
  private readonly logger = new Logger(V2OverviewService.name);

  constructor(
    private readonly v2StablecoinsService: V2StablecoinsService,
    private readonly v2ReserveService: V2ReserveService,
    private readonly reserveService: ReserveService,
  ) {}

  async getOverview(): Promise<V2OverviewResponseDto> {
    const [stablecoinsData, reserveData, groupedHoldings] = await Promise.all([
      this.v2StablecoinsService.getStablecoins(),
      this.v2ReserveService.getReserve(),
      this.reserveService.getGroupedReserveHoldings(),
    ]);

    // Calculate supply decomposition
    const reserveBackedCoins = stablecoinsData.stablecoins.filter((c) => c.backing_type === 'reserve');
    const cdpBackedCoins = stablecoinsData.stablecoins.filter((c) => c.backing_type === 'cdp');

    const reserveDebtUsd = reserveBackedCoins.reduce((sum, c) => sum + c.supply.debt_usd, 0);
    const cdpDebtUsd = cdpBackedCoins.reduce((sum, c) => sum + c.supply.debt_usd, 0);
    const reserveHeldUsd = stablecoinsData.stablecoins.reduce((sum, c) => sum + c.supply.reserve_held_usd, 0);
    const lostUsd = stablecoinsData.stablecoins.reduce((sum, c) => sum + c.supply.lost_usd, 0);

    // Reserve backing: collateral from reserve holdings, debt from reserve-backed stablecoins
    const reserveCollateralUsd = groupedHoldings.total_holdings_usd;
    const reserveRatio = reserveDebtUsd > 0 ? reserveCollateralUsd / reserveDebtUsd : 0;

    // CDP backings from reserve data
    const cdpBackings = reserveData.cdp_troves.troves.map((trove) => ({
      stablecoin: trove.stablecoin,
      collateral_token: trove.collateral_token,
      collateral_usd: trove.collateral_usd,
      collateral_amount: trove.collateral_amount,
      debt_usd: trove.debt_usd,
      debt_amount: trove.debt_amount,
      ratio: trove.ratio,
      status: trove.status,
      chain: trove.chain,
    }));

    return {
      supply: {
        total_usd: stablecoinsData.total_supply_usd,
        debt_usd: reserveDebtUsd + cdpDebtUsd,
        reserve_debt_usd: reserveDebtUsd,
        cdp_debt_usd: cdpDebtUsd,
        reserve_held_usd: reserveHeldUsd,
        lost_usd: lostUsd,
        stablecoin_count: stablecoinsData.stablecoins.length,
      },
      reserve_backing: {
        collateral_usd: reserveCollateralUsd,
        debt_usd: reserveDebtUsd,
        ratio: reserveRatio,
        stablecoin_count: reserveBackedCoins.length,
      },
      cdp_backings: cdpBackings,
      timestamp: new Date().toISOString(),
    };
  }
}
