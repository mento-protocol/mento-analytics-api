import { Injectable, Logger } from '@nestjs/common';
import { parseAbi, PublicClient } from 'viem';
import BigNumber from 'bignumber.js';
import { ChainClientService } from '@/common/services/chain-client.service';
import { Chain } from '@types';
import { ERC20_ABI, UNIV3_POSITION_MANAGER_ABI, UNIV3_FACTORY_ABI, UNIV3_POOL_ABI } from '@/common/constants';
import { withRetry, RETRY_CONFIGS } from '@/utils';

const BATCH_SIZE = 5;
const BATCH_DELAY = 100;

/**
 * Calculates the amount of tokens held in Uniswap V3 positions.
 */
@Injectable()
export class UniV3SupplyCalculator {
  private readonly logger = new Logger(UniV3SupplyCalculator.name);
  private readonly decimalsCache: Map<string, number> = new Map();
  private readonly poolCache: Map<string, string> = new Map();

  constructor(private readonly chainClientService: ChainClientService) {}

  /**
   * Gets the total amount of a token held in Uniswap V3 positions for the specified governance address.
   * @param tokenAddress - The address of the token to calculate.
   * @param positionManagerAddress - The Uniswap V3 NonfungiblePositionManager address.
   * @param factoryAddress - The Uniswap V3 Factory address.
   * @param governanceAddress - The address holding the LP positions.
   * @param chain - The chain to query.
   * @returns The total amount of the token in the positions.
   */
  async getAmount(
    tokenAddress: string,
    positionManagerAddress: string,
    factoryAddress: string,
    governanceAddress: string,
    chain: Chain,
  ): Promise<bigint> {
    const client = this.chainClientService.getClient(chain);

    try {
      const positions = await this.getPositionTokenIds(client, positionManagerAddress, governanceAddress);
      if (positions.length === 0) return 0n;

      let totalAmount = new BigNumber(0);

      // Process positions in batches
      for (let i = 0; i < positions.length; i += BATCH_SIZE) {
        const batchPositions = positions.slice(i, i + BATCH_SIZE);

        const batchAmount = await withRetry(
          () => this.processPositionBatch(client, batchPositions, tokenAddress, positionManagerAddress, factoryAddress),
          `Failed to process UniV3 position batch`,
          { ...RETRY_CONFIGS.SDK_OPERATION, logger: this.logger },
        );
        totalAmount = totalAmount.plus(batchAmount);

        if (i + BATCH_SIZE < positions.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
        }
      }

      try {
        const rawAmount = totalAmount.integerValue(BigNumber.ROUND_DOWN).abs().toString(10);
        const cleanAmount = this.normalizeNumberString(rawAmount);
        return BigInt(cleanAmount);
      } catch (error) {
        this.logger.error(`Error converting to bigint: ${error}`);
        return 0n;
      }
    } catch (error) {
      this.logger.error(`Failed to calculate UniV3 supply for token ${tokenAddress}: ${error}`);
      throw error;
    }
  }

  private normalizeNumberString(value: string): string {
    if (value.includes('e')) {
      const [mantissa, exponent] = value.split('e');
      const e = parseInt(exponent);
      if (e > 0) {
        return mantissa.replace('.', '') + '0'.repeat(e);
      }
      return '0';
    }
    return value.split('.')[0];
  }

  private async getPositionTokenIds(
    client: PublicClient,
    positionManagerAddress: string,
    governanceAddress: string,
  ): Promise<number[]> {
    const balance = (await client.readContract({
      address: positionManagerAddress as `0x${string}`,
      abi: parseAbi(UNIV3_POSITION_MANAGER_ABI),
      functionName: 'balanceOf',
      args: [governanceAddress as `0x${string}`],
    })) as bigint;

    const numPositions = Number(balance);
    if (numPositions === 0) return [];

    const tokenIds: number[] = [];
    for (let i = 0; i < numPositions; i += BATCH_SIZE) {
      const batchPromises = Array.from({ length: Math.min(BATCH_SIZE, numPositions - i) }, (_, index) =>
        client
          .readContract({
            address: positionManagerAddress as `0x${string}`,
            abi: parseAbi(UNIV3_POSITION_MANAGER_ABI),
            functionName: 'tokenOfOwnerByIndex',
            args: [governanceAddress as `0x${string}`, BigInt(i + index)],
          })
          .then((id) => Number(id)),
      );

      const batchResults = await Promise.all(batchPromises);
      tokenIds.push(...batchResults);

      if (i + BATCH_SIZE < numPositions) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
      }
    }

    return tokenIds;
  }

  private async processPositionBatch(
    client: PublicClient,
    positionIds: number[],
    targetToken: string,
    positionManagerAddress: string,
    factoryAddress: string,
  ): Promise<BigNumber> {
    try {
      // Fetch position data
      const positionDataPromises = positionIds.map((id) =>
        client.readContract({
          address: positionManagerAddress as `0x${string}`,
          abi: parseAbi(UNIV3_POSITION_MANAGER_ABI),
          functionName: 'positions',
          args: [BigInt(id)],
        }),
      );

      const positionData = await Promise.all(positionDataPromises);

      // Filter active positions that contain our target token
      const activePositions = positionData.filter((pos) => {
        const liquidity = new BigNumber((pos[7] as bigint).toString());
        return !liquidity.isZero() && (pos[2] === targetToken || pos[3] === targetToken);
      });

      if (activePositions.length === 0) return new BigNumber(0);

      // Get pool addresses
      const poolAddresses = await Promise.all(
        activePositions.map((pos) =>
          this.getPoolAddress(client, factoryAddress, pos[2] as string, pos[3] as string, Number(pos[4])),
        ),
      );

      // Get slot0 data for all pools
      const slot0Data = await Promise.all(
        poolAddresses.map((poolAddress) =>
          client.readContract({
            address: poolAddress as `0x${string}`,
            abi: parseAbi(UNIV3_POOL_ABI),
            functionName: 'slot0',
          }),
        ),
      );

      // Calculate total amount
      let totalAmount = new BigNumber(0);

      for (let i = 0; i < activePositions.length; i++) {
        const pos = activePositions[i];
        const slot0 = slot0Data[i];

        const amount = this.calculatePositionAmount(pos, slot0, targetToken);
        totalAmount = totalAmount.plus(amount);
      }

      return totalAmount;
    } catch (error) {
      this.logger.error(`Failed to process position batch: ${error}`);
      return new BigNumber(0);
    }
  }

  private async getPoolAddress(
    client: PublicClient,
    factoryAddress: string,
    token0: string,
    token1: string,
    fee: number,
  ): Promise<string> {
    const cacheKey = `${token0}-${token1}-${fee}`;
    if (this.poolCache.has(cacheKey)) {
      return this.poolCache.get(cacheKey)!;
    }

    const poolAddress = (await client.readContract({
      address: factoryAddress as `0x${string}`,
      abi: parseAbi(UNIV3_FACTORY_ABI),
      functionName: 'getPool',
      args: [token0 as `0x${string}`, token1 as `0x${string}`, fee],
    })) as string;

    this.poolCache.set(cacheKey, poolAddress);
    return poolAddress;
  }

  private calculatePositionAmount(position: readonly unknown[], slot0: readonly unknown[], targetToken: string): BigNumber {
    const liquidity = new BigNumber((position[7] as bigint).toString());
    const sqrtPriceX96 = new BigNumber((slot0[0] as bigint).toString());
    const Q96 = new BigNumber(2).pow(96);

    const sqrtPriceX96Num = sqrtPriceX96.dividedBy(Q96);
    const currentTick = sqrtPriceX96Num.isGreaterThan(0)
      ? Math.floor(Math.log(sqrtPriceX96Num.toNumber() ** 2) / Math.log(1.0001))
      : 0;

    const tickLower = Number(position[5]);
    const tickUpper = Number(position[6]);

    const [amount0, amount1] = this.calculateAmounts(liquidity, currentTick, tickLower, tickUpper, sqrtPriceX96Num);

    const isToken0 = position[2] === targetToken;
    return isToken0 ? amount0 : amount1;
  }

  private calculateAmounts(
    liquidity: BigNumber,
    currentTick: number,
    tickLower: number,
    tickUpper: number,
    sqrtPrice: BigNumber,
  ): [BigNumber, BigNumber] {
    try {
      const sqrtRatioLower = new BigNumber(Math.sqrt(1.0001 ** tickLower));
      const sqrtRatioUpper = new BigNumber(Math.sqrt(1.0001 ** tickUpper));

      let amount0 = new BigNumber(0);
      let amount1 = new BigNumber(0);

      if (currentTick < tickLower) {
        const amount0Numerator = sqrtRatioUpper.minus(sqrtRatioLower);
        const amount0Denominator = sqrtRatioUpper.multipliedBy(sqrtRatioLower);
        if (!amount0Denominator.isZero()) {
          amount0 = liquidity.multipliedBy(amount0Numerator.dividedBy(amount0Denominator));
        }
      } else if (currentTick < tickUpper) {
        const amount0Numerator = sqrtRatioUpper.minus(sqrtPrice);
        const amount0Denominator = sqrtPrice.multipliedBy(sqrtRatioUpper);
        if (!amount0Denominator.isZero()) {
          amount0 = liquidity.multipliedBy(amount0Numerator.dividedBy(amount0Denominator));
        }
        amount1 = liquidity.multipliedBy(sqrtPrice.minus(sqrtRatioLower));
      } else {
        amount1 = liquidity.multipliedBy(sqrtRatioUpper.minus(sqrtRatioLower));
      }

      return [
        amount0.isFinite() ? amount0.integerValue(BigNumber.ROUND_DOWN) : new BigNumber(0),
        amount1.isFinite() ? amount1.integerValue(BigNumber.ROUND_DOWN) : new BigNumber(0),
      ];
    } catch (error) {
      this.logger.error(`Error calculating amounts: ${error}`);
      return [new BigNumber(0), new BigNumber(0)];
    }
  }
}
