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
        this.logger.error(error, errorMessage);
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
        this.logger.error(error);
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
