import { withRetry, RETRY_CONFIGS } from '@/utils';
import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from '@types';
import { BaseBalanceFetcher } from '.';
import { ERC20BalanceFetcher } from './erc20-balance-fetcher';
import { ChainClientService } from '@/common/services/chain-client.service';
import { ViemAdapter, UniV3SupplyCalculator, AAVESupplyCalculator } from '@mento-protocol/mento-sdk';
import { UNIV3_POSITION_MANAGER_ADDRESS, UNIV3_FACTORY_ADDRESS } from '../../constants';

@Injectable()
export class CeloBalanceFetcher extends BaseBalanceFetcher {
  private readonly logger = new Logger(CeloBalanceFetcher.name);
  private readonly erc20Fetcher: ERC20BalanceFetcher;

  constructor(private readonly chainClientService: ChainClientService) {
    super({
      chain: Chain.CELO,
      supportedCategories: [AddressCategory.MENTO_RESERVE, AddressCategory.UNIV3_POOL, AddressCategory.AAVE],
    });
    this.erc20Fetcher = new ERC20BalanceFetcher(this.chainClientService);
  }

  async fetchBalance(tokenAddress: string | null, accountAddress: string, category: AddressCategory): Promise<string> {
    switch (category) {
      case AddressCategory.MENTO_RESERVE:
        return this.fetchMentoReserveBalance(tokenAddress, accountAddress);
      case AddressCategory.UNIV3_POOL:
        return this.fetchUniv3PoolBalance(tokenAddress, accountAddress);
      case AddressCategory.AAVE:
        return this.fetchAaveBalance(tokenAddress, accountAddress);
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
      () => calculator.getAmount(tokenAddress),
      `Failed to fetch UniV3 balance for ${tokenAddress}`,
      { ...RETRY_CONFIGS.SDK_OPERATION, logger: this.logger },
    );

    return (holdings || '0').toString();
  }

  private async fetchAaveBalance(tokenAddress: string, accountAddress: string): Promise<string> {
    const adapter = new ViemAdapter(this.chainClientService.getClient(Chain.CELO));
    const calculator = new AAVESupplyCalculator(adapter, [accountAddress]);

    const holdings = await withRetry(
      () => calculator.getAmount(tokenAddress),
      `Failed to fetch Aave balance for ${tokenAddress}`,
      { ...RETRY_CONFIGS.SDK_OPERATION, logger: this.logger },
    );

    return (holdings || '0').toString();
  }
}
