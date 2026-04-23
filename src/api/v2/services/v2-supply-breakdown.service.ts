import { Injectable, Logger } from '@nestjs/common';
import { V2SupplyBreakdownResponseDto, V2SupplyBreakdownNodeDto } from '../dto/v2-supply-breakdown.dto';
import { buildMeta, DataWarning } from '../dto/v2-meta.dto';
import { V2StablecoinsService } from './v2-stablecoins.service';
import { V2ReserveService } from './v2-reserve.service';

@Injectable()
export class V2SupplyBreakdownService {
  private readonly logger = new Logger(V2SupplyBreakdownService.name);

  constructor(
    private readonly v2StablecoinsService: V2StablecoinsService,
    private readonly v2ReserveService: V2ReserveService,
  ) {}

  async getBreakdown(): Promise<V2SupplyBreakdownResponseDto> {
    const [stablecoinsData, reserveData] = await Promise.all([
      this.v2StablecoinsService.getStablecoins(),
      this.v2ReserveService.getReserve(),
    ]);

    const reserveCoins = stablecoinsData.stablecoins.filter((c) => c.backing_type === 'reserve');
    const cdpCoins = stablecoinsData.stablecoins.filter((c) => c.backing_type === 'cdp');

    // Build the tree
    const reserveDebtUsd = reserveCoins.reduce((sum, c) => sum + c.supply.debt_usd, 0);
    const cdpDebtUsd = cdpCoins.reduce((sum, c) => sum + c.supply.debt_usd, 0);
    const reserveHeldUsd = stablecoinsData.stablecoins.reduce((sum, c) => sum + c.supply.reserve_held_usd, 0);
    const lostUsd = stablecoinsData.stablecoins.reduce((sum, c) => sum + c.supply.lost_usd, 0);

    // Reserve debt children: circulating per-token
    const circulatingChildren: V2SupplyBreakdownNodeDto[] = reserveCoins
      .filter((c) => c.supply.debt_usd > 0)
      .sort((a, b) => b.supply.debt_usd - a.supply.debt_usd)
      .map((c) => ({
        id: `circulating_${c.symbol}`,
        label: c.symbol,
        value_usd: c.supply.debt_usd,
      }));

    // CDP collateral (USDm locked in CDPs)
    const cdpCollateralUsd = reserveData.cdp_troves.total_collateral_usd;
    const cdpCollateralChildren: V2SupplyBreakdownNodeDto[] = reserveData.cdp_troves.troves
      .filter((t) => t.collateral_usd > 0)
      .map((t) => ({
        id: `cdp_col_${t.stablecoin}`,
        label: `${t.collateral_amount} ${t.collateral_token} → backs ${t.stablecoin}`,
        value_usd: t.collateral_usd,
      }));

    const reserveDebtNode: V2SupplyBreakdownNodeDto = {
      id: 'reserve_debt',
      label: 'Reserve Debt',
      value_usd: reserveDebtUsd + cdpCollateralUsd,
      children: [
        {
          id: 'circulating',
          label: 'Circulating',
          value_usd: reserveDebtUsd,
          children: circulatingChildren.length > 0 ? circulatingChildren : undefined,
        },
        ...(cdpCollateralUsd > 0
          ? [
              {
                id: 'cdp_collateral',
                label: 'CDP Collateral',
                value_usd: cdpCollateralUsd,
                children: cdpCollateralChildren.length > 0 ? cdpCollateralChildren : undefined,
              },
            ]
          : []),
      ],
    };

    // CDP debt children
    const cdpDebtChildren: V2SupplyBreakdownNodeDto[] = cdpCoins
      .filter((c) => c.supply.debt_usd > 0)
      .map((c) => ({
        id: `cdp_debt_${c.symbol}`,
        label: c.symbol,
        value_usd: c.supply.debt_usd,
      }));

    // Reserve held children: LP positions + wallet holdings
    const lpTotal = reserveData.lp_positions.total_usd;
    const walletTotal = reserveData.operational_holdings.total_usd;

    const lpChildren: V2SupplyBreakdownNodeDto[] = reserveData.lp_positions.positions.map((p, i) => ({
      id: `lp_${i}`,
      label: `${p.pool_name} (${p.chain})`,
      value_usd: p.reserve_liquidity_usd,
    }));

    const walletChildren: V2SupplyBreakdownNodeDto[] = reserveData.operational_holdings.holdings.map((h, i) => ({
      id: `wallet_${i}`,
      label: h.token,
      value_usd: h.usd_value,
    }));

    const reserveHeldNode: V2SupplyBreakdownNodeDto = {
      id: 'reserve_held',
      label: 'Reserve Held',
      value_usd: reserveHeldUsd,
      children: [
        ...(lpTotal > 0
          ? [
              {
                id: 'lp_positions',
                label: 'LP Positions',
                value_usd: lpTotal,
                children: lpChildren.length > 0 ? lpChildren : undefined,
              },
            ]
          : []),
        ...(walletTotal > 0
          ? [
              {
                id: 'wallet_holdings',
                label: 'Wallet Holdings',
                value_usd: walletTotal,
                children: walletChildren.length > 0 ? walletChildren : undefined,
              },
            ]
          : []),
      ],
    };

    const breakdown: V2SupplyBreakdownNodeDto = {
      id: 'total',
      label: 'Total Supply',
      value_usd: stablecoinsData.total_supply_usd,
      children: [
        reserveDebtNode,
        ...(cdpDebtUsd > 0
          ? [
              {
                id: 'cdp_debt',
                label: 'CDP Debt',
                value_usd: cdpDebtUsd,
                children: cdpDebtChildren.length > 0 ? cdpDebtChildren : undefined,
              },
            ]
          : []),
        ...(reserveHeldUsd > 0 ? [reserveHeldNode] : []),
        ...(lostUsd > 0
          ? [
              {
                id: 'lost',
                label: 'Lost / Inaccessible',
                value_usd: lostUsd,
              },
            ]
          : []),
      ],
    };

    // Merge warnings from both upstream services
    const warnings: DataWarning[] = [...(stablecoinsData.meta?.warnings ?? []), ...(reserveData.meta?.warnings ?? [])];
    // Deduplicate by source (both services share the same positions data)
    const seen = new Set<string>();
    const uniqueWarnings = warnings.filter((w) => {
      if (seen.has(w.source)) return false;
      seen.add(w.source);
      return true;
    });

    return { breakdown, meta: buildMeta(uniqueWarnings) };
  }
}
