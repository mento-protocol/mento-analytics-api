import { Chain } from '@/types';
import { retryWithCondition } from '@/utils';
import { MulticallService } from '@common/services/multicall.service';
import { Logger } from '@nestjs/common';
import { Provider } from 'ethers';

const MAX_BATCH_SIZE = 10; // Maximum number of calls in a single multicall
const BATCH_WINDOW_MS = 200; // Time in ms to wait for collecting calls into a batch

interface BalanceResult {
  balance: string;
  success: boolean;
}

export class ERC20BalanceFetcher {
  private readonly logger = new Logger(ERC20BalanceFetcher.name);
  private batchedCalls: Map<
    Chain,
    Array<{ token: string; account: string; resolve: (value: BalanceResult) => void; reject: (error: any) => void }>
  > = new Map();
  private batchTimeout: NodeJS.Timeout | null = null;

  constructor(
    private provider: Provider,
    private multicall: MulticallService,
    private chain: Chain,
  ) {}

  /**
   * Fetch the balance of a token for a given holder address
   * @param tokenAddress - The address of the token (or null for native token)
   * @param holderAddress - The address of the holder
   * @returns Object containing the balance and whether the call was successful
   */
  async fetchBalance(tokenAddress: string | null, holderAddress: string, chain: Chain): Promise<BalanceResult> {
    // Handle native token case directly
    if (!tokenAddress) {
      const balance = await this.fetchNativeBalance(holderAddress);
      return { balance, success: true };
    }

    // For ERC20 tokens, use batching
    return new Promise((resolve, reject) => {
      if (!this.batchedCalls.has(chain)) {
        this.batchedCalls.set(chain, []);
      }

      const batch = this.batchedCalls.get(chain);
      batch.push({ token: tokenAddress, account: holderAddress, resolve, reject });

      // If we've hit the max batch size, process immediately
      if (batch.length >= MAX_BATCH_SIZE) {
        if (this.batchTimeout) {
          clearTimeout(this.batchTimeout);
          this.batchTimeout = null;
        }
        this.processBatch(chain);
        return;
      }

      // Otherwise, set/reset the timeout to collect more calls
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout);
      }
      this.batchTimeout = setTimeout(() => this.processBatch(chain), BATCH_WINDOW_MS);
    });
  }

  private async fetchNativeBalance(holderAddress: string): Promise<string> {
    return retryWithCondition(
      async () => {
        try {
          const balance = await this.provider.getBalance(holderAddress);
          return balance.toString();
        } catch (error) {
          this.logger.error(
            `Failed to fetch native balance for holder=${holderAddress}, chain=${this.chain}, error=${error.message}`,
          );
          throw error;
        }
      },
      (balance) => balance !== undefined && balance !== null,
      {
        maxRetries: 5,
        logger: this.logger,
        baseDelay: 2000,
        warningMessage: `Failed to fetch native balance for ${holderAddress}`,
      },
    );
  }

  private async processBatch(chain: Chain) {
    const batch = this.batchedCalls.get(chain);
    if (!batch?.length) return;

    // Clear the timeout and batch
    this.batchTimeout = null;
    this.batchedCalls.set(chain, []);

    try {
      const results = await this.multicall.batchBalanceOf(
        chain,
        batch.map(({ token, account }) => ({ token, account })),
      );

      // Resolve all promises with their respective balances and success status
      batch.forEach(({ resolve, token, account }, index) => {
        const result = results[index];
        if (!result.success) {
          this.logger.warn(`Failed to fetch balance of token ${token} for account ${account} in this batch`);
          resolve({
            balance: '0',
            success: false,
          });
        } else {
          resolve({
            balance: result.returnData,
            success: true,
          });
        }
      });
    } catch (error) {
      // If batch request fails, reject all promises
      const isRateLimit = error?.code === 'BAD_DATA' && error?.value?.[0]?.code === -32005;
      this.logger.error(
        isRateLimit
          ? `Rate limit exceeded for chain ${chain}`
          : `Batch balance fetch failed for chain ${chain}: ${error.message}`,
      );
      batch.forEach(({ reject }) => reject(error));
    }
  }
}
