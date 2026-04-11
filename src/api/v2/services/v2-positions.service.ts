import { Injectable, Logger } from '@nestjs/common';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { CoinMarketCapPriceFetcherService } from '@common/services/coinmarketcap-price-fetcher.service';
import { DefiLlamaPriceFetcherService } from '@common/services/defillama-price-fetcher.service';
import { ASSETS_CONFIGS } from '@api/reserve/config/assets.config';
import { WalletBalanceReader, WalletBalancePosition } from './positions/wallet-balance.reader';
import { AaveReader, AavePosition } from './positions/aave.reader';
import { CdpTroveReader, CdpTrovePosition } from './positions/cdp-trove.reader';
import { StabilityPoolReader, StabilityPoolPosition } from './positions/stability-pool.reader';
import { UniV3Reader, UniV3PositionDetail } from './positions/univ3.reader';
import { FpmmPositionsService, FpmmPosition } from './fpmm-positions.service';
import { ASSET_GROUPS } from '@api/reserve/config/assets.config';
import { getFiatTickerFromSymbol } from '@common/constants';
import { Chain } from '@types';

// --- Aggregated position types for the orchestrator output ---

export interface AllPositions {
  wallet_balances: WalletBalancePosition[];
  aave_deposits: AavePosition[];
  univ3_positions: UniV3PositionDetail[];
  fpmm_positions: FpmmPosition[];
  cdp_troves: CdpTrovePosition[];
  stability_pool_deposits: StabilityPoolPosition[];
}

export interface CollateralAssetSummary {
  symbol: string;
  chain: Chain | null;
  balance: string;
  usd_value: number;
  percentage: number;
}

export interface CollateralSummary {
  total_usd: number;
  assets: CollateralAssetSummary[];
}

export interface ReserveHeldToken {
  symbol: string;
  amount: number;
  usd_value: number;
}

export interface ReserveHeldSummary {
  total_usd: number;
  by_token: ReserveHeldToken[];
}

export interface PositionsResult {
  collateral: CollateralSummary;
  reserve_held_supply: ReserveHeldSummary;
  positions: AllPositions;
}

@Injectable()
export class V2PositionsService {
  private readonly logger = new Logger(V2PositionsService.name);

  constructor(
    private readonly walletBalanceReader: WalletBalanceReader,
    private readonly aaveReader: AaveReader,
    private readonly cdpTroveReader: CdpTroveReader,
    private readonly stabilityPoolReader: StabilityPoolReader,
    private readonly univ3Reader: UniV3Reader,
    private readonly fpmmPositionsService: FpmmPositionsService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly cmcPriceFetcher: CoinMarketCapPriceFetcherService,
    private readonly defiLlamaPriceFetcher: DefiLlamaPriceFetcherService,
  ) {}

  /**
   * Orchestrate all position readers, serialized by chain to avoid RPC burst.
   * Within each chain: wallet + protocol-specific reads run sequentially.
   * Across chains: Celo first (most data), then ETH and Monad in parallel.
   */
  async getPositions(): Promise<PositionsResult> {
    // Phase 1: Celo (most positions — wallet, aave, fpmm, cdp, stability pool)
    const celoWallet = await this.walletBalanceReader.readPositions(Chain.CELO).catch((e) => {
      this.logger.warn(`Failed to read Celo wallet balances: ${e}`);
      return [] as WalletBalancePosition[];
    });
    const celoAave = await this.aaveReader.readPositions(Chain.CELO).catch((e) => {
      this.logger.warn(`Failed to read AAVE positions: ${e}`);
      return [] as AavePosition[];
    });
    const celoFpmm = await this.fpmmPositionsService.getPositions(Chain.CELO).catch((e) => {
      this.logger.warn(`Failed to read Celo FPMM positions: ${e}`);
      return [] as FpmmPosition[];
    });
    const univ3Positions = await this.univ3Reader.readPositions().catch((e) => {
      this.logger.warn(`Failed to read UniV3 positions: ${e}`);
      return [] as UniV3PositionDetail[];
    });
    const cdpTroves = await this.cdpTroveReader.readPositions().catch((e) => {
      this.logger.warn(`Failed to read CDP troves: ${e}`);
      return [] as CdpTrovePosition[];
    });
    const stabilityPools = await this.stabilityPoolReader.readPositions().catch((e) => {
      this.logger.warn(`Failed to read stability pools: ${e}`);
      return [] as StabilityPoolPosition[];
    });

    // Phase 2: ETH + Monad in parallel (independent chains, no conflict with Celo)
    const [ethWallet, monadWallet, monadFpmm] = await Promise.all([
      this.walletBalanceReader.readPositions(Chain.ETHEREUM).catch((e) => {
        this.logger.warn(`Failed to read ETH wallet balances: ${e}`);
        return [] as WalletBalancePosition[];
      }),
      this.walletBalanceReader.readPositions(Chain.MONAD).catch((e) => {
        this.logger.warn(`Failed to read Monad wallet balances: ${e}`);
        return [] as WalletBalancePosition[];
      }),
      this.fpmmPositionsService.getPositions(Chain.MONAD).catch((e) => {
        this.logger.warn(`Failed to read Monad FPMM positions: ${e}`);
        return [] as FpmmPosition[];
      }),
    ]);

    const walletBalances = [...celoWallet, ...ethWallet, ...monadWallet];
    const aaveDeposits = celoAave;
    const fpmmPositions = [...celoFpmm, ...monadFpmm];
    const allPositions: AllPositions = {
      wallet_balances: walletBalances,
      aave_deposits: aaveDeposits,
      univ3_positions: univ3Positions,
      fpmm_positions: fpmmPositions,
      cdp_troves: cdpTroves,
      stability_pool_deposits: stabilityPools,
    };

    // Enrich USD values for wallet balances, aave, and stability pools
    await this.enrichUsdValues(allPositions);

    // Derive summaries
    const collateral = this.deriveCollateral(allPositions);
    const reserveHeld = this.deriveReserveHeld(allPositions);

    this.logger.log(
      `Positions summary - Collateral: $${collateral.total_usd.toFixed(2)}, ` +
      `Reserve-held: $${reserveHeld.total_usd.toFixed(2)}, ` +
      `Wallets: ${walletBalances.length}, AAVE: ${aaveDeposits.length}, ` +
      `UniV3: ${univ3Positions.length}, FPMM: ${fpmmPositions.length}, ` +
      `CDPs: ${cdpTroves.length}, StabilityPools: ${stabilityPools.length}`,
    );

    return { collateral, reserve_held_supply: reserveHeld, positions: allPositions };
  }

  /**
   * Enrich all positions with USD values.
   */
  private async enrichUsdValues(positions: AllPositions): Promise<void> {
    // Wallet balances
    await Promise.all(
      positions.wallet_balances.map(async (p) => {
        p.usd_value = await this.tokenAmountToUsd(p.token, Number(p.balance));
      }),
    );

    // AAVE deposits
    await Promise.all(
      positions.aave_deposits.map(async (p) => {
        p.usd_value = await this.tokenAmountToUsd(p.token, Number(p.balance));
      }),
    );

    // Stability pool deposits and collateral gains
    await Promise.all(
      positions.stability_pool_deposits.map(async (p) => {
        p.deposit_usd = await this.tokenAmountToUsd(p.deposit_token, Number(p.deposit_amount));
        p.collateral_gained_usd = await this.tokenAmountToUsd(
          p.collateral_gained_token,
          Number(p.collateral_gained),
        );
      }),
    );
  }

  /**
   * Convert a token amount to USD.
   * For Mento stables (symbol ends with 'm'), uses fiat conversion.
   * For other tokens, assumes price data comes from the exchange rate service.
   */
  private async tokenAmountToUsd(symbol: string, amount: number): Promise<number> {
    if (amount === 0) return 0;

    try {
      // Mento stablecoins: use fiat ticker (USDm -> USD, GBPm -> GBP, etc.)
      if (symbol.endsWith('m') && symbol.length > 1) {
        const fiatTicker = getFiatTickerFromSymbol(symbol);
        return await this.exchangeRatesService.convert(amount, fiatTicker, 'USD');
      }

      // USD-pegged stablecoins: 1:1 with USD
      const usdPegged = ['USDC', 'axlUSDC', 'USDT', 'USDGLO', 'sDAI', 'sUSDS', 'USDS', 'AUSD'];
      if (usdPegged.includes(symbol)) {
        return amount;
      }

      // EUR-pegged tokens
      const eurPegged = ['EURC', 'axlEUROC', 'EURA', 'stEUR'];
      if (eurPegged.includes(symbol)) {
        return await this.exchangeRatesService.convert(amount, 'EUR', 'USD');
      }

      // Crypto assets: use CoinMarketCap or DeFiLlama for pricing
      // Check if this asset uses DeFiLlama (e.g. sUSDS vault tokens)
      const assetConfig = this.findAssetConfig(symbol);
      if (assetConfig?.useDefiLlamaPrice && assetConfig.address) {
        const chain = this.findAssetChain(symbol);
        const chainSlug = chain === Chain.ETHEREUM ? 'ethereum' : chain === Chain.CELO ? 'celo' : chain;
        const price = await this.defiLlamaPriceFetcher.getPrice(`${chainSlug}:${assetConfig.address}`);
        return price ? amount * price : 0;
      }

      // Default: CoinMarketCap
      const rateSymbol = assetConfig?.rateSymbol ?? symbol;
      const price = await this.cmcPriceFetcher.getPrice(rateSymbol);
      return price ? amount * price : 0;
    } catch (error) {
      this.logger.warn(`Failed to convert ${symbol} to USD: ${error}`);
      return 0;
    }
  }

  private findAssetConfig(symbol: string) {
    for (const chainAssets of Object.values(ASSETS_CONFIGS)) {
      const config = chainAssets[symbol as keyof typeof chainAssets];
      if (config) return config;
    }
    return null;
  }

  private findAssetChain(symbol: string): Chain {
    for (const [chain, assets] of Object.entries(ASSETS_CONFIGS)) {
      if (assets[symbol as keyof typeof assets]) return chain as Chain;
    }
    return Chain.CELO;
  }

  /**
   * Derive collateral summary from all positions.
   *
   * collateral = wallet_balances(!stable) + aave(!stable) + fpmm(collateral side)
   *            + stability_pool(collateral_gained)
   */
  private deriveCollateral(positions: AllPositions): CollateralSummary {
    const bySymbol = new Map<string, { amount: number; usdValue: number; chains: Set<Chain> }>();

    const addToSymbol = (symbol: string, amount: number, usdValue: number, chain: Chain) => {
      const existing = bySymbol.get(symbol) ?? { amount: 0, usdValue: 0, chains: new Set<Chain>() };
      existing.amount += amount;
      existing.usdValue += usdValue;
      existing.chains.add(chain);
      bySymbol.set(symbol, existing);
    };

    // Wallet balances that are NOT mento stables
    for (const p of positions.wallet_balances) {
      if (!p.is_mento_stable) {
        addToSymbol(p.token, Number(p.balance), p.usd_value, p.chain);
      }
    }

    // AAVE deposits that are NOT mento stables
    for (const p of positions.aave_deposits) {
      if (!p.is_mento_stable) {
        addToSymbol(p.token, Number(p.balance), p.usd_value, p.chain);
      }
    }

    // UniV3 positions — both sides unless one is a mento stable
    for (const p of positions.univ3_positions) {
      const amount0 = Number(p.token0.amount);
      const amount1 = Number(p.token1.amount);
      if (amount0 > 0) {
        addToSymbol(p.token0.symbol, amount0, 0, p.chain); // USD enrichment done later
      }
      if (amount1 > 0) {
        addToSymbol(p.token1.symbol, amount1, 0, p.chain);
      }
    }

    // FPMM collateral side
    for (const p of positions.fpmm_positions) {
      addToSymbol(p.collateral_token.symbol, p.collateral_token.amount, 0, p.chain);
    }

    // Stability pool collateral gained
    for (const p of positions.stability_pool_deposits) {
      const amount = Number(p.collateral_gained);
      if (amount > 0) {
        addToSymbol(p.collateral_gained_token, amount, p.collateral_gained_usd, p.chain);
      }
    }

    // Group like assets (e.g. ETH + WETH, USDC + axlUSDC)
    const grouped = this.groupAssets(bySymbol);

    const totalUsd = grouped.reduce((sum, a) => sum + a.usdValue, 0);
    const assets: CollateralAssetSummary[] = grouped.map((a) => ({
      symbol: a.symbol,
      // If all contributions are from one chain, show it. Otherwise null (multi-chain asset).
      chain: a.chains.size === 1 ? [...a.chains][0] : null,
      balance: a.amount.toString(),
      usd_value: a.usdValue,
      percentage: totalUsd > 0 ? (a.usdValue / totalUsd) * 100 : 0,
    }));

    return { total_usd: totalUsd, assets };
  }

  /**
   * Derive reserve-held supply summary from all positions.
   *
   * reserve_held = wallet_balances(stable) + aave(stable) + fpmm(debt side)
   *              + stability_pool(deposit) + cdp_troves(collateral, since it's USDm)
   */
  private deriveReserveHeld(positions: AllPositions): ReserveHeldSummary {
    const bySymbol = new Map<string, { amount: number; usdValue: number }>();

    const addToSymbol = (symbol: string, amount: number, usdValue: number) => {
      const existing = bySymbol.get(symbol) ?? { amount: 0, usdValue: 0 };
      existing.amount += amount;
      existing.usdValue += usdValue;
      bySymbol.set(symbol, existing);
    };

    // Wallet balances that ARE mento stables
    for (const p of positions.wallet_balances) {
      if (p.is_mento_stable) {
        addToSymbol(p.token, Number(p.balance), p.usd_value);
      }
    }

    // AAVE deposits that ARE mento stables
    for (const p of positions.aave_deposits) {
      if (p.is_mento_stable) {
        addToSymbol(p.token, Number(p.balance), p.usd_value);
      }
    }

    // FPMM debt side (stablecoin side = reserve-held)
    for (const p of positions.fpmm_positions) {
      addToSymbol(p.debt_token.symbol, p.debt_token.amount, 0);
    }

    // Stability pool deposits (stablecoin deposits = reserve-held)
    for (const p of positions.stability_pool_deposits) {
      const amount = Number(p.deposit_amount);
      if (amount > 0) {
        addToSymbol(p.deposit_token, amount, p.deposit_usd);
      }
    }

    // CDP trove collateral (USDm locked in CDPs is reserve-held, not collateral)
    for (const p of positions.cdp_troves) {
      addToSymbol(p.collateral_token, Number(p.collateral_amount), p.collateral_usd);
    }

    const totalUsd = Array.from(bySymbol.values()).reduce((sum, a) => sum + a.usdValue, 0);
    const byToken: ReserveHeldToken[] = Array.from(bySymbol.entries()).map(([symbol, data]) => ({
      symbol,
      amount: data.amount,
      usd_value: data.usdValue,
    }));

    return { total_usd: totalUsd, by_token: byToken };
  }

  /**
   * Group assets by their canonical symbol using ASSET_GROUPS config.
   * e.g., ETH + WETH -> ETH, USDC + axlUSDC -> USDC
   */
  private groupAssets(
    bySymbol: Map<string, { amount: number; usdValue: number; chains: Set<Chain> }>,
  ): { symbol: string; amount: number; usdValue: number; chains: Set<Chain> }[] {
    const grouped = new Map<string, { amount: number; usdValue: number; chains: Set<Chain> }>();

    for (const [symbol, data] of bySymbol.entries()) {
      let canonical = symbol;
      for (const [groupName, members] of Object.entries(ASSET_GROUPS)) {
        if (members?.includes(symbol as any)) {
          canonical = groupName;
          break;
        }
      }

      const existing = grouped.get(canonical) ?? { amount: 0, usdValue: 0, chains: new Set<Chain>() };
      existing.amount += data.amount;
      existing.usdValue += data.usdValue;
      for (const c of data.chains) existing.chains.add(c);
      grouped.set(canonical, existing);
    }

    return Array.from(grouped.entries())
      .map(([symbol, data]) => ({ symbol, ...data }))
      .sort((a, b) => b.usdValue - a.usdValue);
  }

  /**
   * Get just the FPMM reserve-held supply amounts, grouped by stablecoin symbol.
   * Used by v2-stablecoins.service for supply decomposition.
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
   * Get just the FPMM collateral amounts, grouped by asset symbol.
   * Used by v2-reserve.service for collateral enrichment.
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
}
