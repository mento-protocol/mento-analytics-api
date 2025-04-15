import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from 'src/types';
import { BalanceFetcherConfig, BaseBalanceFetcher } from '.';
import { ERC20BalanceFetcher } from './erc20-balance-fetcher';
import { ChainClientService } from '@/common/services/chain-client.service';
@Injectable()
export class EthereumBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(EthereumBalanceFetcher.name);
  private readonly erc20Fetcher: ERC20BalanceFetcher;

  constructor(private readonly chainClientService: ChainClientService) {
    const config: BalanceFetcherConfig = {
      chain: Chain.ETHEREUM,
      supportedCategories: [AddressCategory.MENTO_RESERVE],
    };
    super(config);
    this.erc20Fetcher = new ERC20BalanceFetcher(this.chainClientService.getClient(Chain.ETHEREUM));
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
    return await this.erc20Fetcher.fetchBalance(tokenAddress, accountAddress, Chain.ETHEREUM);
  }
}
