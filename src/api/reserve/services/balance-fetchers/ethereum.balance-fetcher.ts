import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from 'src/types';
import { BalanceFetcherConfig, BaseBalanceFetcher } from '.';
import { ERC20BalanceFetcher } from './erc20-balance-fetcher';
import { ChainProvidersService } from '@common/services/chain-provider.service';

@Injectable()
export class EthereumBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(EthereumBalanceFetcher.name);
  private readonly erc20Fetcher: ERC20BalanceFetcher;

  constructor(private readonly chainProviders: ChainProvidersService) {
    const config: BalanceFetcherConfig = {
      chain: Chain.ETHEREUM,
      supportedCategories: [AddressCategory.MENTO_RESERVE],
    };
    super(config);
    this.erc20Fetcher = new ERC20BalanceFetcher(this.chainProviders.getProvider(Chain.ETHEREUM));
  }

  async fetchBalance(tokenAddress: string | null, accountAddress: string, category: AddressCategory): Promise<string> {
    try {
      switch (category) {
        case AddressCategory.MENTO_RESERVE:
          return await this.fetchMentoReserveBalance(tokenAddress, accountAddress);
        default:
          throw new Error(`Unsupported address category: ${category}`);
      }
    } catch (error) {
      this.logger.error(error, `Failed to fetch Ethereum balance for ${accountAddress}:`);
      return '0';
    }
  }

  private async fetchMentoReserveBalance(tokenAddress: string | null, accountAddress: string): Promise<string> {
    try {
      const balance = await this.erc20Fetcher.fetchBalance(tokenAddress, accountAddress);
      return balance;
    } catch (error) {
      this.logger.error(
        error,
        `Failed to fetch balance for token ${tokenAddress || 'ETH'} at address ${accountAddress}:`,
      );
      throw error;
    }
  }
}
