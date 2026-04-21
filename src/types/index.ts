/**
 * Enum for the different chains that are supported
 * @dev Opted for a normalised string of the chain name for compatibility with the
 *      bitcoin as it does not have a chainID, and any future chains that may be added.
 */
export enum Chain {
  CELO = 'celo',
  ETHEREUM = 'ethereum',
  BITCOIN = 'bitcoin',
  MONAD = 'monad',
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
  CDP_CONTRACT = 'CDP Contract',
  BRIDGE_CONTRACT = 'Bridge Contract',
  CUSTODIAN = 'Custodian',
  FPMM_POOL = 'FPMM Pool',
}

/**
 * The configuration for an asset. This is used to determine how to fetch
 * the price of an asset.
 *
 * @param symbol - The symbol of the asset.
 * @param name - The name of the asset.
 * @param decimals - The number of decimals of the asset.
 * @param address - Nullable address of the asset. Null is an indication of a chain native asset such as ETH or BTC.
 * @param rateSymbol - The symbol of the asset used to calculate the price from CoinMarketCap. e.g. EURC for stEUR.
 * @param isVault - Whether this is an ERC-4626 vault token. If true, maxWithdraw() is used instead of balanceOf().
 * @param useDefiLlamaPrice - If true, uses DeFiLlama for price instead of CMC. Requires address to be set.
 */
export interface AssetConfig {
  symbol: AssetSymbol;
  name: string;
  decimals: number;
  address?: string;
  rateSymbol?: AssetSymbol;
  isVault?: boolean;
  useDefiLlamaPrice?: boolean;
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
  USDT0: 'USDT0',
  BTC: 'BTC',
  WBTC: 'WBTC',
  stETH: 'stETH',
  EURC: 'EURC',
  ETH: 'ETH',
  USDGLO: 'USDGLO',
  WETH: 'WETH',
  sDAI: 'sDAI',
  sUSDS: 'sUSDS',
  USDS: 'USDS',
  stEUR: 'stEUR',
  axlEUROC: 'axlEUROC',
  EURA: 'EURA',
  USDm: 'USDm',
  EURm: 'EURm',
  AUSD: 'AUSD',
  GBPm: 'GBPm',
} as const;

export type AssetSymbol = (typeof ASSET_SYMBOLS)[keyof typeof ASSET_SYMBOLS];

/**
 * The type of backing mechanism for a stablecoin.
 * - reserve: Backed by the diversified crypto reserve, redeemable via buy-and-sell mechanism
 * - cdp: Backed by collateralized debt positions (e.g. USDm collateral backing GBPm)
 */
export type BackingType = 'reserve' | 'cdp';

/**
 * The status of a CDP trove.
 * - active: Live CDP with deposited collateral and minted debt
 * - pending: Announced but not yet deployed
 */
export type TroveStatus = 'active' | 'pending';
