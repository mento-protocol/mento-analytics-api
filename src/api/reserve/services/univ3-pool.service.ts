import { Injectable, Logger } from '@nestjs/common';
import { Contract, Provider } from 'ethers';
import {
  UNIV3_FACTORY_ADDRESS,
  UNIV3_FACTORY_ABI,
  UNIV3_POOL_ABI,
  UNIV3_POSITION_MANAGER_ADDRESS,
  UNIV3_POSITION_MANAGER_ABI,
} from '../constants';
import { ERC20_ABI } from '@mento-protocol/mento-sdk';
import BigNumber from 'bignumber.js';
import { ASSETS_CONFIGS } from '../config/assets.config';
import { AssetSymbol, Chain } from '@/types';

const RPC_TIMEOUT = 90000;
const BATCH_SIZE = 5;
const BATCH_DELAY = 100;

@Injectable()
export class UniV3PoolService {
  private readonly logger = new Logger(UniV3PoolService.name);
  private readonly positionManagerContract: Contract;
  private readonly factoryContract: Contract;
  private readonly decimalsCache: Map<string, number> = new Map();
  private readonly poolCache: Map<string, string> = new Map();
  private readonly poolContractCache: Map<string, Contract> = new Map();

  constructor(
    private readonly provider: Provider,
    private readonly chain: Chain,
  ) {
    // TODO: The Uni addresses really should be in a mapping of chain to addresses
    this.positionManagerContract = new Contract(UNIV3_POSITION_MANAGER_ADDRESS, UNIV3_POSITION_MANAGER_ABI, provider);
    this.factoryContract = new Contract(UNIV3_FACTORY_ADDRESS, UNIV3_FACTORY_ABI, provider);
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('RPC Timeout')), RPC_TIMEOUT)),
    ]);
  }

  public async getPositionBalances(accountAddress: string): Promise<Map<string, number>> {
    try {
      const positions = await this.withTimeout(this.getPositionTokenIds(accountAddress));
      if (positions.length === 0) return new Map();

      const holdings = new Map<string, number>();

      // Process positions in batches
      for (let i = 0; i < positions.length; i += BATCH_SIZE) {
        const batchPositions = positions.slice(i, i + BATCH_SIZE);
        await this.processPositionBatch(batchPositions, holdings);

        if (i + BATCH_SIZE < positions.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
        }
      }

      return holdings;
    } catch (error) {
      this.logger.error('Failed to fetch position balances:', error);
      throw error;
    }
  }

  private async processPositionBatch(positionIds: number[], holdings: Map<string, number>): Promise<void> {
    try {
      // Fetch position data for batch
      const positionDataPromises = positionIds.map((id) =>
        this.withTimeout(this.positionManagerContract.positions(id)),
      );
      const positionData = await Promise.all(positionDataPromises);

      // Filter active positions by checking if liquidity is not zero
      const activePositions = positionData.filter((pos) => !new BigNumber(pos[7].toString()).isZero());
      if (activePositions.length === 0) return;

      // Get pool addresses with cache
      const poolAddresses = await this.getPoolAddressesWithCache(activePositions);

      // Get slot0 data with cached contracts
      const slot0Data = await this.getSlot0DataWithCache(poolAddresses);

      // Prefetch all decimals
      const uniqueTokens = new Set(activePositions.flatMap((pos) => [pos[2], pos[3]]));
      await this.batchFetchDecimals(Array.from(uniqueTokens));

      // Process each position
      for (let i = 0; i < activePositions.length; i++) {
        await this.processSinglePosition(activePositions[i], slot0Data[i], holdings);
      }
    } catch (error) {
      this.logger.error('Failed to process position batch:', error);
    }
  }

  private async processSinglePosition(pos: any, slot0: any, holdings: Map<string, number>): Promise<void> {
    try {
      const liquidity = new BigNumber(pos[7].toString());
      const sqrtPriceX96 = new BigNumber(slot0[0].toString());
      const Q96 = new BigNumber(2).exponentiatedBy(96);

      const sqrtPriceX96Num = sqrtPriceX96.dividedBy(Q96);
      const currentTick = sqrtPriceX96Num.isGreaterThan(0)
        ? Math.floor(Math.log(sqrtPriceX96Num.toNumber() ** 2) / Math.log(1.0001))
        : 0;

      const token0 = pos[2];
      const token1 = pos[3];
      const tickLower = Number(pos[5]);
      const tickUpper = Number(pos[6]);

      this.logger.debug('Processing position:', {
        token0,
        token1,
        tickLower,
        tickUpper,
        currentTick,
        liquidity: liquidity.toString(),
      });

      const [amount0, amount1] = this.calculateAmounts(liquidity, currentTick, tickLower, tickUpper, sqrtPriceX96Num);

      this.addToHoldings(holdings, token0, token1, amount0, amount1);
    } catch (error) {
      this.logger.error('Failed to process position:', error);
    }
  }

  private async getPoolAddressesWithCache(positions: any[]): Promise<string[]> {
    const poolPromises = positions.map(async (pos) => {
      const cacheKey = `${pos[2]}-${pos[3]}-${pos[4]}`;
      if (this.poolCache.has(cacheKey)) {
        return this.poolCache.get(cacheKey)!;
      }

      const address = await this.withTimeout(this.factoryContract.getPool(pos[2], pos[3], pos[4]));
      this.poolCache.set(cacheKey, address);
      return address;
    });

    return await Promise.all(poolPromises);
  }

  private async getSlot0DataWithCache(poolAddresses: string[]): Promise<any[]> {
    const slot0Promises = poolAddresses.map((address) => {
      let contract = this.poolContractCache.get(address);
      if (!contract) {
        contract = new Contract(address, UNIV3_POOL_ABI, this.provider);
        this.poolContractCache.set(address, contract);
      }
      return this.withTimeout(contract.slot0());
    });

    return await Promise.all(slot0Promises);
  }

  private async batchFetchDecimals(tokenAddresses: string[]): Promise<void> {
    const uncachedTokens = tokenAddresses.filter((addr) => !this.decimalsCache.has(addr));
    if (uncachedTokens.length === 0) return;

    const decimalsPromises = uncachedTokens.map(async (addr) => {
      try {
        let decimals = 18;
        const assetConfig = ASSETS_CONFIGS[this.chain][addr as AssetSymbol];
        if (assetConfig) {
          decimals = assetConfig.decimals;
        } else {
          // In the unlikely event that the decimals are not in assets.config,
          // we will fallback to the contract.
          const contract = new Contract(addr, ERC20_ABI, this.provider);
          decimals = await this.withTimeout(contract.decimals());
        }
        return [addr, decimals];
      } catch (error) {
        this.logger.warn(`Failed to fetch decimals for ${addr}, using default:`, error);
        return [addr, 18];
      }
    });

    const results = await Promise.all(decimalsPromises);
    results.forEach(([addr, decimals]: [string, number]) => {
      this.decimalsCache.set(addr, decimals);
    });
  }

  private calculateAmounts(
    liquidity: BigNumber,
    currentTick: number,
    tickLower: number,
    tickUpper: number,
    sqrtPrice: BigNumber,
  ): [BigNumber, BigNumber] {
    try {
      // Safely calculate sqrt ratios
      const sqrtRatioLower = new BigNumber(Math.sqrt(1.0001 ** tickLower));
      const sqrtRatioUpper = new BigNumber(Math.sqrt(1.0001 ** tickUpper));

      let amount0 = new BigNumber(0);
      let amount1 = new BigNumber(0);

      if (currentTick < tickLower) {
        // Price below range
        const amount0Numerator = sqrtRatioUpper.minus(sqrtRatioLower);
        const amount0Denominator = sqrtRatioUpper.multipliedBy(sqrtRatioLower);
        if (!amount0Denominator.isZero()) {
          amount0 = liquidity.multipliedBy(amount0Numerator.dividedBy(amount0Denominator));
        }
      } else if (currentTick < tickUpper) {
        // Price in range
        const amount0Numerator = sqrtRatioUpper.minus(sqrtPrice);
        const amount0Denominator = sqrtPrice.multipliedBy(sqrtRatioUpper);
        if (!amount0Denominator.isZero()) {
          amount0 = liquidity.multipliedBy(amount0Numerator.dividedBy(amount0Denominator));
        }
        amount1 = liquidity.multipliedBy(sqrtPrice.minus(sqrtRatioLower));
      } else {
        // Price above range
        amount1 = liquidity.multipliedBy(sqrtRatioUpper.minus(sqrtRatioLower));
      }

      this.logger.debug(`Amount calculation results:
        amount0: ${amount0.toString()}
        amount1: ${amount1.toString()}
      `);

      return [
        amount0.isFinite() ? amount0.integerValue(BigNumber.ROUND_DOWN) : new BigNumber(0),
        amount1.isFinite() ? amount1.integerValue(BigNumber.ROUND_DOWN) : new BigNumber(0),
      ];
    } catch (error) {
      this.logger.error('Error calculating amounts:', {
        error,
        currentTick,
        tickLower,
        tickUpper,
        liquidityStr: liquidity.toString(),
        sqrtPriceStr: sqrtPrice.toString(),
      });
      return [new BigNumber(0), new BigNumber(0)];
    }
  }

  private addToHoldings(
    holdings: Map<string, number>,
    token0: string,
    token1: string,
    amount0: BigNumber,
    amount1: BigNumber,
  ): void {
    const decimals0 = this.decimalsCache.get(token0) || 18;
    const decimals1 = this.decimalsCache.get(token1) || 18;

    const normalizedAmount0 = amount0.dividedBy(new BigNumber(10).exponentiatedBy(decimals0)).toNumber();
    const normalizedAmount1 = amount1.dividedBy(new BigNumber(10).exponentiatedBy(decimals1)).toNumber();

    this.logger.debug(`Adding to holdings:
      token0: ${token0} amount: ${normalizedAmount0}
      token1: ${token1} amount: ${normalizedAmount1}
    `);

    holdings.set(token0, (holdings.get(token0) || 0) + normalizedAmount0);
    holdings.set(token1, (holdings.get(token1) || 0) + normalizedAmount1);
  }

  public async getPositionTokenIds(accountAddress: string): Promise<number[]> {
    try {
      const balanceOf = await this.withTimeout(this.positionManagerContract.balanceOf(accountAddress));
      const numPositions = Number(balanceOf);
      if (numPositions === 0) return [];

      const indices = Array.from({ length: numPositions }, (_, i) => i);

      const tokenIds = [];
      for (let i = 0; i < indices.length; i += BATCH_SIZE) {
        const batchIndices = indices.slice(i, i + BATCH_SIZE);
        const batchPromises = batchIndices.map((index) =>
          this.withTimeout(this.positionManagerContract.tokenOfOwnerByIndex(accountAddress, index)).then((tokenId) =>
            Number(tokenId),
          ),
        );
        const batchResults = await Promise.all(batchPromises);
        tokenIds.push(...batchResults);

        if (i + BATCH_SIZE < indices.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
        }
      }

      return tokenIds;
    } catch (error) {
      this.logger.error(`Failed to fetch position token IDs for ${accountAddress}:`, error);
      throw error;
    }
  }
}
