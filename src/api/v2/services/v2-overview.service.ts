import { Injectable, Logger } from '@nestjs/common';
import { V2OverviewResponseDto } from '../dto/v2-overview.dto';
import { V2StablecoinsService } from './v2-stablecoins.service';
import { V2ReserveService } from './v2-reserve.service';
import { V2PositionsService } from './v2-positions.service';
import { ChainClientService } from '@common/services/chain-client.service';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { CDP_TROVE_CONFIGS, TROVE_MANAGER_ABI } from '../config/cdp.config';
import { formatUnits } from 'viem';

@Injectable()
export class V2OverviewService {
  private readonly logger = new Logger(V2OverviewService.name);

  constructor(
    private readonly v2StablecoinsService: V2StablecoinsService,
    private readonly v2ReserveService: V2ReserveService,
    private readonly v2PositionsService: V2PositionsService,
    private readonly chainClientService: ChainClientService,
    private readonly exchangeRatesService: ExchangeRatesService,
  ) {}

  async getOverview(): Promise<V2OverviewResponseDto> {
    const start = Date.now();

    // Fetch positions once
    const t1 = Date.now();
    const positionsResult = await this.v2PositionsService.getPositions();
    this.logger.log(`Overview: positions took ${Date.now() - t1}ms`);

    // Stablecoins, reserve, and system-wide CDP totals in parallel
    const t2 = Date.now();
    const [stablecoinsData, cdpSystemTotals] = await Promise.all([
      this.v2StablecoinsService.getStablecoins(),
      this.getCdpSystemTotals(),
    ]);
    this.logger.log(`Overview: stablecoins+cdp took ${Date.now() - t2}ms`);

    // Calculate supply decomposition
    const reserveBackedCoins = stablecoinsData.stablecoins.filter((c) => c.backing_type === 'reserve');
    const cdpBackedCoins = stablecoinsData.stablecoins.filter((c) => c.backing_type === 'cdp');

    const reserveDebtUsd = reserveBackedCoins.reduce((sum, c) => sum + c.supply.debt_usd, 0);
    const cdpDebtUsd = cdpBackedCoins.reduce((sum, c) => sum + c.supply.debt_usd, 0);
    const reserveHeldUsd = stablecoinsData.stablecoins.reduce((sum, c) => sum + c.supply.reserve_held_usd, 0);
    const lostUsd = stablecoinsData.stablecoins.reduce((sum, c) => sum + c.supply.lost_usd, 0);

    // Use positions-derived collateral
    const reserveCollateralUsd = positionsResult.collateral.total_usd;
    const reserveRatio = reserveDebtUsd > 0 ? reserveCollateralUsd / reserveDebtUsd : 0;

    this.logger.log(`Overview: total ${Date.now() - start}ms`);

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
      cdp_backings: cdpSystemTotals,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Read system-wide CDP totals from TroveManager.getEntireBranchDebt/Coll.
   * This includes ALL troves (reserve + external) — shows how the stablecoin
   * is backed overall, not just the reserve's portion.
   */
  private async getCdpSystemTotals() {
    const results = [];

    for (const cfg of CDP_TROVE_CONFIGS) {
      if (cfg.status !== 'active' || !cfg.contractAddress) {
        results.push({
          stablecoin: cfg.stablecoin,
          collateral_token: cfg.collateralToken,
          collateral_usd: 0,
          collateral_amount: '0',
          debt_usd: 0,
          debt_amount: '0',
          ratio: 0,
          status: cfg.status,
          chain: cfg.chain,
        });
        continue;
      }

      const { totalDebt, totalColl } = await this.chainClientService.executeRateLimited<{
        totalDebt: number;
        totalColl: number;
      }>(cfg.chain, async (client) => {
        const readContract = client.readContract as any;
        const [debtRaw, collRaw] = await Promise.all([
          readContract({
            address: cfg.contractAddress as `0x${string}`,
            abi: TROVE_MANAGER_ABI,
            functionName: 'getEntireBranchDebt',
          }),
          readContract({
            address: cfg.contractAddress as `0x${string}`,
            abi: TROVE_MANAGER_ABI,
            functionName: 'getEntireBranchColl',
          }),
        ]);
        return {
          totalDebt: Number(formatUnits(debtRaw as bigint, 18)),
          totalColl: Number(formatUnits(collRaw as bigint, 18)),
        };
      });

      // USDm collateral = 1:1 USD, GBPm debt needs GBP→USD
      const collateralUsd = totalColl; // USDm ≈ USD
      const debtUsd = await this.exchangeRatesService.convert(totalDebt, 'GBP', 'USD');
      const ratio = debtUsd > 0 ? collateralUsd / debtUsd : 0;

      this.logger.log(
        `CDP system totals: ${totalColl.toFixed(0)} USDm coll, ${totalDebt.toFixed(0)} GBPm debt, ratio ${ratio.toFixed(2)}`,
      );

      results.push({
        stablecoin: cfg.stablecoin,
        collateral_token: cfg.collateralToken,
        collateral_usd: collateralUsd,
        collateral_amount: totalColl.toString(),
        debt_usd: debtUsd,
        debt_amount: totalDebt.toString(),
        ratio,
        status: cfg.status,
        chain: cfg.chain,
      });
    }

    return results;
  }
}
