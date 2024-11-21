import { Chain, AddressCategory } from 'src/types';

export interface BalanceFetcherConfig {
  chain: Chain;
  supportedCategories: AddressCategory[];
}

export abstract class BaseBalanceFetcher {
  protected readonly config: BalanceFetcherConfig;

  constructor(config: BalanceFetcherConfig) {
    this.config = config;
  }

  abstract fetchBalance(
    tokenAddress: string | null,
    accountAddress: string,
    category: AddressCategory,
  ): Promise<string>;

  getChain(): Chain {
    return this.config.chain;
  }

  supportsCategory(category: AddressCategory): boolean {
    return this.config.supportedCategories.includes(category);
  }
}
