import { Injectable, Logger } from '@nestjs/common';
import { MulticallBatchService } from '../multicall-batch.service';
import { getReserveAddressesByChain } from '../../config/reserve-addresses.config';
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
 * Stability pool configurations on Celo.
 * Each pool accepts deposits of a specific stablecoin and distributes
 * collateral from liquidated troves.
 */
const STABILITY_POOLS = [
  {
    address: '0x2d5d7E2767c5493610caE84E0AB7F9D2CCE8C1A5',
    label: 'StabilityPool (USDm)',
    depositToken: 'USDm',
    collateralToken: 'CELO',
  },
  {
    address: '0x06346c0fAB682dBde9f245D2D84677592E8aaa15',
    label: 'StabilityPool (GBPm)',
    depositToken: 'GBPm',
    collateralToken: 'USDm',
  },
] as const;

@Injectable()
export class StabilityPoolReader {
  private readonly logger = new Logger(StabilityPoolReader.name);

  constructor(private readonly multicallBatchService: MulticallBatchService) {}

  /**
   * Read stability pool deposits and collateral gains for all reserve addresses on Celo.
   */
  async readPositions(): Promise<StabilityPoolPosition[]> {
    const chain = Chain.CELO;
    const addresses = getReserveAddressesByChain(chain);
    if (addresses.length === 0) return [];

    try {
      // Build multicall: for each (pool, address), read deposit + collateral gain
      const calls = STABILITY_POOLS.flatMap((pool) =>
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

      for (const pool of STABILITY_POOLS) {
        for (const addr of addresses) {
          const depositRaw = results[callIdx++];
          const collGainRaw = results[callIdx++];

          // Skip if both are zero or null
          const hasDeposit = depositRaw != null && depositRaw > 0n;
          const hasCollGain = collGainRaw != null && collGainRaw > 0n;
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
    } catch (error) {
      this.logger.warn(`Failed to read stability pool positions: ${error}`);
      return [];
    }
  }
}
