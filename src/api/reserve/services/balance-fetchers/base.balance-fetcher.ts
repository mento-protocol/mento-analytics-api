import { Chain, AddressCategory } from '@types';

export interface BalanceFetcherConfig {
  chain: Chain;
  supportedCategories: AddressCategory[];
}

/**
 * Base class for fetching balances of reserve holdings. The intention is that each
 * chain will have a different implementation of this class. Each implementation
 * will have additional internal methods for fetching balances of different
 * address categories.
 */
export abstract class BaseBalanceFetcher {
  protected readonly config: BalanceFetcherConfig;

  constructor(config: BalanceFetcherConfig) {
    this.config = config;
  }

  /**
   * Fetch the balance of a specific token for a given account address and category
   * @param tokenAddress - The address of the token to fetch the balance of
   * @param accountAddress - The address of the account to fetch the balance of
   * @param category - The category of the address to fetch the balance of
   * @returns The balance of the token for the given account address and category
   */
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
