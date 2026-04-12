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
  chain: Chain;
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

  /** Deduplicates concurrent getPositions() calls — only one RPC trip at a time */
  private inflight: Promise<PositionsResult> | null = null;

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
   * Deduplicates concurrent calls — if getPositions() is already in-flight,
   * callers share the same promise instead of triggering parallel RPC trips.
   */
  async getPositions(): Promise<PositionsResult> {
    if (this.inflight) {
      this.logger.debug('getPositions() already in-flight, sharing result');
      return this.inflight;
    }

    this.inflight = this._getPositionsImpl().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async _getPositionsImpl(): Promise<PositionsResult> {
    const totalStart = Date.now();
    const time = (label: string, start: number) => this.logger.log(`  [timing] ${label}: ${Date.now() - start}ms`);

    // Phase 1: Celo sequential reads
    let t = Date.now();
    const celoWallet = await this.walletBalanceReader.readPositions(Chain.CELO).catch((e) => {
      this.logger.warn(`Failed to read Celo wallet balances: ${e}`);
      return [] as WalletBalancePosition[];
    });
    time('Celo wallets', t);

    t = Date.now();
    const celoAave = await this.aaveReader.readPositions(Chain.CELO).catch((e) => {
      this.logger.warn(`Failed to read AAVE positions: ${e}`);
      return [] as AavePosition[];
    });
    time('Celo AAVE', t);

    t = Date.now();
    const celoFpmm = await this.fpmmPositionsService.getPositions(Chain.CELO).catch((e) => {
      this.logger.warn(`Failed to read Celo FPMM positions: ${e}`);
      return [] as FpmmPosition[];
    });
    time('Celo FPMM', t);

    t = Date.now();
    const univ3Positions = await this.univ3Reader.readPositions().catch((e) => {
      this.logger.warn(`Failed to read UniV3 positions: ${e}`);
      return [] as UniV3PositionDetail[];
    });
    time('UniV3', t);

    t = Date.now();
    const cdpTroves = await this.cdpTroveReader.readPositions().catch((e) => {
      this.logger.warn(`Failed to read CDP troves: ${e}`);
      return [] as CdpTrovePosition[];
    });
    time('CDP troves', t);

    t = Date.now();
    const stabilityPools = await this.stabilityPoolReader.readPositions().catch((e) => {
      this.logger.warn(`Failed to read stability pools: ${e}`);
      return [] as StabilityPoolPosition[];
    });
    time('Stability pools', t);

    time('Phase 1 (Celo) total', totalStart);

    // Phase 2: ETH + Monad in parallel
    t = Date.now();
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
    time('Phase 2 (ETH+Monad)', t);

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
    t = Date.now();
    await this.enrichUsdValues(allPositions);
    time('USD enrichment', t);

    // Derive summaries
    const collateral = this.deriveCollateral(allPositions);
    const reserveHeld = this.deriveReserveHeld(allPositions);

    this.logger.log(
      `Positions total: ${Date.now() - totalStart}ms — Collateral: $${collateral.total_usd.toFixed(0)}, ` +
      `W:${walletBalances.length} A:${aaveDeposits.length} U3:${univ3Positions.length} ` +
      `FPMM:${fpmmPositions.length} CDP:${cdpTroves.length} SP:${stabilityPools.length}`,
    );

    return { collateral, reserve_held_supply: reserveHeld, positions: allPositions };
  }

  /**
   * Enrich all positions with USD values.
   * Pre-fetches unique prices once, then applies to all positions — avoids
   * redundant CMC/DeFiLlama calls and rate limit bottlenecks.
   */
  private async enrichUsdValues(positions: AllPositions): Promise<void> {
    // Collect all unique token symbols that need pricing
    const symbols = new Set<string>();
    for (const p of positions.wallet_balances) symbols.add(p.token);
    for (const p of positions.aave_deposits) symbols.add(p.token);
    for (const p of positions.stability_pool_deposits) {
      symbols.add(p.deposit_token);
      symbols.add(p.collateral_gained_token);
    }

    // Pre-fetch price for each unique symbol (one CMC/DeFiLlama call per symbol)
    const priceMap = new Map<string, number>();
    for (const sym of symbols) {
      const price = await this.getTokenPrice(sym);
      priceMap.set(sym, price);
    }

    // Apply prices to all positions
    const price = (sym: string, amount: number) => amount * (priceMap.get(sym) ?? 0);

    for (const p of positions.wallet_balances) {
      p.usd_value = price(p.token, Number(p.balance));
    }
    for (const p of positions.aave_deposits) {
      p.usd_value = price(p.token, Number(p.balance));
    }
    for (const p of positions.stability_pool_deposits) {
      p.deposit_usd = price(p.deposit_token, Number(p.deposit_amount));
      p.collateral_gained_usd = price(p.collateral_gained_token, Number(p.collateral_gained));
    }
  }

  /**
   * Get the USD price of 1 unit of a token. Fetched once and reused across positions.
   */
  private async getTokenPrice(symbol: string): Promise<number> {
    // Skip unresolvable symbols (raw addresses, UNKNOWN, etc.)
    if (symbol.startsWith('0x') || symbol === 'UNKNOWN' || symbol.length > 10) {
      return 0;
    }

    try {
      // Mento stablecoins: fiat conversion (1 USDm ≈ 1 USD, 1 GBPm ≈ 1.34 USD, etc.)
      if (symbol.endsWith('m') && symbol.length > 1) {
        const fiatTicker = getFiatTickerFromSymbol(symbol);
        return await this.exchangeRatesService.convert(1, fiatTicker, 'USD');
      }

      // USD-pegged stablecoins
      // True 1:1 USD-pegged stablecoins (NOT yield-bearing vault tokens)
      const usdPegged = ['USDC', 'axlUSDC', 'USDT', 'USDGLO', 'USDS', 'AUSD'];
      if (usdPegged.includes(symbol)) return 1;
      // sUSDS and sDAI are yield-bearing — fall through to DeFiLlama/CMC pricing

      // EUR-pegged tokens
      const eurPegged = ['EURC', 'axlEUROC', 'EURA', 'stEUR'];
      if (eurPegged.includes(symbol)) {
        return await this.exchangeRatesService.convert(1, 'EUR', 'USD');
      }

      // Crypto assets: CoinMarketCap or DeFiLlama
      const assetConfig = this.findAssetConfig(symbol);
      if (assetConfig?.useDefiLlamaPrice && assetConfig.address) {
        const chain = this.findAssetChain(symbol);
        const chainSlug = chain === Chain.ETHEREUM ? 'ethereum' : chain === Chain.CELO ? 'celo' : chain;
        return (await this.defiLlamaPriceFetcher.getPrice(`${chainSlug}:${assetConfig.address}`)) ?? 0;
      }

      const rateSymbol = assetConfig?.rateSymbol ?? symbol;
      return (await this.cmcPriceFetcher.getPrice(rateSymbol)) ?? 0;
    } catch (error) {
      this.logger.warn(`Failed to get price for ${symbol}: ${error}`);
      return 0;
    }
  }

  // tokenAmountToUsd removed — replaced by getTokenPrice() + batch enrichment

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
    // Key by symbol:chain to keep per-chain entries separate
    const byKey = new Map<string, { symbol: string; chain: Chain; amount: number; usdValue: number }>();

    const add = (symbol: string, amount: number, usdValue: number, chain: Chain) => {
      // Find canonical group name (ETH+WETH, USDC+axlUSDC, etc.)
      let canonical = symbol;
      for (const [groupName, members] of Object.entries(ASSET_GROUPS)) {
        if (members?.includes(symbol as any)) { canonical = groupName; break; }
      }
      const key = `${canonical}:${chain}`;
      const existing = byKey.get(key) ?? { symbol: canonical, chain, amount: 0, usdValue: 0 };
      existing.amount += amount;
      existing.usdValue += usdValue;
      byKey.set(key, existing);
    };

    // Wallet balances that are NOT mento stables
    for (const p of positions.wallet_balances) {
      if (!p.is_mento_stable) {
        add(p.token, Number(p.balance), p.usd_value, p.chain);
      }
    }

    // AAVE deposits that are NOT mento stables
    for (const p of positions.aave_deposits) {
      if (!p.is_mento_stable) {
        add(p.token, Number(p.balance), p.usd_value, p.chain);
      }
    }

    // UniV3 positions — both sides unless one is a mento stable
    for (const p of positions.univ3_positions) {
      const amount0 = Number(p.token0.amount);
      const amount1 = Number(p.token1.amount);
      if (amount0 > 0) {
        add(p.token0.symbol, amount0, 0, p.chain); // USD enrichment done later
      }
      if (amount1 > 0) {
        add(p.token1.symbol, amount1, 0, p.chain);
      }
    }

    // FPMM collateral side
    for (const p of positions.fpmm_positions) {
      add(p.collateral_token.symbol, p.collateral_token.amount, 0, p.chain);
    }

    // Stability pool collateral gained
    for (const p of positions.stability_pool_deposits) {
      const amount = Number(p.collateral_gained);
      if (amount > 0) {
        add(p.collateral_gained_token, amount, p.collateral_gained_usd, p.chain);
      }
    }

    // Already grouped per chain — just sort and compute percentages
    const entries = Array.from(byKey.values()).sort((a, b) => b.usdValue - a.usdValue);
    const totalUsd = entries.reduce((sum, a) => sum + a.usdValue, 0);

    const assets: CollateralAssetSummary[] = entries.map((a) => ({
      symbol: a.symbol,
      chain: a.chain,
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

    const addHeld = (symbol: string, amount: number, usdValue: number) => {
      const existing = bySymbol.get(symbol) ?? { amount: 0, usdValue: 0 };
      existing.amount += amount;
      existing.usdValue += usdValue;
      bySymbol.set(symbol, existing);
    };

    // Wallet balances that ARE mento stables
    for (const p of positions.wallet_balances) {
      if (p.is_mento_stable) {
        addHeld(p.token, Number(p.balance), p.usd_value);
      }
    }

    // AAVE deposits that ARE mento stables
    for (const p of positions.aave_deposits) {
      if (p.is_mento_stable) {
        addHeld(p.token, Number(p.balance), p.usd_value);
      }
    }

    // FPMM debt side (stablecoin side = reserve-held)
    for (const p of positions.fpmm_positions) {
      addHeld(p.debt_token.symbol, p.debt_token.amount, 0);
    }

    // Stability pool deposits (stablecoin deposits = reserve-held)
    for (const p of positions.stability_pool_deposits) {
      const amount = Number(p.deposit_amount);
      if (amount > 0) {
        addHeld(p.deposit_token, amount, p.deposit_usd);
      }
    }

    // CDP trove collateral (USDm locked in CDPs is reserve-held, not collateral)
    for (const p of positions.cdp_troves) {
      addHeld(p.collateral_token, Number(p.collateral_amount), p.collateral_usd);
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
