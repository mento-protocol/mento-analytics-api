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

export type CollateralSourceType = 'wallet' | 'aave' | 'univ3' | 'fpmm' | 'stability_pool';

export interface CollateralSource {
  type: CollateralSourceType;
  label: string;
  identifier: string;
  balance: string;
  usd_value: number;
}

export interface CollateralAssetSummary {
  symbol: string;
  chain: Chain;
  balance: string;
  usd_value: number;
  percentage: number;
  sources: CollateralSource[];
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
    const priceMap = await this.buildPriceMap(allPositions);
    this.applyPrices(allPositions, priceMap);
    time('USD enrichment', t);

    // Derive summaries
    const collateral = this.deriveCollateral(allPositions, priceMap);
    const reserveHeld = this.deriveReserveHeld(allPositions, priceMap);

    this.logger.log(
      `Positions total: ${Date.now() - totalStart}ms — Collateral: $${collateral.total_usd.toFixed(0)}, ` +
        `W:${walletBalances.length} A:${aaveDeposits.length} U3:${univ3Positions.length} ` +
        `FPMM:${fpmmPositions.length} CDP:${cdpTroves.length} SP:${stabilityPools.length}`,
    );

    return { collateral, reserve_held_supply: reserveHeld, positions: allPositions };
  }

  /**
   * Collect all unique symbols from every position type and fetch their prices.
   * One CMC/DeFiLlama call per symbol — shared by enrichment and both derivations.
   */
  private async buildPriceMap(positions: AllPositions): Promise<Map<string, number>> {
    // Only price symbols that contribute a non-zero amount somewhere — a zero
    // balance multiplied by any price is still zero, and fetching prices for
    // dust or decommissioned tokens is wasted CMC/DeFiLlama calls.
    const symbols = new Set<string>();
    const addIfNonZero = (symbol: string, amount: number | string) => {
      if (Number(amount) > 0) symbols.add(symbol);
    };
    for (const p of positions.wallet_balances) addIfNonZero(p.token, p.balance);
    for (const p of positions.aave_deposits) addIfNonZero(p.token, p.balance);
    for (const p of positions.stability_pool_deposits) {
      addIfNonZero(p.deposit_token, p.deposit_amount);
      addIfNonZero(p.collateral_gained_token, p.collateral_gained);
    }
    for (const p of positions.univ3_positions) {
      addIfNonZero(p.token0.symbol, p.token0.amount);
      addIfNonZero(p.token1.symbol, p.token1.amount);
    }
    for (const p of positions.fpmm_positions) {
      addIfNonZero(p.debt_token.symbol, p.debt_token.amount);
      addIfNonZero(p.collateral_token.symbol, p.collateral_token.amount);
    }
    for (const p of positions.cdp_troves) {
      addIfNonZero(p.collateral_token, p.collateral_amount);
    }

    const priceMap = new Map<string, number>();
    for (const sym of symbols) {
      priceMap.set(sym, await this.getTokenPrice(sym));
    }
    return priceMap;
  }

  /** Write USD values back onto position objects using the shared priceMap. */
  private applyPrices(positions: AllPositions, priceMap: Map<string, number>): void {
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

  /** Mento stables follow `[FIAT_TICKER]m` convention: 3 uppercase letters + lowercase 'm'. */
  private isMentoStable(symbol: string): boolean {
    return /^[A-Z]{3}m$/.test(symbol);
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

      // Crypto assets: CoinMarketCap or DeFiLlama. Require an ASSETS_CONFIGS entry —
      // symbols auto-discovered from on-chain (e.g. AXLWBTC in random UniV3 pools)
      // are not reliably priceable and would trigger 4x CMC retries with exponential
      // backoff, making the whole /reserve response block for ~2 minutes.
      const assetConfig = this.findAssetConfig(symbol);
      if (!assetConfig) return 0;

      if (assetConfig.useDefiLlamaPrice && assetConfig.address) {
        const chain = this.findAssetChain(symbol);
        const chainSlug = chain === Chain.ETHEREUM ? 'ethereum' : chain === Chain.CELO ? 'celo' : chain;
        return (await this.defiLlamaPriceFetcher.getPrice(`${chainSlug}:${assetConfig.address}`)) ?? 0;
      }

      return (await this.cmcPriceFetcher.getPrice(assetConfig.rateSymbol ?? symbol)) ?? 0;
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
   * Derive collateral summary from all positions. Mento stables (USDm, GBPm, ...)
   * are intentionally excluded — they flow into reserve_held instead.
   *
   * collateral = wallet_balances(!stable) + aave(!stable) + univ3(!stable)
   *            + fpmm(collateral side, !stable) + stability_pool(collateral_gained, !stable)
   */
  private deriveCollateral(positions: AllPositions, priceMap: Map<string, number>): CollateralSummary {
    // Track both the aggregated totals and the per-source contributions so the
    // frontend can render a dropdown under each asset that sums to the group total.
    interface Bucket {
      symbol: string;
      chain: Chain;
      amount: number;
      usdValue: number;
      sources: CollateralSource[];
    }
    const byKey = new Map<string, Bucket>();

    const add = (symbol: string, amount: number, chain: Chain, source: CollateralSource, usdOverride?: number) => {
      if (this.isMentoStable(symbol)) return; // stables belong in reserve_held
      // No canonicalization: axlUSDC, axlEUROC, WETH, WBTC all remain distinct so
      // the frontend can show which bridged/wrapped representation a balance came from.
      const key = `${symbol}:${chain}`;
      const bucket = byKey.get(key) ?? { symbol, chain, amount: 0, usdValue: 0, sources: [] };
      bucket.amount += amount;
      bucket.usdValue += usdOverride ?? amount * (priceMap.get(symbol) ?? 0);
      bucket.sources.push(source);
      byKey.set(key, bucket);
    };

    // Wallet balances that are NOT mento stables
    for (const p of positions.wallet_balances) {
      if (p.is_mento_stable) continue;
      add(
        p.token,
        Number(p.balance),
        p.chain,
        {
          type: 'wallet',
          label: p.label,
          identifier: p.address,
          balance: p.balance,
          usd_value: p.usd_value,
        },
        p.usd_value,
      );
    }

    // AAVE deposits that are NOT mento stables
    for (const p of positions.aave_deposits) {
      if (p.is_mento_stable) continue;
      add(
        p.token,
        Number(p.balance),
        p.chain,
        {
          type: 'aave',
          label: `AAVE — ${p.label}`,
          identifier: p.address,
          balance: p.balance,
          usd_value: p.usd_value,
        },
        p.usd_value,
      );
    }

    // UniV3 positions — each token side contributes independently; add() filters mento stables
    for (const p of positions.univ3_positions) {
      const poolLabel = `UniV3 ${p.token0.symbol}/${p.token1.symbol} — ${p.owner_label}`;
      const poolId = `${p.pool_address}#${p.position_id}`;
      const amount0 = Number(p.token0.amount);
      const amount1 = Number(p.token1.amount);
      if (amount0 > 0) {
        const usd0 = amount0 * (priceMap.get(p.token0.symbol) ?? 0);
        add(p.token0.symbol, amount0, p.chain, {
          type: 'univ3',
          label: poolLabel,
          identifier: poolId,
          balance: p.token0.amount,
          usd_value: usd0,
        });
      }
      if (amount1 > 0) {
        const usd1 = amount1 * (priceMap.get(p.token1.symbol) ?? 0);
        add(p.token1.symbol, amount1, p.chain, {
          type: 'univ3',
          label: poolLabel,
          identifier: poolId,
          balance: p.token1.amount,
          usd_value: usd1,
        });
      }
    }

    // FPMM collateral side
    for (const p of positions.fpmm_positions) {
      const usd = p.collateral_token.amount * (priceMap.get(p.collateral_token.symbol) ?? 0);
      add(p.collateral_token.symbol, p.collateral_token.amount, p.chain, {
        type: 'fpmm',
        label: `FPMM ${p.pool_name} — ${p.lp_holder_label}`,
        identifier: p.pool_address,
        balance: p.collateral_token.amount.toString(),
        usd_value: usd,
      });
    }

    // Stability pool collateral_gained (CELO from USDm pool; USDm from GBPm pool is filtered)
    for (const p of positions.stability_pool_deposits) {
      const amount = Number(p.collateral_gained);
      if (amount <= 0) continue;
      add(
        p.collateral_gained_token,
        amount,
        p.chain,
        {
          type: 'stability_pool',
          label: `${p.pool_label} — ${p.depositor_label}`,
          identifier: `${p.pool_address}:${p.depositor}`,
          balance: p.collateral_gained,
          usd_value: p.collateral_gained_usd,
        },
        p.collateral_gained_usd,
      );
    }

    // Sort buckets by USD, sort each bucket's sources by USD, compute percentages
    const buckets = Array.from(byKey.values()).sort((a, b) => b.usdValue - a.usdValue);
    const totalUsd = buckets.reduce((sum, a) => sum + a.usdValue, 0);

    const assets: CollateralAssetSummary[] = buckets.map((b) => ({
      symbol: b.symbol,
      chain: b.chain,
      balance: b.amount.toString(),
      usd_value: b.usdValue,
      percentage: totalUsd > 0 ? (b.usdValue / totalUsd) * 100 : 0,
      sources: [...b.sources].sort((x, y) => y.usd_value - x.usd_value),
    }));

    return { total_usd: totalUsd, assets };
  }

  /**
   * Derive reserve-held supply summary from all positions. Includes every mento
   * stable held by the reserve, whether sitting in a wallet, deposited into
   * AAVE/stability pools, locked as CDP collateral, or paired inside a UniV3/FPMM LP.
   *
   * reserve_held = wallet_balances(stable) + aave(stable) + fpmm(debt side)
   *              + univ3(stable sides) + stability_pool(deposit + stable coll_gained)
   *              + cdp_troves(collateral, since it's USDm)
   */
  private deriveReserveHeld(positions: AllPositions, priceMap: Map<string, number>): ReserveHeldSummary {
    const bySymbol = new Map<string, { amount: number; usdValue: number }>();

    const addHeld = (symbol: string, amount: number, usdOverride?: number) => {
      const existing = bySymbol.get(symbol) ?? { amount: 0, usdValue: 0 };
      existing.amount += amount;
      existing.usdValue += usdOverride ?? amount * (priceMap.get(symbol) ?? 0);
      bySymbol.set(symbol, existing);
    };

    // Wallet balances that ARE mento stables
    for (const p of positions.wallet_balances) {
      if (p.is_mento_stable) addHeld(p.token, Number(p.balance), p.usd_value);
    }

    // AAVE deposits that ARE mento stables
    for (const p of positions.aave_deposits) {
      if (p.is_mento_stable) addHeld(p.token, Number(p.balance), p.usd_value);
    }

    // FPMM debt side is always reserve-held. Collateral side is reserve-held
    // only when it's also a mento stable (stable-stable pools like USDm/EURm);
    // otherwise it's real collateral and has already been counted by deriveCollateral.
    for (const p of positions.fpmm_positions) {
      addHeld(p.debt_token.symbol, p.debt_token.amount);
      if (this.isMentoStable(p.collateral_token.symbol)) {
        addHeld(p.collateral_token.symbol, p.collateral_token.amount);
      }
    }

    // UniV3 stablecoin sides (USDm in USDm/USDC pools, etc.)
    for (const p of positions.univ3_positions) {
      const amount0 = Number(p.token0.amount);
      const amount1 = Number(p.token1.amount);
      if (amount0 > 0 && this.isMentoStable(p.token0.symbol)) addHeld(p.token0.symbol, amount0);
      if (amount1 > 0 && this.isMentoStable(p.token1.symbol)) addHeld(p.token1.symbol, amount1);
    }

    // Stability pool deposits (stablecoin deposits = reserve-held)
    for (const p of positions.stability_pool_deposits) {
      const amount = Number(p.deposit_amount);
      if (amount > 0) addHeld(p.deposit_token, amount, p.deposit_usd);
    }

    // Stability pool collateral_gained when it's a mento stable (GBPm pool gains USDm)
    for (const p of positions.stability_pool_deposits) {
      const amount = Number(p.collateral_gained);
      if (amount > 0 && this.isMentoStable(p.collateral_gained_token)) {
        addHeld(p.collateral_gained_token, amount, p.collateral_gained_usd);
      }
    }

    // CDP trove collateral — only the OVERHEAD (excess collateral after redemption + safety
    // buffer) is truly reserve-held. Computed once by CdpTroveReader so every consumer
    // (this aggregation, the /reserve response DTO, the frontend) sees the same number.
    // See CdpTroveOverhead in cdp-trove.reader.ts and CDP_WIGGLEROOM_PCT in cdp.config.ts.
    for (const p of positions.cdp_troves) {
      if (p.overhead.usd <= 0) continue;
      // USDm is $1-pegged so overhead amount == overhead USD.
      addHeld(p.collateral_token, p.overhead.usd, p.overhead.usd);
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
