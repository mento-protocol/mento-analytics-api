import { Injectable, Logger } from '@nestjs/common';
import { ChainClientService } from '@common/services/chain-client.service';
import { MulticallBatchService } from '../multicall-batch.service';
import { getReserveAddressesByChain } from '../../config/reserve-addresses.config';
import { UNIV3_POSITION_MANAGER_ADDRESS, UNIV3_FACTORY_ADDRESS } from '@api/reserve/constants/univ3-addresses';
import { ASSETS_CONFIGS } from '@api/reserve/config/assets.config';
import { Chain } from '@types';
import { getAddress, formatUnits, parseAbi } from 'viem';
import BigNumber from 'bignumber.js';
import { UNIV3_POSITION_MANAGER_ABI, UNIV3_POOL_ABI } from '@/common/constants';

export interface UniV3PositionDetail {
  position_id: number;
  owner: string;
  owner_label: string;
  chain: Chain;
  pool_address: string;
  fee_tier: number;
  token0: { symbol: string; address: string; amount: string };
  token1: { symbol: string; address: string; amount: string };
  liquidity: string;
  in_range: boolean;
}

@Injectable()
export class UniV3Reader {
  private readonly logger = new Logger(UniV3Reader.name);
  private readonly symbolCache = new Map<string, string>();

  constructor(
    private readonly chainClientService: ChainClientService,
    private readonly multicallBatchService: MulticallBatchService,
  ) {}

  /**
   * Read all UniV3 LP positions held by reserve addresses on Celo.
   * Returns per-position detail including both token amounts.
   */
  async readPositions(): Promise<UniV3PositionDetail[]> {
    const chain = Chain.CELO;
    const holders = getReserveAddressesByChain(chain);
    const positions: UniV3PositionDetail[] = [];

    for (const holder of holders) {
      try {
        const holderPositions = await this.readHolderPositions(chain, holder.address, holder.label);
        positions.push(...holderPositions);
      } catch (error) {
        this.logger.warn(`Failed to read UniV3 positions for ${holder.label}: ${error}`);
      }
    }

    this.logger.log(`UniV3 positions: ${positions.length} across ${holders.length} holders`);
    return positions;
  }

  private async readHolderPositions(chain: Chain, holderAddress: string, holderLabel: string): Promise<UniV3PositionDetail[]> {
    // Step 1: How many NFT positions does this holder own?
    const [balanceResult] = await this.multicallBatchService.batchRead<bigint>(chain, [{
      address: UNIV3_POSITION_MANAGER_ADDRESS,
      abi: parseAbi(UNIV3_POSITION_MANAGER_ABI),
      functionName: 'balanceOf',
      args: [holderAddress],
    }]);

    const numPositions = Number(balanceResult ?? 0n);
    if (numPositions === 0) return [];

    // Step 2: Get all token IDs
    const tokenIdCalls = Array.from({ length: numPositions }, (_, i) => ({
      address: UNIV3_POSITION_MANAGER_ADDRESS,
      abi: parseAbi(UNIV3_POSITION_MANAGER_ABI),
      functionName: 'tokenOfOwnerByIndex',
      args: [holderAddress, BigInt(i)],
    }));
    const tokenIdResults = await this.multicallBatchService.batchRead<bigint>(chain, tokenIdCalls);
    const tokenIds = tokenIdResults.filter((id): id is bigint => id != null).map(Number);

    if (tokenIds.length === 0) return [];

    // Step 3: Get position data for all token IDs
    const positionCalls = tokenIds.map((id) => ({
      address: UNIV3_POSITION_MANAGER_ADDRESS,
      abi: parseAbi(UNIV3_POSITION_MANAGER_ABI),
      functionName: 'positions',
      args: [BigInt(id)],
    }));
    const positionResults = await this.multicallBatchService.batchRead(chain, positionCalls);

    // Step 4: Filter to active positions (liquidity > 0) and get pool data
    const activePositions: { id: number; data: any; token0: string; token1: string; fee: number }[] = [];
    for (let i = 0; i < tokenIds.length; i++) {
      const pos = positionResults[i] as any;
      if (!pos) continue;
      const liquidity = BigInt(pos[7]?.toString?.() ?? pos.liquidity?.toString?.() ?? '0');
      if (liquidity === 0n) continue;

      activePositions.push({
        id: tokenIds[i],
        data: pos,
        token0: (pos[2] ?? pos.token0) as string,
        token1: (pos[3] ?? pos.token1) as string,
        fee: Number(pos[4] ?? pos.fee),
      });
    }

    if (activePositions.length === 0) return [];

    // Step 5: Get pool addresses + slot0 data
    const poolCalls = activePositions.map((p) => ({
      address: UNIV3_FACTORY_ADDRESS,
      abi: [{ type: 'function' as const, name: 'getPool', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }], stateMutability: 'view' as const }],
      functionName: 'getPool',
      args: [p.token0, p.token1, p.fee],
    }));
    const poolAddresses = await this.multicallBatchService.batchRead<string>(chain, poolCalls);

    const slot0Calls = poolAddresses.filter((a): a is string => !!a).map((poolAddr) => ({
      address: poolAddr,
      abi: parseAbi(UNIV3_POOL_ABI),
      functionName: 'slot0',
    }));
    const slot0Results = await this.multicallBatchService.batchRead(chain, slot0Calls);

    // Step 6: Calculate per-position amounts
    const details: UniV3PositionDetail[] = [];
    let slot0Idx = 0;
    for (let i = 0; i < activePositions.length; i++) {
      const { id, data, token0, token1, fee } = activePositions[i];
      const poolAddr = poolAddresses[i];
      if (!poolAddr) continue;

      const slot0 = slot0Results[slot0Idx++];
      if (!slot0) continue;

      const liquidity = new BigNumber((data[7] as bigint).toString());
      const sqrtPriceX96 = new BigNumber(((slot0 as any)[0] as bigint).toString());
      const Q96 = new BigNumber(2).pow(96);
      const sqrtPrice = sqrtPriceX96.dividedBy(Q96);
      const currentTick = sqrtPrice.isGreaterThan(0)
        ? Math.floor(Math.log(sqrtPrice.toNumber() ** 2) / Math.log(1.0001))
        : 0;

      const tickLower = Number(data[5]);
      const tickUpper = Number(data[6]);
      const [amount0, amount1] = this.calculateAmounts(liquidity, currentTick, tickLower, tickUpper, sqrtPrice);

      const token0Symbol = await this.resolveSymbol(token0, chain);
      const token1Symbol = await this.resolveSymbol(token1, chain);
      const token0Decimals = this.getDecimals(token0, chain);
      const token1Decimals = this.getDecimals(token1, chain);

      const inRange = currentTick >= tickLower && currentTick < tickUpper;

      details.push({
        position_id: id,
        owner: holderAddress,
        owner_label: holderLabel,
        chain,
        pool_address: poolAddr,
        fee_tier: fee,
        token0: {
          symbol: token0Symbol,
          address: token0,
          amount: formatUnits(BigInt(amount0.integerValue(BigNumber.ROUND_DOWN).toString(10)), token0Decimals),
        },
        token1: {
          symbol: token1Symbol,
          address: token1,
          amount: formatUnits(BigInt(amount1.integerValue(BigNumber.ROUND_DOWN).toString(10)), token1Decimals),
        },
        liquidity: liquidity.toString(10),
        in_range: inRange,
      });
    }

    return details;
  }

  private calculateAmounts(
    liquidity: BigNumber, currentTick: number, tickLower: number, tickUpper: number, sqrtPrice: BigNumber,
  ): [BigNumber, BigNumber] {
    try {
      const sqrtRatioLower = new BigNumber(Math.sqrt(1.0001 ** tickLower));
      const sqrtRatioUpper = new BigNumber(Math.sqrt(1.0001 ** tickUpper));
      let amount0 = new BigNumber(0);
      let amount1 = new BigNumber(0);

      if (currentTick < tickLower) {
        const num = sqrtRatioUpper.minus(sqrtRatioLower);
        const den = sqrtRatioUpper.multipliedBy(sqrtRatioLower);
        if (!den.isZero()) amount0 = liquidity.multipliedBy(num.dividedBy(den));
      } else if (currentTick < tickUpper) {
        const num = sqrtRatioUpper.minus(sqrtPrice);
        const den = sqrtPrice.multipliedBy(sqrtRatioUpper);
        if (!den.isZero()) amount0 = liquidity.multipliedBy(num.dividedBy(den));
        amount1 = liquidity.multipliedBy(sqrtPrice.minus(sqrtRatioLower));
      } else {
        amount1 = liquidity.multipliedBy(sqrtRatioUpper.minus(sqrtRatioLower));
      }

      return [
        amount0.isFinite() ? amount0.abs() : new BigNumber(0),
        amount1.isFinite() ? amount1.abs() : new BigNumber(0),
      ];
    } catch {
      return [new BigNumber(0), new BigNumber(0)];
    }
  }

  private async resolveSymbol(tokenAddress: string, chain: Chain): Promise<string> {
    const lower = tokenAddress.toLowerCase();
    if (this.symbolCache.has(lower)) return this.symbolCache.get(lower)!;

    // Check asset configs
    const chainAssets = ASSETS_CONFIGS[chain];
    if (chainAssets) {
      for (const asset of Object.values(chainAssets)) {
        if (asset.address?.toLowerCase() === lower) {
          this.symbolCache.set(lower, asset.symbol);
          return asset.symbol;
        }
      }
    }

    // Fallback: read symbol from chain
    try {
      const [symbol] = await this.multicallBatchService.batchRead<string>(chain, [{
        address: tokenAddress,
        abi: [{ type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' }],
        functionName: 'symbol',
      }]);
      const resolved = symbol ?? tokenAddress.slice(0, 10);
      this.symbolCache.set(lower, resolved);
      return resolved;
    } catch {
      return tokenAddress.slice(0, 10);
    }
  }

  private getDecimals(tokenAddress: string, chain: Chain): number {
    const chainAssets = ASSETS_CONFIGS[chain];
    if (chainAssets) {
      for (const asset of Object.values(chainAssets)) {
        if (asset.address?.toLowerCase() === tokenAddress.toLowerCase()) return asset.decimals;
      }
    }
    return 18; // default
  }
}
