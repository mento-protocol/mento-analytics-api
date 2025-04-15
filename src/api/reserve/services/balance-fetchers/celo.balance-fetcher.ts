import { withRetry } from '@/utils';
import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from '@types';
import { BalanceFetcherConfig, BaseBalanceFetcher } from '.';
import { ERC20BalanceFetcher } from './erc20-balance-fetcher';
import { ChainClientService } from '@/common/services/chain-client.service';
import { ViemAdapter, UniV3SupplyCalculator, AAVESupplyCalculator } from '@mento-protocol/mento-sdk';
import { UNIV3_POSITION_MANAGER_ADDRESS, UNIV3_FACTORY_ADDRESS } from '../../constants';
@Injectable()
export class CeloBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(CeloBalanceFetcher.name);
  private readonly erc20Fetcher: ERC20BalanceFetcher;

  constructor(private readonly chainClientService: ChainClientService) {
    const config: BalanceFetcherConfig = {
      chain: Chain.CELO,
      supportedCategories: [AddressCategory.MENTO_RESERVE, AddressCategory.UNIV3_POOL, AddressCategory.AAVE],
    };
    super(config);
    this.erc20Fetcher = new ERC20BalanceFetcher(this.chainClientService.getClient(Chain.CELO));
  }

  async fetchBalance(tokenAddress: string | null, accountAddress: string, category: AddressCategory): Promise<string> {
    switch (category) {
      case AddressCategory.MENTO_RESERVE:
        return await this.fetchMentoReserveBalance(tokenAddress, accountAddress);
      case AddressCategory.UNIV3_POOL:
        return await this.fetchUniv3PoolBalance(tokenAddress, accountAddress);
      case AddressCategory.AAVE:
        return await this.fetchAaveBalance(tokenAddress, accountAddress);
      default:
        throw new Error(`Unsupported address category: ${category}`);
    }
  }

  private async fetchMentoReserveBalance(tokenAddress: string, accountAddress: string): Promise<string> {
    return this.erc20Fetcher.fetchBalance(tokenAddress, accountAddress, Chain.CELO);
  }

  private async fetchUniv3PoolBalance(tokenAddress: string, accountAddress: string): Promise<string> {
    const adapter = new ViemAdapter(this.chainClientService.getClient(Chain.CELO));
    const calculator = new UniV3SupplyCalculator(
      adapter,
      UNIV3_POSITION_MANAGER_ADDRESS,
      UNIV3_FACTORY_ADDRESS,
      accountAddress,
    );

    const holdings = await withRetry(
      async () => await calculator.getAmount(tokenAddress),
      `Failed to fetch UniV3 balance for token ${tokenAddress} at address ${accountAddress}`,
      {
        maxRetries: 5,
        baseDelay: 1000,
        logger: this.logger,
      },
    );

    return (holdings || '0').toString();
  }

  private async fetchAaveBalance(tokenAddress: string, accountAddress: string): Promise<string> {
    const adapter = new ViemAdapter(this.chainClientService.getClient(Chain.CELO));
    const calculator = new AAVESupplyCalculator(adapter, [accountAddress]);

    const holdings = await withRetry(
      async () => await calculator.getAmount(tokenAddress),
      `Failed to fetch Aave balance for token ${tokenAddress} at address ${accountAddress}`,
      {
        maxRetries: 5,
        baseDelay: 1000,
        logger: this.logger,
      },
    );

    return (holdings || '0').toString();
  }
}
