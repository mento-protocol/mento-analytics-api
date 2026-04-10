import { Injectable, Logger } from '@nestjs/common';
import { ReserveService } from '@api/reserve/services/reserve.service';
import { RESERVE_ADDRESS_CONFIGS } from '@api/reserve/config/addresses.config';
import { StablecoinAdjustmentsService } from '@api/stablecoins/services/stablecoin-adjustments.service';
import { MentoService } from '@common/services/mento.service';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { ChainClientService } from '@common/services/chain-client.service';
import {
  V2ReserveResponseDto,
  V2CollateralDto,
  V2LpPositionsDto,
  V2OperationalHoldingsDto,
  V2CdpTrovesDto,
  V2CdpTroveDto,
} from '../dto/v2-reserve.dto';
import { CDP_TROVE_CONFIGS, CDP_CONTRACTS, TROVE_MANAGER_ABI } from '../config/cdp.config';
import { FpmmPositionsService, FpmmPosition } from './fpmm-positions.service';
import { Chain } from '@types';
import { formatUnits } from 'viem';

@Injectable()
export class V2ReserveService {
  private readonly logger = new Logger(V2ReserveService.name);

  constructor(
    private readonly reserveService: ReserveService,
    private readonly adjustmentsService: StablecoinAdjustmentsService,
    private readonly mentoService: MentoService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly chainClientService: ChainClientService,
    private readonly fpmmPositionsService: FpmmPositionsService,
  ) {}

  async getReserve(): Promise<V2ReserveResponseDto> {
    const [collateral, lpPositions, operationalHoldings, cdpTroves] = await Promise.all([
      this.getCollateral(),
      this.getLpPositions(),
      this.getOperationalHoldings(),
      this.getCdpTroves(),
    ]);

    return { collateral, lp_positions: lpPositions, operational_holdings: operationalHoldings, cdp_troves: cdpTroves };
  }

  private async getCollateral(): Promise<V2CollateralDto> {
    const { total_holdings_usd, assets } = await this.reserveService.getGroupedReserveHoldings();

    const collateralAssets = assets.map((asset) => {
      const addressConfig = RESERVE_ADDRESS_CONFIGS.find((cfg) =>
        cfg.assets.includes(asset.symbol as (typeof cfg.assets)[number]),
      );

      return {
        symbol: asset.symbol,
        chain: addressConfig?.chain ?? Chain.CELO,
        balance: asset.totalBalance,
        usd_value: asset.usdValue,
        percentage: total_holdings_usd > 0 ? (asset.usdValue / total_holdings_usd) * 100 : 0,
      };
    });

    return { total_usd: total_holdings_usd, assets: collateralAssets as V2CollateralDto['assets'] };
  }

  /**
   * Get LP positions from FPMM pools across all chains.
   * Auto-discovers pools from FPMMFactory + ReserveLiquidityStrategy.
   * Splits each position into debt-side (reserve-held stablecoin) and collateral-side (reserve asset).
   */
  async getLpPositions(): Promise<V2LpPositionsDto> {
    // Discover FPMM positions on all supported chains
    const chains = [Chain.CELO, Chain.MONAD];
    const allPositions: FpmmPosition[] = [];

    const results = await Promise.all(
      chains.map((chain) => this.fpmmPositionsService.getPositions(chain).catch((e) => {
        this.logger.warn(`Failed to get FPMM positions on ${chain}: ${e}`);
        return [] as FpmmPosition[];
      })),
    );
    for (const positions of results) {
      allPositions.push(...positions);
    }

    // Also include UniV3 positions from v1 (non-FPMM)
    const holdings = await this.reserveService.getReserveHoldings();
    const univ3Holdings = holdings.filter((h) => h.type === 'Uniswap V3 Pool');
    const byAddress: Record<string, typeof univ3Holdings> = {};
    for (const h of univ3Holdings) {
      if (!byAddress[h.reserveAddress]) byAddress[h.reserveAddress] = [];
      byAddress[h.reserveAddress].push(h);
    }
    const univ3Positions = Object.entries(byAddress).flatMap(([, assets]) => {
      if (assets.length < 2) return [];
      const pairs: (typeof assets)[] = [];
      for (let i = 0; i < assets.length; i += 2) pairs.push(assets.slice(i, i + 2));
      return pairs
        .filter((pair) => pair.length === 2)
        .map((pair) => ({
          pool_name: `${pair[0].symbol} / ${pair[1].symbol}`,
          pool_type: 'Uniswap V3',
          chain: pair[0].chain,
          reserve_liquidity_usd: pair[0].usdValue + pair[1].usdValue,
          token_a: { symbol: pair[0].symbol, amount: pair[0].balance },
          token_b: { symbol: pair[1].symbol, amount: pair[1].balance },
          pool_share_pct: 0,
        }));
    });

    // Convert FPMM positions to DTO format
    const fpmmDtos = allPositions.map((pos) => ({
      pool_name: pos.pool_name,
      pool_type: 'FPMM',
      chain: pos.chain,
      reserve_liquidity_usd: 0, // Will be enriched with USD values below
      token_a: {
        symbol: pos.debt_token.symbol + ' (reserve-held)',
        amount: pos.debt_token.amount.toFixed(2),
      },
      token_b: {
        symbol: pos.collateral_token.symbol + ' (collateral)',
        amount: pos.collateral_token.amount.toFixed(2),
      },
      pool_share_pct: pos.lp_share_pct,
    }));

    const allDtos = [...fpmmDtos, ...univ3Positions];
    const total_usd = allDtos.reduce((sum, p) => sum + p.reserve_liquidity_usd, 0);

    return { total_usd, positions: allDtos } as V2LpPositionsDto;
  }

  /**
   * Get the reserve's pro-rata share of stablecoins locked in FPMM pools.
   * This is the "reserve-held" portion that should be subtracted from outstanding supply.
   * Returns: { [stablecoinSymbol]: amount_in_pool }
   */
  async getFpmmReserveHeldSupply(): Promise<Record<string, number>> {
    const chains = [Chain.CELO, Chain.MONAD];
    const result: Record<string, number> = {};

    for (const chain of chains) {
      try {
        const positions = await this.fpmmPositionsService.getPositions(chain);
        for (const pos of positions) {
          const sym = pos.debt_token.symbol;
          result[sym] = (result[sym] ?? 0) + pos.debt_token.amount;
        }
      } catch {}
    }

    return result;
  }

  /**
   * Get the reserve's pro-rata share of collateral assets locked in FPMM pools.
   * This adds to reserve collateral.
   * Returns: { [assetSymbol]: amount_in_pool }
   */
  async getFpmmCollateral(): Promise<Record<string, number>> {
    const chains = [Chain.CELO, Chain.MONAD];
    const result: Record<string, number> = {};

    for (const chain of chains) {
      try {
        const positions = await this.fpmmPositionsService.getPositions(chain);
        for (const pos of positions) {
          const sym = pos.collateral_token.symbol;
          result[sym] = (result[sym] ?? 0) + pos.collateral_token.amount;
        }
      } catch {}
    }

    return result;
  }

  private async getOperationalHoldings(): Promise<V2OperationalHoldingsDto> {
    try {
      const mento = this.mentoService.getMentoInstance();
      const tokens = await mento.tokens.getStableTokens();
      const stablecoinTokens = tokens.map((t) => ({
        symbol: t.symbol,
        address: t.address,
        decimals: t.decimals,
      }));

      const byToken: Record<string, { amount: number; usdValue: number }> = {};
      for (const token of stablecoinTokens) {
        byToken[token.symbol] = { amount: 0, usdValue: 0 };
      }

      await this.adjustmentsService.calculateReserveHoldings(stablecoinTokens, byToken);

      const holdings = Object.entries(byToken)
        .filter(([, adj]) => adj.amount > 0)
        .map(([symbol, adj]) => ({
          token: symbol,
          chain: Chain.CELO,
          wallet_label: 'Reserve',
          balance: adj.amount.toString(),
          usd_value: adj.usdValue,
        }));

      const total_usd = holdings.reduce((sum, h) => sum + h.usd_value, 0);
      return { total_usd, holdings };
    } catch (error) {
      this.logger.warn(`Failed to fetch operational holdings: ${error}`);
      return { total_usd: 0, holdings: [] };
    }
  }

  async getCdpTroves(): Promise<V2CdpTrovesDto> {
    const troves: V2CdpTroveDto[] = [];

    for (const cfg of CDP_TROVE_CONFIGS) {
      if (cfg.status !== 'active' || !cfg.contractAddress) {
        troves.push({
          stablecoin: cfg.stablecoin,
          collateral_token: cfg.collateralToken,
          collateral_amount: '0',
          collateral_usd: 0,
          debt_amount: '0',
          debt_usd: 0,
          ratio: 0,
          liquidation_price: 0,
          status: cfg.status,
          chain: cfg.chain,
          contract_address: cfg.contractAddress,
        });
        continue;
      }

      try {
        const onChainData = await this.readTroveManagerData(cfg.chain);
        const collateralUsd = await this.exchangeRatesService.convert(onChainData.totalColl, 'USD', 'USD');
        const debtUsd = await this.exchangeRatesService.convert(onChainData.totalDebt, 'GBP', 'USD');
        const ratio = debtUsd > 0 ? collateralUsd / debtUsd : 0;

        troves.push({
          stablecoin: cfg.stablecoin,
          collateral_token: cfg.collateralToken,
          collateral_amount: onChainData.totalColl.toString(),
          collateral_usd: collateralUsd,
          debt_amount: onChainData.totalDebt.toString(),
          debt_usd: debtUsd,
          ratio,
          liquidation_price: 0,
          status: cfg.status,
          chain: cfg.chain,
          contract_address: cfg.contractAddress,
        });
      } catch (error) {
        this.logger.warn(`Failed to read CDP trove data for ${cfg.stablecoin}: ${error}`);
        troves.push({
          stablecoin: cfg.stablecoin,
          collateral_token: cfg.collateralToken,
          collateral_amount: '0',
          collateral_usd: 0,
          debt_amount: '0',
          debt_usd: 0,
          ratio: 0,
          liquidation_price: 0,
          status: cfg.status,
          chain: cfg.chain,
          contract_address: cfg.contractAddress,
        });
      }
    }

    const total_collateral_usd = troves.reduce((sum, t) => sum + t.collateral_usd, 0);
    const total_debt_usd = troves.reduce((sum, t) => sum + t.debt_usd, 0);

    return { total_collateral_usd, total_debt_usd, troves };
  }

  private async readTroveManagerData(chain: Chain): Promise<{ totalDebt: number; totalColl: number }> {
    return this.chainClientService.executeRateLimited(chain, async (client) => {
      const troveManagerAddress = CDP_CONTRACTS.TROVE_MANAGER as `0x${string}`;

      const [totalDebtRaw, totalCollRaw] = await Promise.all([
        client.readContract({ address: troveManagerAddress, abi: TROVE_MANAGER_ABI, functionName: 'getEntireBranchDebt' }),
        client.readContract({ address: troveManagerAddress, abi: TROVE_MANAGER_ABI, functionName: 'getEntireBranchColl' }),
      ]);

      const totalDebt = Number(formatUnits(totalDebtRaw as bigint, 18));
      const totalColl = Number(formatUnits(totalCollRaw as bigint, 18));

      this.logger.log(`CDP trove data - Total debt: ${totalDebt.toFixed(2)} GBPm, Total coll: ${totalColl.toFixed(2)} USDm`);
      return { totalDebt, totalColl };
    });
  }
}
