import { Chain } from '@types';

/**
 * Configuration for stablecoin supply adjustments.
 * These define addresses whose stablecoin holdings should be subtracted
 * from the total supply to calculate the true outstanding debt.
 */

/**
 * Reserve addresses that may hold Mento stablecoins directly.
 * Any stablecoins held by these addresses are subtracted from outstanding supply
 * because they're owned by the reserve and can't be redeemed against themselves.
 */
export const RESERVE_STABLECOIN_HOLDERS = [
  {
    address: '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9',
    chain: Chain.CELO,
    label: 'Mento Pools Liquidity Reserve',
  },
  {
    address: '0x87647780180b8f55980c7d3ffefe08a9b29e9ae1',
    chain: Chain.CELO,
    label: 'Mento Reserve Custody Multisig',
  },
  {
    address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1',
    chain: Chain.CELO,
    label: 'Mento Operational Multisig',
  },
  {
    address: '0xaa8299fc6a685b5f9ce9bda8d0b3ea3d54731976',
    chain: Chain.CELO,
    label: 'Reserve Rebalancer Bot',
  },
] as const;

/**
 * AAVE reserve addresses that may have stablecoin positions.
 * Stablecoins deposited in AAVE by the reserve are subtracted from outstanding supply.
 */
export const AAVE_STABLECOIN_HOLDERS = [
  {
    address: '0x87647780180B8f55980C7D3fFeFe08a9B29e9aE1',
    chain: Chain.CELO,
    label: 'Mento Reserve Custody Multisig (AAVE)',
  },
  {
    address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1',
    chain: Chain.CELO,
    label: 'Mento Operational Multisig (AAVE)',
  },
] as const;

/**
 * Dead addresses for lost tokens.
 * The token's own contract address is always considered dead (self-held tokens).
 * Additional addresses can be added here for tokens that were accidentally
 * sent to known unrecoverable addresses.
 *
 * Key: token symbol, Value: array of dead addresses (in addition to the token's own address)
 */
export const ADDITIONAL_DEAD_ADDRESSES: Record<string, string[]> = {
  // Add additional dead addresses per token here as needed
  // Example: 'cUSD': ['0x000000000000000000000000000000000000dEaD'],
};

export type ReserveStablecoinHolder = (typeof RESERVE_STABLECOIN_HOLDERS)[number];
export type AaveStablecoinHolder = (typeof AAVE_STABLECOIN_HOLDERS)[number];
