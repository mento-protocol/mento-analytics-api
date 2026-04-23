import { Injectable, Logger } from '@nestjs/common';
import {
  V2ReserveResponseDto,
  V2LpPositionsDto,
  V2LpPositionDto,
  V2OperationalHoldingsDto,
  V2CdpTrovesDto,
  V2CdpTroveDto,
} from '../dto/v2-reserve.dto';
import { buildMeta } from '../dto/v2-meta.dto';
import { V2PositionsService, PositionsResult } from './v2-positions.service';
import { Chain } from '@types';

/**
 * V2 Reserve service — thin layer over V2PositionsService.
 * All data comes from the single getPositions() call; this service
 * just reshapes it into the response DTO.
 */
@Injectable()
export class V2ReserveService {
  private readonly logger = new Logger(V2ReserveService.name);

  constructor(private readonly v2PositionsService: V2PositionsService) {}

  async getReserve(): Promise<V2ReserveResponseDto> {
    const result = await this.v2PositionsService.getPositions();

    return {
      collateral: result.collateral,
      reserve_held_supply: result.reserve_held_supply,
      lp_positions: this.buildLpPositions(result),
      operational_holdings: this.buildOperationalHoldings(result),
      cdp_troves: this.buildCdpTroves(result),
      positions: result.positions as any,
      meta: buildMeta(result.warnings),
    };
  }

  /**
   * Build LP positions from FPMM + UniV3 position data.
   * reserve_liquidity_usd is the total USD value of both sides of the position.
   */
  private buildLpPositions(result: PositionsResult): V2LpPositionsDto {
    const positions: V2LpPositionDto[] = [];
    const price = (sym: string, amount: number) => amount * (result.priceMap.get(sym) ?? 0);

    // FPMM positions
    for (const pos of result.positions.fpmm_positions) {
      const debtUsd = price(pos.debt_token.symbol, pos.debt_token.amount);
      const collUsd = price(pos.collateral_token.symbol, pos.collateral_token.amount);
      positions.push({
        pool_name: pos.pool_name,
        pool_type: 'FPMM',
        chain: pos.chain,
        reserve_liquidity_usd: debtUsd + collUsd,
        token_a: { symbol: pos.debt_token.symbol, amount: pos.debt_token.amount.toFixed(2) },
        token_b: { symbol: pos.collateral_token.symbol, amount: pos.collateral_token.amount.toFixed(2) },
        pool_share_pct: pos.lp_share_pct,
      });
    }

    // UniV3 positions
    for (const pos of result.positions.univ3_positions) {
      const amount0 = Number(pos.token0.amount);
      const amount1 = Number(pos.token1.amount);
      positions.push({
        pool_name: `${pos.token0.symbol} / ${pos.token1.symbol}`,
        pool_type: 'Uniswap V3',
        chain: pos.chain,
        reserve_liquidity_usd: price(pos.token0.symbol, amount0) + price(pos.token1.symbol, amount1),
        token_a: { symbol: pos.token0.symbol, amount: pos.token0.amount },
        token_b: { symbol: pos.token1.symbol, amount: pos.token1.amount },
        pool_share_pct: 0,
      });
    }

    const total_usd = positions.reduce((sum, p) => sum + p.reserve_liquidity_usd, 0);
    return { total_usd, positions };
  }

  /**
   * Build operational holdings from wallet balances that are mento stablecoins.
   */
  private buildOperationalHoldings(result: PositionsResult): V2OperationalHoldingsDto {
    const holdings = result.positions.wallet_balances
      .filter((wb) => wb.is_mento_stable && Number(wb.balance) > 0)
      .map((wb) => ({
        token: wb.token,
        chain: wb.chain as Chain,
        wallet_label: wb.label,
        balance: wb.balance,
        usd_value: wb.usd_value,
      }));

    const total_usd = holdings.reduce((sum, h) => sum + h.usd_value, 0);
    return { total_usd, holdings };
  }

  /**
   * Build CDP troves DTO from position reader data.
   */
  private buildCdpTroves(result: PositionsResult): V2CdpTrovesDto {
    const troves: V2CdpTroveDto[] = result.positions.cdp_troves.map((t) => ({
      trove_id: t.trove_id,
      owner: t.owner,
      owner_label: t.owner_label,
      stablecoin: t.debt_token,
      collateral_token: t.collateral_token,
      collateral_amount: t.collateral_amount,
      collateral_usd: t.collateral_usd,
      debt_amount: t.debt_amount,
      debt_usd: t.debt_usd,
      ratio: t.ratio,
      annual_interest_rate: t.annual_interest_rate,
      liquidation_price: 0,
      status: t.status,
      chain: t.chain,
      contract_address: t.contract_address,
      overhead: t.overhead,
    }));

    const total_collateral_usd = troves.reduce((sum, t) => sum + t.collateral_usd, 0);
    const total_debt_usd = troves.reduce((sum, t) => sum + t.debt_usd, 0);

    return { total_collateral_usd, total_debt_usd, troves };
  }
}
