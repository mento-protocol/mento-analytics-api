import { Chain } from '@/types';
import { retryWithCondition } from '@/utils';
import { Logger } from '@nestjs/common';
import { Contract, Provider } from 'ethers';

interface BalanceResult {
  balance: string;

  // The success flag is to distinguish between a failed fetch and a legitimately zero balance
  success: boolean;
}

export class ERC20BalanceFetcher {
  private readonly logger = new Logger(ERC20BalanceFetcher.name);
  private readonly erc20Abi = ['function balanceOf(address) view returns (uint256)'];

  constructor(private provider: Provider) {}

  /**
   * Fetch the balance of a token for a given holder address
   * @param tokenAddress - The address of the token (or null for native token)
   * @param holderAddress - The address of the holder
   * @returns Object containing the balance and whether the call was successful
   */
  async fetchBalance(tokenAddress: string | null, holderAddress: string, chain: Chain): Promise<BalanceResult> {
    // Handle native token case directly
    if (!tokenAddress) {
      const balance = await this.fetchNativeBalance(holderAddress, chain);
      return { balance, success: true };
    }

    try {
      // Create a contract instance with the provider (which is already wrapped with MulticallWrapper)
      const contract = new Contract(tokenAddress, this.erc20Abi, this.provider);

      // Call balanceOf - this will be automatically batched with other calls
      const balance = await contract.balanceOf(holderAddress);
      return {
        balance: balance.toString(),
        success: true,
      };
    } catch (error) {
      // Handle different types of provider errors
      const isRateLimit = error?.code === 'BAD_DATA' && error?.value?.[0]?.code === -32005;
      const isPaymentRequired =
        error?.code === 'SERVER_ERROR' && error?.info?.responseStatus === '402 Payment Required';

      if (isRateLimit) {
        const message = `Rate limit exceeded while fetching balance for token ${tokenAddress}`;
        this.logger.warn(message);
      } else if (isPaymentRequired) {
        const message = `Payment required error while fetching balance for token ${tokenAddress} - daily limit reached`;
        this.logger.warn(message);
      } else {
        this.logger.error(
          `Failed to fetch balance for token=${tokenAddress}, holder=${holderAddress}, chain=${chain}, error=${error.message}`,
        );
      }

      return {
        balance: '0',
        success: false,
      };
    }
  }

  private async fetchNativeBalance(holderAddress: string, chain: Chain): Promise<string> {
    return retryWithCondition(
      async () => {
        try {
          const balance = await this.provider.getBalance(holderAddress);
          return balance.toString();
        } catch (error) {
          // Handle different types of provider errors
          const isRateLimit = error?.code === 'BAD_DATA' && error?.value?.[0]?.code === -32005;
          const isPaymentRequired =
            error?.code === 'SERVER_ERROR' && error?.info?.responseStatus === '402 Payment Required';

          if (isRateLimit) {
            const message = `Rate limit exceeded while fetching native balance for ${holderAddress}`;
            this.logger.warn(message);
          } else if (isPaymentRequired) {
            const message = `Payment required error while fetching native balance for ${holderAddress} - daily limit reached`;
            this.logger.warn(message);
          } else {
            this.logger.error(
              `Failed to fetch native balance for holder=${holderAddress}, chain=${chain}, error=${error.message}`,
            );
          }
          throw error;
        }
      },
      (balance) => balance !== undefined && balance !== null,
      {
        maxRetries: 3,
        logger: this.logger,
        baseDelay: 1000,
        warningMessage: `Failed to fetch native balance for ${holderAddress}`,
      },
    );
  }
}
