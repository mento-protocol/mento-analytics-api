import { Injectable, Logger } from '@nestjs/common';
import { MulticallBatchService } from '../multicall-batch.service';
import { getReserveAddressesByChain } from '../../config/reserve-addresses.config';
import { CDP_REGISTRIES, ADDRESSES_REGISTRY_ABI } from '../../config/cdp.config';
import { Chain } from '@types';
import { formatUnits } from 'viem';

export interface StabilityPoolPosition {
  pool_address: string;
  pool_label: string;
  chain: Chain;
  depositor: string;
  depositor_label: string;
  /** What was deposited (stablecoin -> reserve-held) */
  deposit_token: string;
  deposit_amount: string;
  deposit_usd: number;
  /** Collateral gained from liquidations (-> reserve collateral) */
  collateral_gained_token: string;
  collateral_gained: string;
  collateral_gained_usd: number;
}

const STABILITY_POOL_ABI = [
  {
    type: 'function',
    name: 'getCompoundedBoldDeposit',
    inputs: [{ name: '_depositor', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDepositorCollGain',
    inputs: [{ name: '_depositor', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

/**
 * Static stability pool configurations (non-CDP or legacy pools).
 */
const STATIC_STABILITY_POOLS = [
  {
    address: '0x2d5d7E2767c5493610caE84E0AB7F9D2CCE8C1A5',
    label: 'StabilityPool (USDm)',
    depositToken: 'USDm',
    collateralToken: 'CELO',
  },
] as const;

interface StabilityPoolConfig {
  address: string;
  label: string;
  depositToken: string;
  collateralToken: string;
}

@Injectable()
export class StabilityPoolReader {
  private readonly logger = new Logger(StabilityPoolReader.name);
  private resolvedPools: StabilityPoolConfig[] | null = null;

  constructor(private readonly multicallBatchService: MulticallBatchService) {}

  /**
   * Resolve stability pool addresses from CDP registries, combined with static pools.
   * Cached after first call.
   */
  private async getStabilityPools(chain: Chain): Promise<StabilityPoolConfig[]> {
    if (this.resolvedPools) return this.resolvedPools;

    const pools: StabilityPoolConfig[] = [...STATIC_STABILITY_POOLS];

    // Resolve stability pool addresses from CDP registries
    const registryEntries = Object.entries(CDP_REGISTRIES);
    if (registryEntries.length > 0) {
      const calls = registryEntries.map(([, registryAddress]) => ({
        address: registryAddress,
        abi: [...ADDRESSES_REGISTRY_ABI],
        functionName: 'stabilityPool',
      }));

      const results = await this.multicallBatchService.batchRead<string>(chain, calls);

      for (let i = 0; i < registryEntries.length; i++) {
        const [symbol] = registryEntries[i];
        const poolAddress = results[i];
        if (poolAddress) {
          pools.push({
            address: poolAddress,
            label: `StabilityPool (${symbol})`,
            depositToken: symbol,
            collateralToken: 'USDm',
          });
          this.logger.log(`Resolved ${symbol} StabilityPool: ${poolAddress}`);
        }
      }
    }

    this.resolvedPools = pools;
    return pools;
  }

  /**
   * Read stability pool deposits and collateral gains for all reserve addresses on Celo.
   */
  async readPositions(): Promise<StabilityPoolPosition[]> {
    const chain = Chain.CELO;
    const addresses = getReserveAddressesByChain(chain);
    if (addresses.length === 0) return [];

    const stabilityPools = await this.getStabilityPools(chain);

    // Build multicall: for each (pool, address), read deposit + collateral gain
    const calls = stabilityPools.flatMap((pool) =>
      addresses.flatMap((addr) => [
        {
          address: pool.address,
          abi: [...STABILITY_POOL_ABI],
          functionName: 'getCompoundedBoldDeposit',
          args: [addr.address],
        },
        {
          address: pool.address,
          abi: [...STABILITY_POOL_ABI],
          functionName: 'getDepositorCollGain',
          args: [addr.address],
        },
      ]),
    );

    const results = await this.multicallBatchService.batchRead<bigint>(chain, calls);

    const positions: StabilityPoolPosition[] = [];
    let callIdx = 0;

    for (const pool of stabilityPools) {
      for (const addr of addresses) {
        const depositRaw = results[callIdx++];
        const collGainRaw = results[callIdx++];
        if (depositRaw == null || collGainRaw == null) {
          this.logger.warn(`Multicall returned null for stability pool ${pool.label} / ${addr.label}, skipping`);
          continue;
        }

        const hasDeposit = depositRaw > 0n;
        const hasCollGain = collGainRaw > 0n;
        if (!hasDeposit && !hasCollGain) continue;

        const depositAmount = hasDeposit ? formatUnits(depositRaw, 18) : '0';
        const collGainAmount = hasCollGain ? formatUnits(collGainRaw, 18) : '0';

        positions.push({
          pool_address: pool.address,
          pool_label: pool.label,
          chain,
          depositor: addr.address,
          depositor_label: addr.label,
          deposit_token: pool.depositToken,
          deposit_amount: depositAmount,
          deposit_usd: 0, // enriched later by orchestrator
          collateral_gained_token: pool.collateralToken,
          collateral_gained: collGainAmount,
          collateral_gained_usd: 0, // enriched later by orchestrator
        });
      }
    }

    this.logger.log(`Stability pool positions: ${positions.length} non-zero positions`);
    return positions;
  }
}
