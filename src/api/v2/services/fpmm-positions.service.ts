import { Injectable, Logger } from '@nestjs/common';
import { ChainClientService } from '@common/services/chain-client.service';
import { MentoService } from '@common/services/mento.service';
import { PrimitiveCacheService } from './primitive-cache.service';
import { ASSETS_CONFIGS } from '@api/reserve/config/assets.config';
import { getReserveAddressesByChain } from '../config/reserve-addresses.config';
import { Chain } from '@types';
import { formatUnits, getAddress, PublicClient } from 'viem';

/**
 * A single FPMM pool position held by the reserve.
 * Splits the pool into debt-side (mento stablecoin = reserve-held, unbacked)
 * and collateral-side (non-stablecoin = reserve asset).
 */
export interface FpmmPosition {
  pool_address: string;
  chain: Chain;
  /** e.g. "USDm / USDC" */
  pool_name: string;
  /** Whether the pool is registered in the ReserveLiquidityStrategy */
  strategy_registered: boolean;
  /** Address holding the LP tokens */
  lp_holder: string;
  lp_holder_label: string;
  /** Percentage of pool LP tokens held by this holder */
  lp_share_pct: number;

  /** The debt (stablecoin) side — counts as reserve-held supply, NOT a liability */
  debt_token: { symbol: string; amount: number; address: string };
  /** The collateral side — counts as reserve asset */
  collateral_token: { symbol: string; amount: number; address: string };
}

// --- Contract addresses ---

/**
 * FPMM-related contracts per chain. Sourced from @mento-protocol/contracts.
 * The factory addresses are identical across Celo and Monad because they're
 * deployed deterministically via CREATE2 with the same salt. The contracts
 * package lists two factory versions (FPMMFactory v1 and FPMMFactoryv300) —
 * the pools we care about live under the v1 factory on both chains.
 */
const FPMM_CONTRACTS: Partial<Record<Chain, { factory: string; liquidityStrategy: string }>> = {
  [Chain.CELO]: {
    factory: '0xa849b475FE5a4B5C9C3280152c7a1945b907613b',
    liquidityStrategy: '0xa0fB8b16ce6AF3634fF9F3f4F40E49E1C1ae4f0B',
  },
  [Chain.MONAD]: {
    factory: '0xa849b475FE5a4B5C9C3280152c7a1945b907613b',
    liquidityStrategy: '0xa0fB8b16ce6AF3634fF9F3f4F40E49E1C1ae4f0B',
  },
};

// LP holders are derived from the canonical RESERVE_ADDRESSES list at call time —
// any address added there automatically gets scanned for FPMM LP balances.

// --- Minimal ABIs ---

const FACTORY_ABI = [
  {
    type: 'function',
    name: 'deployedFPMMAddresses',
    inputs: [],
    outputs: [{ type: 'address[]' }],
    stateMutability: 'view',
  },
] as const;

const STRATEGY_ABI = [
  { type: 'function', name: 'getPools', inputs: [], outputs: [{ type: 'address[]' }], stateMutability: 'view' },
  {
    type: 'function',
    name: 'poolConfigs',
    inputs: [{ type: 'address' }],
    outputs: [
      { name: 'isToken0Debt', type: 'bool' },
      { name: 'lastRebalance', type: 'uint32' },
      { name: 'rebalanceCooldown', type: 'uint32' },
      { name: 'protocolFeeRecipient', type: 'address' },
      { name: 'liquiditySourceIncentiveExpansion', type: 'uint64' },
      { name: 'protocolIncentiveExpansion', type: 'uint64' },
      { name: 'liquiditySourceIncentiveContraction', type: 'uint64' },
      { name: 'protocolIncentiveContraction', type: 'uint64' },
    ],
    stateMutability: 'view',
  },
] as const;

const POOL_ABI = [
  { type: 'function', name: 'token0', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'token1', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  {
    type: 'function',
    name: 'getReserves',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    stateMutability: 'view',
  },
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

@Injectable()
export class FpmmPositionsService {
  private readonly logger = new Logger(FpmmPositionsService.name);
  /** Cache of known stablecoin addresses (lowercase) → symbol */
  private stablecoinAddresses: Map<string, string> | null = null;

  constructor(
    private readonly chainClientService: ChainClientService,
    private readonly mentoService: MentoService,
    private readonly primitiveCacheService: PrimitiveCacheService,
  ) {}

  /**
   * Discover and read all FPMM positions held by reserve addresses on a chain.
   *
   * Discovery strategy (hybrid):
   *   1. AUTO: FPMMFactory.deployedFPMMAddresses() → all pools on the chain
   *   2. AUTO: ReserveLiquidityStrategy.getPools() → strategy-registered subset
   *   3. AUTO: ReserveLiquidityStrategy.poolConfigs(pool).isToken0Debt → debt classification
   *   4. CONFIG: RESERVE_ADDRESSES → which addresses to check for LP tokens
   *   5. AUTO: For non-strategy pools, classify debt by checking if token is a Mento stablecoin
   */
  async getPositions(chain: Chain): Promise<FpmmPosition[]> {
    const contracts = FPMM_CONTRACTS[chain];
    if (!contracts) return [];

    return await this.chainClientService.executeRateLimited<FpmmPosition[]>(chain, async (client: any) => {
      // Step 1 + 2: Discover pools (check structural cache first)
      let allPools: readonly `0x${string}`[];
      const cachedPools = await this.primitiveCacheService.getFpmmPools(chain);
      if (cachedPools) {
        allPools = cachedPools as `0x${string}`[];
        this.logger.debug(`Using ${cachedPools.length} cached FPMM pools for ${chain}`);
      } else {
        allPools = await client.readContract({
          address: getAddress(contracts.factory),
          abi: FACTORY_ABI,
          functionName: 'deployedFPMMAddresses',
        });
        await this.primitiveCacheService.setFpmmPools(chain, [...allPools]);
      }

      const strategyPools = await client.readContract({
        address: getAddress(contracts.liquidityStrategy),
        abi: STRATEGY_ABI,
        functionName: 'getPools',
      });
      const strategySet = new Set(strategyPools.map((p) => p.toLowerCase()));

      // Step 3: Get debt classification for strategy pools
      const strategyConfigs = new Map<string, boolean>();
      for (const pool of strategyPools) {
        const config = await client.readContract({
          address: getAddress(contracts.liquidityStrategy),
          abi: STRATEGY_ABI,
          functionName: 'poolConfigs',
          args: [pool],
        });
        strategyConfigs.set(pool.toLowerCase(), config[0]); // isToken0Debt
      }

      // Load stablecoin address map
      const stableMap = await this.getStablecoinAddresses();

      // Step 4 + 5: For each pool, check reserve holders and classify
      const holdersForChain = getReserveAddressesByChain(chain);
      const positions: FpmmPosition[] = [];

      for (const pool of allPools) {
        const pos = await this.readPoolPosition(
          client,
          pool,
          holdersForChain,
          strategySet.has(pool.toLowerCase()),
          strategyConfigs.get(pool.toLowerCase()),
          stableMap,
          chain,
        );
        positions.push(...pos);
      }

      this.logger.log(`FPMM positions on ${chain}: ${positions.length} positions across ${allPools.length} pools`);
      return positions;
    });
  }

  /**
   * Read a single pool and return positions for each reserve holder that has LP tokens.
   */
  private async readPoolPosition(
    client: PublicClient,
    poolAddress: `0x${string}`,
    holders: { address: string; label: string }[],
    isStrategyRegistered: boolean,
    isToken0Debt: boolean | undefined,
    stableMap: Map<string, string>,
    chain: Chain,
  ): Promise<FpmmPosition[]> {
    // Read pool state in parallel
    const [token0, token1, reserves, totalSupply] = await Promise.all([
      client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: 'token0' }),
      client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: 'token1' }),
      client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: 'getReserves' }),
      client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: 'totalSupply' }),
    ]);

    if (totalSupply === 0n) return [];

    // Determine debt classification
    let token0IsDebt: boolean;
    if (isToken0Debt !== undefined) {
      token0IsDebt = isToken0Debt;
    } else {
      const t0IsStable = stableMap.has(token0.toLowerCase());
      const t1IsStable = stableMap.has(token1.toLowerCase());
      if (t0IsStable && !t1IsStable) {
        token0IsDebt = true;
      } else if (!t0IsStable && t1IsStable) {
        token0IsDebt = false;
      } else {
        token0IsDebt = true;
      }
    }

    const t0Symbol = this.resolveSymbol(token0, chain, stableMap);
    const t1Symbol = this.resolveSymbol(token1, chain, stableMap);
    // FPMM reserves are stored in 18-decimal fixed-point regardless of underlying token decimals
    const r0 = Number(formatUnits(reserves[0], 18));
    const r1 = Number(formatUnits(reserves[1], 18));

    // Check each holder for LP tokens
    const positions: FpmmPosition[] = [];
    for (const holder of holders) {
      const lpBalance = await client.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'balanceOf',
        args: [getAddress(holder.address)],
      });

      if (lpBalance === 0n) continue;

      const share = Number(lpBalance) / Number(totalSupply);
      const holderR0 = r0 * share;
      const holderR1 = r1 * share;

      const debtSide = token0IsDebt
        ? { symbol: t0Symbol, amount: holderR0, address: token0 }
        : { symbol: t1Symbol, amount: holderR1, address: token1 };
      const collSide = token0IsDebt
        ? { symbol: t1Symbol, amount: holderR1, address: token1 }
        : { symbol: t0Symbol, amount: holderR0, address: token0 };

      positions.push({
        pool_address: poolAddress,
        chain,
        pool_name: `${t0Symbol} / ${t1Symbol}`,
        strategy_registered: isStrategyRegistered,
        lp_holder: holder.address,
        lp_holder_label: holder.label,
        lp_share_pct: share * 100,
        debt_token: debtSide,
        collateral_token: collSide,
      });
    }

    return positions;
  }

  /**
   * Resolve a token address to its symbol. Checks the Mento stablecoin map first,
   * then falls back to ASSETS_CONFIGS for non-stable tokens (USDC, AUSD, ...).
   * Final fallback is the truncated address.
   */
  private resolveSymbol(address: string, chain: Chain, stableMap: Map<string, string>): string {
    const lower = address.toLowerCase();
    const stable = stableMap.get(lower);
    if (stable) return stable;

    const chainAssets = ASSETS_CONFIGS[chain];
    if (chainAssets) {
      for (const asset of Object.values(chainAssets)) {
        if (asset.address?.toLowerCase() === lower) return asset.symbol;
      }
    }
    return address.slice(0, 10);
  }

  /**
   * Build a map of stablecoin contract addresses → symbols from the Mento SDK
   * across all initialized chains. Cached after first call.
   */
  private async getStablecoinAddresses(): Promise<Map<string, string>> {
    if (this.stablecoinAddresses) return this.stablecoinAddresses;

    const map = new Map<string, string>();
    for (const chain of this.mentoService.getInitializedChains()) {
      try {
        const mento = this.mentoService.getMentoInstanceForChain(chain);
        const tokens = await mento.tokens.getStableTokens();
        for (const t of tokens) {
          map.set(t.address.toLowerCase(), t.symbol);
        }
        this.logger.log(`Loaded ${tokens.length} stablecoin addresses from SDK for ${chain}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to load stablecoin addresses for ${chain}: ${msg}`);
      }
    }

    if (map.size === 0) {
      throw new Error('Failed to load stablecoin addresses from SDK on any chain');
    }

    this.stablecoinAddresses = map;
    return map;
  }
}
