import { handleFetchError, withRetry } from '@/utils';
import { ChainProvidersService } from '@common/services/chain-provider.service';
import { EthersAdapter, UniV3SupplyCalculator } from '@mento-protocol/mento-sdk';
import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AddressCategory, Chain } from '@types';
import { BalanceFetcherConfig, BaseBalanceFetcher } from '.';
import { UNIV3_FACTORY_ADDRESS, UNIV3_POSITION_MANAGER_ADDRESS } from '../../constants';
import { ERC20BalanceFetcher } from './erc20-balance-fetcher';

@Injectable()
export class CeloBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(CeloBalanceFetcher.name);
  private readonly erc20Fetcher: ERC20BalanceFetcher;

  constructor(private readonly chainProviders: ChainProvidersService) {
    const config: BalanceFetcherConfig = {
      chain: Chain.CELO,
      supportedCategories: [AddressCategory.MENTO_RESERVE, AddressCategory.UNIV3_POOL],
    };
    super(config);
    this.erc20Fetcher = new ERC20BalanceFetcher(this.chainProviders.getProvider(Chain.CELO));
  }

  /**
   * Fetches the balance of a specific token for a given account address and category
   * @param tokenAddress - The address of the token to fetch the balance of
   * @param accountAddress - The address of the account to fetch the token balance of
   * @param category - The category of the address to fetch the balance of
   * @returns The balance of the token for the given account address and category
   */
  async fetchBalance(tokenAddress: string | null, accountAddress: string, category: AddressCategory): Promise<string> {
    switch (category) {
      case AddressCategory.MENTO_RESERVE:
        return await this.fetchMentoReserveBalance(tokenAddress, accountAddress);
      case AddressCategory.UNIV3_POOL:
        return await this.fetchUniv3PoolBalance(tokenAddress, accountAddress);
      default:
        throw new Error(`Unsupported address category: ${category}`);
    }
  }

  /**
   * Fetches the balance of a Mento reserve for a specific account address
   *
   * It uses the ERC20BalanceFetcher to fetch the balance of the token.
   *
   * The process involves:
   * 1. Fetching the balance with retry logic to handle transient failures
   * 2. Handling errors with appropriate logging and Sentry capture
   *
   * @param tokenAddress - The address of the token to check the balance for
   * @param accountAddress - The address of the account that owns the reserve
   * @returns A promise resolving to the token balance as a string
   * @throws Will throw an error if the balance cannot be fetched after retries
   */
  private async fetchMentoReserveBalance(tokenAddress: string, accountAddress: string): Promise<string> {
    try {
      const result = await this.erc20Fetcher.fetchBalance(tokenAddress, accountAddress, Chain.CELO);
      if (!result.success) {
        throw new Error(`Failed to fetch balance of token ${tokenAddress} for address ${accountAddress}`);
      }

      return result.balance;
    } catch (error) {
      const errorMessage = `Failed to fetch balance of token ${tokenAddress} for address ${accountAddress}`;

      const { isRateLimit, isPaymentRequired, message } = handleFetchError(error, {
        tokenAddress,
        accountAddress,
      });

      if (isRateLimit || isPaymentRequired) {
        this.logger.warn(message);
      } else {
        this.logger.error(`${errorMessage}: ${error.message}`, error.stack);
      }

      Sentry.captureException(error, {
        level: 'error',
        extra: {
          address: accountAddress,
          chain: Chain.CELO,
          category: AddressCategory.MENTO_RESERVE,
          description: errorMessage,
        },
      });
      throw error;
    }
  }

  /**
   * Fetches the token balance from a Uniswap V3 pool
   *
   * This method retrieves the token balance held in a Uniswap V3 pool for a specific
   * account address. It uses the Mento SDK's UniV3SupplyCalculator to determine the
   * amount of tokens in the pool positions owned by the account.
   *
   * The process involves:
   * 1. Creating an EthersAdapter with the Celo provider
   * 2. Initializing a UniV3SupplyCalculator with the adapter and pool addresses
   * 3. Fetching the token amount with retry logic to handle transient failures
   * 4. Handling errors with appropriate logging and Sentry capture
   *
   * @param tokenAddress - The address of the token to check the balance for
   * @param accountAddress - The address of the account that owns the pool position
   * @returns A promise resolving to the token balance as a string
   * @throws Will throw an error if the balance cannot be fetched after retries
   */
  private async fetchUniv3PoolBalance(tokenAddress: string, accountAddress: string): Promise<string> {
    try {
      const adapter = new EthersAdapter(this.chainProviders.getProvider(Chain.CELO));
      const calculator = new UniV3SupplyCalculator(
        adapter,
        UNIV3_POSITION_MANAGER_ADDRESS,
        UNIV3_FACTORY_ADDRESS,
        accountAddress,
      );

      const retryOptions = {
        maxRetries: 5,
        delay: 1000,
      };

      const holdings = await withRetry(
        async () => await calculator.getAmount(tokenAddress),
        `Failed to fetch UniV3 balance for token ${tokenAddress} at address ${accountAddress}`,
        retryOptions,
      );
      return (holdings || '0').toString();
    } catch (error) {
      const { isRateLimit, isPaymentRequired, message } = handleFetchError(error, {
        tokenAddress,
        accountAddress,
      });

      if (isRateLimit || isPaymentRequired) {
        this.logger.warn(message);
      } else {
        this.logger.error(
          `Failed to fetch UniV3 balance for token ${tokenAddress} at address ${accountAddress}: ${error.message}`,
          error.stack,
        );
      }

      Sentry.captureException(error, {
        level: 'error',
        extra: {
          address: accountAddress,
          chain: Chain.CELO,
          category: AddressCategory.UNIV3_POOL,
          description: error.message,
          tokenAddress: tokenAddress,
        },
      });
      throw error;
    }
  }
}
