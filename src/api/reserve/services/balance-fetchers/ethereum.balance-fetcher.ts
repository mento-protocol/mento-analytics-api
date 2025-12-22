import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from 'src/types';
import { BalanceFetcherConfig, BalanceResult, BaseBalanceFetcher } from '.';
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
    this.erc20Fetcher = new ERC20BalanceFetcher(this.chainClientService);
  }

  async fetchBalance(
    tokenAddress: string | null,
    accountAddress: string,
    category: AddressCategory,
    isVault: boolean = false,
  ): Promise<BalanceResult> {
    switch (category) {
      case AddressCategory.MENTO_RESERVE:
        return await this.fetchMentoReserveBalance(tokenAddress, accountAddress, isVault);
      default:
        throw new Error(`Unsupported address category: ${category}`);
    }
  }

  private async fetchMentoReserveBalance(
    tokenAddress: string | null,
    accountAddress: string,
    isVault: boolean,
  ): Promise<BalanceResult> {
    if (isVault && tokenAddress) {
      const vaultResult = await this.erc20Fetcher.fetchVaultBalance(tokenAddress, accountAddress, Chain.ETHEREUM);
      return {
        displayBalance: vaultResult.underlyingBalance,
        valueCalculationBalance: vaultResult.tokenBalance,
      };
    }
    const balance = await this.erc20Fetcher.fetchBalance(tokenAddress, accountAddress, Chain.ETHEREUM);
    return {
      displayBalance: balance,
      valueCalculationBalance: balance,
    };
  }
}
