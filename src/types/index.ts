import { AssetSymbol } from 'src/api/reserve/config/assets.config';

/**
 * Enum for the different chains that are supported
 * @dev Opted for a normalised string of the chain name for compatibility with the
 *      bitcoin as it does not have a chainID, and any future chains that may be added.
 */
export enum Chain {
  CELO = 'celo',
  ETHEREUM = 'ethereum',
  BITCOIN = 'bitcoin',
}

/**
 * The category of a reserve address. This is used to group reserve
 * addresses by their type and also to determine how to fetch their
 * balances.
 *
 * @dev Descriptions:
 *      Mento Reserve - The simplest form of reserve, a contract or account holding assets directly.
 *      Curve Pool - A curve pool holding assets that are owned indirectly by the reserve.
 *
 */
export enum AddressCategory {
  MENTO_RESERVE = 'Mento Reserve',
  CURVE_POOL = 'Curve Pool',
}

/**
 * The configuration for an asset. This is used to determine how to fetch
 * the price of an asset.
 * @param symbol - The symbol of the asset.
 * @param name - The name of the asset.
 * @param chain - The chain of the asset.
 * @param decimals - The number of decimals of the asset.
 * @param address - Nullable address of the asset. Null is an indication of a chain native asset such as ETH or BTC.
 */
export interface AssetConfig {
  symbol: string;
  name: string;
  chain: Chain;
  decimals: number;
  address?: string;
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
export interface ReserveAddressConfig {
  address: string;
  chain: Chain;
  category: AddressCategory;
  label?: string;
  assets: AssetSymbol[];
  description?: string;
}

/**
 * The balance of an asset held by a reserve address.
 */
export interface AssetBalance {
  symbol: string;
  reserveAddress: string;
  assetAddress: string | null;
  chain: Chain;
  balance: string;
  usdValue: number;
}

/**
 * A grouped asset balance. This is used to group asset balances by their symbol.
 */
export interface GroupedAssetBalance {
  symbol: string;
  totalBalance: string;
  usdValue: number;
}
