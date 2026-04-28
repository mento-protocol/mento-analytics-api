import { Chain } from '@types';

/**
 * Canonical list of all reserve addresses across all chains.
 *
 * This is the single source of truth for v2 position readers.
 * Consolidated from:
 *   - src/api/reserve/config/addresses.config.ts (RESERVE_ADDRESS_CONFIGS)
 *   - src/api/stablecoins/config/adjustments.config.ts (RESERVE_STABLECOIN_HOLDERS, AAVE_STABLECOIN_HOLDERS)
 *   - src/api/v2/services/fpmm-positions.service.ts (LP_HOLDER_ADDRESSES)
 *   - src/api/v2/config/cdp.config.ts (CDP_TROVE_OWNERS)
 *
 * The old configs remain for v1 backward compatibility.
 */

export type CustodianType = 'hot' | 'cold' | 'ops';

export interface ReserveAddress {
  address: string;
  chain: Chain;
  label: string;
  custodianType: CustodianType;
}

export const RESERVE_ADDRESSES: ReserveAddress[] = [
  // --- Celo ---
  { address: '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9', chain: Chain.CELO, label: 'Mento Pools Liquidity Reserve', custodianType: 'hot' },
  { address: '0x87647780180b8f55980c7d3ffefe08a9b29e9ae1', chain: Chain.CELO, label: 'Custody Multisig', custodianType: 'cold' },
  { address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1', chain: Chain.CELO, label: 'Ops Multisig', custodianType: 'ops' },
  { address: '0x6dec25d7be9bf6c6fc302977629f2e801e98611c', chain: Chain.CELO, label: 'Operational Account', custodianType: 'ops' },
  { address: '0x13a9803d547332c81ebc6060f739821264dbcf1e', chain: Chain.CELO, label: 'Operational Account', custodianType: 'ops' },
  { address: '0x619600F4ec13C38868841cB83100F611eCF94eE8', chain: Chain.CELO, label: 'Falcon Finance', custodianType: 'cold' },
  { address: '0xaa8299fc6a685b5f9ce9bda8d0b3ea3d54731976', chain: Chain.CELO, label: 'Rebalancer Bot', custodianType: 'ops' },

  // --- Ethereum ---
  { address: '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9', chain: Chain.ETHEREUM, label: 'Mento Pools Liquidity Reserve', custodianType: 'hot' },
  { address: '0xd0697f70E79476195B742d5aFAb14BE50f98CC1E', chain: Chain.ETHEREUM, label: 'ETH Custody Multisig', custodianType: 'cold' },
  { address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1', chain: Chain.ETHEREUM, label: 'Ops Multisig', custodianType: 'ops' },
  { address: '0xaa8299fc6a685b5f9ce9bda8d0b3ea3d54731976', chain: Chain.ETHEREUM, label: 'Rebalancer Bot', custodianType: 'ops' },
  { address: '0x6dec25d7be9bf6c6fc302977629f2e801e98611c', chain: Chain.ETHEREUM, label: 'Operational Account', custodianType: 'ops' },

  // --- Monad ---
  { address: '0x4255Cf38e51516766180b33122029A88Cb853806', chain: Chain.MONAD, label: 'ReserveV2', custodianType: 'hot' },
  { address: '0x87647780180B8f55980C7D3fFeFe08a9B29e9aE1', chain: Chain.MONAD, label: 'Reserve Safe', custodianType: 'cold' },
  { address: '0x6dec25d7be9bf6c6fc302977629f2e801e98611c', chain: Chain.MONAD, label: 'Operational Account', custodianType: 'ops' },
  { address: '0x13a9803d547332c81ebc6060f739821264dbcf1e', chain: Chain.MONAD, label: 'Operational Account', custodianType: 'ops' },
];

/** Get all reserve addresses for a specific chain */
export function getReserveAddressesByChain(chain: Chain): ReserveAddress[] {
  return RESERVE_ADDRESSES.filter((a) => a.chain === chain);
}

/** Check if an address is a reserve address (case-insensitive) on any chain */
export function isReserveAddress(address: string): boolean {
  const lower = address.toLowerCase();
  return RESERVE_ADDRESSES.some((a) => a.address.toLowerCase() === lower);
}

/** Get the label for a reserve address (case-insensitive), or null if not found. */
export function getReserveAddressLabel(address: string): string | null {
  const lower = address.toLowerCase();
  return RESERVE_ADDRESSES.find((a) => a.address.toLowerCase() === lower)?.label ?? null;
}

/** Get the custodian type for a reserve address (case-insensitive). */
export function getReserveAddressCustodianType(address: string): CustodianType | null {
  const lower = address.toLowerCase();
  return RESERVE_ADDRESSES.find((a) => a.address.toLowerCase() === lower)?.custodianType ?? null;
}
