export enum Chain {
  CELO = 'celo',
  ETHEREUM = 'ethereum',
  BITCOIN = 'bitcoin',
}

/**
 * The category of a reserve address. This is used to group reserve
 * addresses by their type and also to determine how to fetch their
 * balances.
 */
export enum AddressCategory {
  MENTO_RESERVE = 'Mento Reserve',
  USDC_AXELAR = 'USDC Axelar',
  CURVE_POOL = 'Curve Pool',
}

/**
 * The configuration for an asset. This is used to determine how to fetch
 * the price of an asset.
 */
export interface AssetConfig {
  symbol: string;
  name: string;
  chain: Chain;
  decimals: number;
  address?: string; // Optional address for the asset.
}

/**
 * The configuration for a reserve address. This is used to determine how to fetch
 * the balances of a reserve address.
 * @param address - The address of the reserve.
 * @param chain - The chain of the reserve.
 * @param category - The category of the reserve.
 * @param label - The label of the reserve.
 * @param assets - The assets held by the reserve.
 * @param description - The description of the reserve.
 */
export interface ReserveAddress {
  address: string;
  chain: Chain;
  category: AddressCategory;
  label?: string;
  assets: string[];
  description?: string;
}

/**
 * The balance of an asset held by a reserve address.
 */
export interface AssetBalance {
  symbol: string;
  address: string;
  chain: Chain;
  balance: string;
  usdValue: number;
}

export interface GroupedAssetBalance {
  symbol: string;
  totalBalance: string;
  usdValue: number;
}
