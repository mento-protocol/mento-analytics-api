import { Chain } from '@/types';
import { handleFetchError, retryWithCondition } from '@/utils';
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
   * @param accountAddress - The address of the holder
   * @returns Object containing the balance and whether the call was successful
   */
  async fetchBalance(tokenAddress: string | null, accountAddress: string, chain: Chain): Promise<BalanceResult> {
    // Handle native token case directly
    if (!tokenAddress) {
      const balance = await this.fetchNativeBalance(accountAddress, chain);
      return { balance, success: true };
    }

    try {
      // Create a contract instance with the provider (which is already wrapped with MulticallWrapper)
      const contract = new Contract(tokenAddress, this.erc20Abi, this.provider);

      // Call balanceOf - this will be automatically batched with other calls
      const balance = await contract.balanceOf(accountAddress);

      return {
        balance: balance.toString(),
        success: true,
      };
    } catch (error) {
      const { isRateLimit, isPaymentRequired, message } = handleFetchError(error, {
        tokenAddress,
        accountAddress,
      });

      if (isRateLimit || isPaymentRequired) {
        this.logger.warn(message);
      } else {
        this.logger.error(
          `Failed to fetch balance for token=${tokenAddress}, holder=${accountAddress}, chain=${chain}, error=${error.message}`,
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
          const { isRateLimit, isPaymentRequired, message } = handleFetchError(error, {
            accountAddress: holderAddress,
            tokenAddress: 'ETH',
          });

          if (isRateLimit || isPaymentRequired) {
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
