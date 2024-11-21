import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from 'src/types';
import { BalanceFetcherConfig, BaseBalanceFetcher } from '.';
import { ERC20BalanceFetcher } from './erc20-balance-fetcher';
import { ChainProvidersService } from '../chain-provider.service';

@Injectable()
export class CeloBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(CeloBalanceFetcher.name);
  private readonly erc20Fetcher: ERC20BalanceFetcher;

  constructor(private readonly chainProviders: ChainProvidersService) {
    const config: BalanceFetcherConfig = {
      chain: Chain.CELO,
      supportedCategories: [AddressCategory.MENTO_RESERVE],
    };
    super(config);
    this.erc20Fetcher = new ERC20BalanceFetcher(this.chainProviders.getProvider(Chain.CELO));
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
      this.logger.error(`Failed to fetch Celo balance for ${accountAddress}:`, error);
      return '0';
    }
  }

  private async fetchMentoReserveBalance(tokenAddress: string, accountAddress: string): Promise<string> {
    try {
      const balance = await this.erc20Fetcher.fetchBalance(tokenAddress, accountAddress);
      return balance;
    } catch (error) {
      this.logger.error(`Failed to fetch balance for token ${tokenAddress} at address ${accountAddress}:`, error);
      throw error;
    }
  }
}
