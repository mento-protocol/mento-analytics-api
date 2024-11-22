import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from '@types';
import { BalanceFetcherConfig, BaseBalanceFetcher } from '.';
import { ERC20BalanceFetcher } from './erc20-balance-fetcher';
import { ChainProvidersService } from '@common/services/chain-provider.service';
import { UniV3PoolService } from '../univ3-pool.service';

// TODO: Verify CELO balance. There is a discrepancy between what is displayed currently on the reserve site
//       and what is being fetched here.
//       Intial thoughts are that it could be stCELO, but the reserve multisig apparently holds 0 stCELO.

@Injectable()
export class CeloBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(CeloBalanceFetcher.name);
  private readonly erc20Fetcher: ERC20BalanceFetcher;
  private readonly univ3Service: UniV3PoolService;

  constructor(private readonly chainProviders: ChainProvidersService) {
    const config: BalanceFetcherConfig = {
      chain: Chain.CELO,
      supportedCategories: [AddressCategory.MENTO_RESERVE, AddressCategory.UNIV3_POOL],
    };
    super(config);
    this.erc20Fetcher = new ERC20BalanceFetcher(this.chainProviders.getProvider(Chain.CELO));
    this.univ3Service = new UniV3PoolService(this.chainProviders.getProvider(Chain.CELO));
  }

  async fetchBalance(tokenAddress: string | null, accountAddress: string, category: AddressCategory): Promise<string> {
    try {
      switch (category) {
        case AddressCategory.MENTO_RESERVE:
          return await this.fetchMentoReserveBalance(tokenAddress, accountAddress);
        case AddressCategory.UNIV3_POOL:
          return await this.fetchUniv3PoolBalance(tokenAddress, accountAddress);
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

  private async fetchUniv3PoolBalance(tokenAddress: string, accountAddress: string): Promise<string> {
    try {
      const holdings = await this.univ3Service.getPositionBalances(accountAddress);
      return (holdings.get(tokenAddress) || '0').toString();
    } catch (error) {
      this.logger.error(`Failed to fetch UniV3 balance for token ${tokenAddress} at address ${accountAddress}:`, error);
      throw error;
    }
  }
}
