import { withRetry, RETRY_CONFIGS } from '@/utils';
import { Injectable, Logger } from '@nestjs/common';
import { AddressCategory, Chain } from '@types';
import { BalanceResult, BaseBalanceFetcher } from '.';
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

  async fetchBalance(
    tokenAddress: string | null,
    accountAddress: string,
    category: AddressCategory,
    isVault: boolean = false,
  ): Promise<BalanceResult> {
    switch (category) {
      case AddressCategory.MENTO_RESERVE:
        return this.fetchMentoReserveBalance(tokenAddress, accountAddress, isVault);
      case AddressCategory.UNIV3_POOL:
        return this.fetchUniv3PoolBalance(tokenAddress, accountAddress);
      case AddressCategory.AAVE:
        return this.fetchAaveBalance(tokenAddress, accountAddress);
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
      const vaultResult = await this.erc20Fetcher.fetchVaultBalance(tokenAddress, accountAddress, Chain.CELO);
      return {
        displayBalance: vaultResult.underlyingBalance,
        valueCalculationBalance: vaultResult.tokenBalance,
      };
    }
    const balance = await this.erc20Fetcher.fetchBalance(tokenAddress, accountAddress, Chain.CELO);
    return {
      displayBalance: balance,
      valueCalculationBalance: balance,
    };
  }

  private async fetchUniv3PoolBalance(tokenAddress: string, accountAddress: string): Promise<BalanceResult> {
    if (!tokenAddress || !accountAddress) {
      this.logger.warn(
        `Invalid parameters for UniV3 balance fetch: tokenAddress=${tokenAddress}, accountAddress=${accountAddress}`,
      );
      return { displayBalance: '0', valueCalculationBalance: '0' };
    }

    const adapter = new ViemAdapter(this.chainClientService.getClient(Chain.CELO));
    const calculator = new UniV3SupplyCalculator(
      adapter,
      UNIV3_POSITION_MANAGER_ADDRESS,
      UNIV3_FACTORY_ADDRESS,
      accountAddress,
    );

    const holdings = await withRetry(
      () => calculator.getAmount(tokenAddress),
      `Failed to fetch UniV3 balance for ${tokenAddress} at ${accountAddress}`,
      { ...RETRY_CONFIGS.SDK_OPERATION, logger: this.logger },
    );

    const balance = (holdings || '0').toString();
    return { displayBalance: balance, valueCalculationBalance: balance };
  }

  private async fetchAaveBalance(tokenAddress: string, accountAddress: string): Promise<BalanceResult> {
    const adapter = new ViemAdapter(this.chainClientService.getClient(Chain.CELO));
    const calculator = new AAVESupplyCalculator(adapter, [accountAddress]);

    const holdings = await withRetry(
      () => calculator.getAmount(tokenAddress),
      `Failed to fetch Aave balance for ${tokenAddress}`,
      { ...RETRY_CONFIGS.SDK_OPERATION, logger: this.logger },
    );

    const balance = (holdings || '0').toString();
    return { displayBalance: balance, valueCalculationBalance: balance };
  }
}
