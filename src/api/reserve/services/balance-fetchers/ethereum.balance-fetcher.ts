import { ChainProvidersService } from '@common/services/chain-provider.service';
import { MulticallService } from '@common/services/multicall.service';
import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AddressCategory, Chain } from '@types';
import { BalanceFetcherConfig, BaseBalanceFetcher } from '.';
import { ERC20BalanceFetcher } from './erc20-balance-fetcher';

@Injectable()
export class EthereumBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(EthereumBalanceFetcher.name);
  private readonly erc20Fetcher: ERC20BalanceFetcher;

  constructor(
    private readonly chainProviders: ChainProvidersService,
    private readonly multicall: MulticallService,
  ) {
    const config: BalanceFetcherConfig = {
      chain: Chain.ETHEREUM,
      supportedCategories: [AddressCategory.MENTO_RESERVE],
    };
    super(config);
    this.erc20Fetcher = new ERC20BalanceFetcher(
      this.chainProviders.getProvider(Chain.ETHEREUM),
      this.multicall,
      Chain.ETHEREUM,
    );
  }

  async fetchBalance(tokenAddress: string | null, accountAddress: string, category: AddressCategory): Promise<string> {
    switch (category) {
      case AddressCategory.MENTO_RESERVE:
        return await this.fetchMentoReserveBalance(tokenAddress, accountAddress);
      default:
        throw new Error(`Unsupported address category: ${category}`);
    }
  }

  private async fetchMentoReserveBalance(tokenAddress: string | null, accountAddress: string): Promise<string> {
    try {
      const balance = await this.erc20Fetcher.fetchBalance(tokenAddress, accountAddress, Chain.ETHEREUM);
      return balance;
    } catch (error) {
      const tokenDisplay = tokenAddress ? tokenAddress : 'ETH';
      const errorMessage = `Failed to fetch balance for token ${tokenDisplay}`;

      // Only log the full error for non-rate-limit errors
      if (error?.code === 'BAD_DATA' && error?.value?.[0]?.code === -32005) {
        this.logger.error(`Rate limit exceeded while fetching balance for token ${tokenDisplay}`);
      } else {
        this.logger.error(error, errorMessage);
      }

      Sentry.captureException(error, {
        level: 'error',
        extra: {
          address: accountAddress,
          chain: Chain.ETHEREUM,
          category: AddressCategory.MENTO_RESERVE,
          description: errorMessage,
          tokenAddress: tokenAddress,
        },
      });
      throw error;
    }
  }
}
