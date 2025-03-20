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
   * Fetch the balance of an ERC20 token for a given account address
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
      const { isRateLimit, isPaymentRequired, isDnsError, message } = handleFetchError(error, {
        tokenAddressOrSymbol: tokenAddress,
        accountAddress,
        chain,
      });

      if (isRateLimit || isPaymentRequired || isDnsError) {
        this.logger.error(message, error.stack);
      } else {
        this.logger.error(
          `Failed to fetch balance for token=${tokenAddress}, holder=${accountAddress}, chain=${chain}, error=${error.message}`,
          error.stack,
        );
      }

      return {
        balance: '0',
        success: false,
      };
    }
  }

  /**
   * Fetches the native token balance for a given address
   *
   * This method retrieves the native token balance (ETH, CELO, BTC) for the specified
   * holder address using the chain's provider. It includes retry logic to handle
   * transient failures and proper error handling for common provider errors.
   *
   * @param holderAddress - The address to check the native balance for
   * @param chain - The chain (determines which native token to fetch)
   * @returns A promise resolving to the native token balance as a string
   * @throws Will throw an error if all retry attempts fail
   */
  private async fetchNativeBalance(holderAddress: string, chain: Chain): Promise<string> {
    // Get the appropriate native token symbol based on chain
    const nativeTokenSymbol = this.getNativeTokenSymbol(chain);

    return retryWithCondition(
      async () => {
        try {
          const balance = await this.provider.getBalance(holderAddress);
          return balance.toString();
        } catch (error) {
          const { isRateLimit, isPaymentRequired, isDnsError, message } = handleFetchError(error, {
            accountAddress: holderAddress,
            tokenAddressOrSymbol: nativeTokenSymbol,
            chain,
          });

          if (isRateLimit || isPaymentRequired || isDnsError) {
            this.logger.error(message, error.stack);
          } else {
            this.logger.error(
              `Failed to fetch native balance for holder=${holderAddress}, chain=${chain}, error=${error.message}`,
              error.stack,
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
        warningMessage: `Failed to fetch ${nativeTokenSymbol} balance for ${holderAddress}`,
      },
    );
  }

  /**
   * Get the native token symbol for a given chain
   * @param chain - The blockchain chain
   * @returns The native token symbol (e.g., 'ETH', 'CELO')
   */
  private getNativeTokenSymbol(chain: Chain): string {
    switch (chain) {
      case Chain.ETHEREUM:
        return 'ETH';
      case Chain.CELO:
        return 'CELO';
      case Chain.BITCOIN:
        return 'BTC';
      default:
        return 'NATIVE';
    }
  }
}
