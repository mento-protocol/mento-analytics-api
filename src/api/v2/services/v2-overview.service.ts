import { Injectable, Logger } from '@nestjs/common';
import { V2OverviewResponseDto } from '../dto/v2-overview.dto';
import { buildMeta, DataWarning } from '../dto/v2-meta.dto';
import { V2StablecoinsService } from './v2-stablecoins.service';
import { V2ReserveService } from './v2-reserve.service';
import { V2PositionsService } from './v2-positions.service';
import { ChainClientService } from '@common/services/chain-client.service';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { CDP_TROVE_CONFIGS, CDP_REGISTRIES, ADDRESSES_REGISTRY_ABI, TROVE_MANAGER_ABI } from '../config/cdp.config';
import { getFiatTickerFromSymbol } from '@common/constants';
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

    // Collect warnings from positions and stablecoins
    const warnings: DataWarning[] = [...positionsResult.warnings, ...(stablecoinsData.meta?.warnings ?? [])];

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
      meta: buildMeta(warnings),
    };
  }

  /** Cache of resolved TroveManager addresses per stablecoin */
  private resolvedTroveManagers = new Map<string, string>();

  /**
   * Resolve the TroveManager address for a CDP config — uses the hardcoded
   * address if present, otherwise resolves from the on-chain registry.
   */
  private async resolveTroveManager(cfg: (typeof CDP_TROVE_CONFIGS)[number]): Promise<string> {
    if (cfg.contractAddress) return cfg.contractAddress;

    const cached = this.resolvedTroveManagers.get(cfg.stablecoin);
    if (cached) return cached;

    const registryAddress = CDP_REGISTRIES[cfg.stablecoin];
    if (!registryAddress) {
      throw new Error(`No CDP registry for ${cfg.stablecoin}`);
    }

    const address = await this.chainClientService.executeRateLimited<string>(cfg.chain, async (client) => {
      return (client.readContract as any)({
        address: registryAddress as `0x${string}`,
        abi: ADDRESSES_REGISTRY_ABI,
        functionName: 'troveManager',
      });
    });

    this.resolvedTroveManagers.set(cfg.stablecoin, address);
    return address;
  }

  /**
   * Read system-wide CDP totals from TroveManager.getEntireBranchDebt/Coll.
   * This includes ALL troves (reserve + external) — shows how the stablecoin
   * is backed overall, not just the reserve's portion.
   */
  private async getCdpSystemTotals() {
    const results = [];

    for (const cfg of CDP_TROVE_CONFIGS) {
      if (cfg.status !== 'active') {
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

      const troveManagerAddress = await this.resolveTroveManager(cfg);

      const { totalDebt, totalColl } = await this.chainClientService.executeRateLimited<{
        totalDebt: number;
        totalColl: number;
      }>(cfg.chain, async (client) => {
        const readContract = client.readContract as any;
        const [debtRaw, collRaw] = await Promise.all([
          readContract({
            address: troveManagerAddress as `0x${string}`,
            abi: TROVE_MANAGER_ABI,
            functionName: 'getEntireBranchDebt',
          }),
          readContract({
            address: troveManagerAddress as `0x${string}`,
            abi: TROVE_MANAGER_ABI,
            functionName: 'getEntireBranchColl',
          }),
        ]);
        return {
          totalDebt: Number(formatUnits(debtRaw as bigint, 18)),
          totalColl: Number(formatUnits(collRaw as bigint, 18)),
        };
      });

      // USDm collateral = 1:1 USD; debt needs fiat→USD conversion
      const fiatTicker = getFiatTickerFromSymbol(cfg.stablecoin);
      const collateralUsd = totalColl; // USDm ≈ USD
      const debtUsd = await this.exchangeRatesService.convert(totalDebt, fiatTicker, 'USD');
      const ratio = debtUsd > 0 ? collateralUsd / debtUsd : 0;

      this.logger.log(
        `CDP system totals [${cfg.stablecoin}]: ${totalColl.toFixed(0)} USDm coll, ${totalDebt.toFixed(0)} ${cfg.stablecoin} debt, ratio ${ratio.toFixed(2)}`,
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
