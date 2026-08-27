import { Injectable } from '@nestjs/common';
import { ChainClientService } from '@common/services/chain-client.service';
import { AddressCategory, Chain } from '@types';
import { BalanceFetcherConfig, BalanceResult, BaseBalanceFetcher } from './base.balance-fetcher';
import { ERC20BalanceFetcher } from './erc20-balance-fetcher';

@Injectable()
export class PolygonBalanceFetcher extends BaseBalanceFetcher {
  private readonly erc20Fetcher: ERC20BalanceFetcher;

  constructor(chainClientService: ChainClientService) {
    const config: BalanceFetcherConfig = {
      chain: Chain.POLYGON,
      supportedCategories: [AddressCategory.MENTO_RESERVE],
    };
    super(config);
    this.erc20Fetcher = new ERC20BalanceFetcher(chainClientService);
  }

  async fetchBalance(
    tokenAddress: string | null,
    accountAddress: string,
    category: AddressCategory,
  ): Promise<BalanceResult> {
    if (category !== AddressCategory.MENTO_RESERVE) {
      throw new Error(`Unsupported address category: ${category}`);
    }

    const balance = await this.erc20Fetcher.fetchBalance(tokenAddress, accountAddress, Chain.POLYGON);
    return {
      displayBalance: balance,
      valueCalculationBalance: balance,
    };
  }
}
