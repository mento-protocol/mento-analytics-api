import { Chain, AddressCategory } from '@types';

export interface BalanceFetcherConfig {
  chain: Chain;
  supportedCategories: AddressCategory[];
}

/**
 * Result of a balance fetch operation.
 * For regular tokens: displayBalance and valueCalculationBalance are the same.
 * For vault tokens: displayBalance is maxWithdraw (underlying), valueCalculationBalance is balanceOf (token count).
 */
export interface BalanceResult {
  /** Balance to display (for vaults: underlying withdrawable amount) */
  displayBalance: string;
  /** Balance used for USD value calculation (for vaults: raw token balance) */
  valueCalculationBalance: string;
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
   * @param isVault - Whether this is an ERC-4626 vault token (uses maxWithdraw instead of balanceOf)
   * @returns BalanceResult with display and value calculation balances
   */
  abstract fetchBalance(
    tokenAddress: string | null,
    accountAddress: string,
    category: AddressCategory,
    isVault?: boolean,
  ): Promise<BalanceResult>;

  getChain(): Chain {
    return this.config.chain;
  }

  supportsCategory(category: AddressCategory): boolean {
    return this.config.supportedCategories.includes(category);
  }
}
