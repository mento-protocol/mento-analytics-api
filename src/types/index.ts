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
 *      Uniswap V3 Pool - A Uniswap V3 pool holding assets that are owned indirectly by the reserve.
 *      Aave - Assets held in the Aave protocol that are owned indirectly by the reserve.
 *
 */
export enum AddressCategory {
  MENTO_RESERVE = 'Mento Reserve',
  CURVE_POOL = 'Curve Pool',
  UNIV3_POOL = 'Uniswap V3 Pool',
  AAVE = 'Aave',
}

/**
 * The configuration for an asset. This is used to determine how to fetch
 * the price of an asset.
 *
 * @param symbol - The symbol of the asset.
 * @param name - The name of the asset.
 * @param decimals - The number of decimals of the asset.
 * @param address - Nullable address of the asset. Null is an indication of a chain native asset such as ETH or BTC.
 * @param rateSymbol - The symbol of the asset used to calculate the price of the asset. e.g. EURC for stEUR.
 */
export interface AssetConfig {
  symbol: AssetSymbol;
  name: string;
  decimals: number;
  address?: string;
  rateSymbol?: AssetSymbol;
}

/**
 * The configuration for a reserve address. This is used to determine how to fetch
 * the balances of a reserve address.
 *
 * @param address - The address of the reserve.
 * @param chain - The chain of the reserve.
 * @param category - The category of the reserve.
 * @param label - The label of the reserve. Useful for public display of the reserve.
 * @param assets - The assets held by the reserve.
 * @param description - The description of the reserve. Should provide enough information to understand the purpose of the reserve address.
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
  symbol: AssetSymbol;
  reserveAddress: string;
  assetAddress: string | null;
  chain: Chain;
  balance: string;
  usdValue: number;
  type: AddressCategory;
}

/**
 * A grouped asset balance. This is used to group asset balances by their symbol.
 */
export interface GroupedAssetBalance {
  symbol: AssetSymbol;
  totalBalance: string;
  usdValue: number;
}

/**
 * The symbols of the assets that are supported.
 */
export const ASSET_SYMBOLS = {
  CELO: 'CELO',
  USDC: 'USDC',
  axlUSDC: 'axlUSDC',
  USDT: 'USDT',
  BTC: 'BTC',
  WBTC: 'WBTC',
  stETH: 'stETH',
  EURC: 'EURC',
  ETH: 'ETH',
  USDGLO: 'USDGLO',
  WETH: 'WETH',
  sDAI: 'sDAI',
  stEUR: 'stEUR',
  axlEUROC: 'axlEUROC',
} as const;

export type AssetSymbol = (typeof ASSET_SYMBOLS)[keyof typeof ASSET_SYMBOLS];
