import { Chain, TroveStatus } from '@types';

export interface CdpTroveConfig {
  /** The stablecoin minted by this CDP */
  stablecoin: string;
  /** The token deposited as collateral */
  collateralToken: string;
  /** CDP contract address (empty string if pending) */
  contractAddress: string;
  /** Chain where the CDP is deployed */
  chain: Chain;
  /** Whether the CDP is active or pending deployment */
  status: TroveStatus;
}

/**
 * Celo mainnet CDP contract addresses (Liquity-fork / Bold Protocol).
 * Source: @mento-protocol/contracts and @mento-protocol/mento-sdk borrow registries.
 */
export const CDP_CONTRACTS = {
  TROVE_MANAGER: '0xb38aEf2bF4e34B997330D626EBCd7629De3885C9',
  BORROWER_OPERATIONS: '0x8ec9A81871F816F1EF007a82293703057A943B8A',
  ACTIVE_POOL: '0xa7873F4Bf2A1ea2EB20B1e8A992C4748e78473b2',
  MULTI_TROVE_GETTER: '0x78fd33d2bCe0389cF41e15947B0EB0cE9dF8327F',
  ADDRESSES_REGISTRY: '0xB3136DBadB14Ab587FFa91545538126938Fe0C6E',
  STABILITY_POOL_GBPM: '0x06346c0fAB682dBde9f245D2D84677592E8aaa15',
} as const;

/**
 * AddressesRegistry per CDP instance — the on-chain entry point for resolving
 * TroveManager, TroveNFT, StabilityPool, etc. for each debt token.
 * Source: @mento-protocol/mento-sdk borrowRegistries (v3.2.6).
 */
export const CDP_REGISTRIES: Record<string, string> = {
  GBPm: '0xB3136DBadB14Ab587FFa91545538126938Fe0C6E',
  CHFm: '0xCa70801D91576d069190d1D4CFDDEbdc237A4537',
  JPYm: '0x8f99Aac2FE09A1390617D4AcDD1519f775eE931A',
};

/**
 * Minimal ABI for the AddressesRegistry contract — resolves per-instance addresses.
 */
export const ADDRESSES_REGISTRY_ABI = [
  { type: 'function', name: 'troveManager', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'troveNFT', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'stabilityPool', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const;

/**
 * Safety buffer (as a percentage) applied to trove debt when computing reserve-held overhead.
 * Models redemption fees, interest accrual during the redemption window, oracle drift, and
 * any gas-compensation deductions. Treated as a haircut on collateral: an overhead of
 * `max(0, collateral_usd - debt_usd * (1 + CDP_WIGGLEROOM_PCT/100))`.
 */
export const CDP_WIGGLEROOM_PCT = 10;

/**
 * Multisig addresses that hold troves.
 * These are the trove owners whose positions we track.
 */
export const CDP_TROVE_OWNERS = [
  '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1', // Mento Operational Multisig
  '0xd0697f70E79476195B742d5aFAb14BE50f98CC1E', // Mento Reserve Custody Multisig (ETH)
] as const;

/**
 * CDP trove configurations.
 * Each stablecoin is minted by depositing USDm as collateral in a Liquity-style trove on Celo.
 */
export const CDP_TROVE_CONFIGS: CdpTroveConfig[] = [
  {
    stablecoin: 'GBPm',
    collateralToken: 'USDm',
    contractAddress: CDP_CONTRACTS.TROVE_MANAGER,
    chain: Chain.CELO,
    status: 'active',
  },
  {
    stablecoin: 'JPYm',
    collateralToken: 'USDm',
    contractAddress: '', // resolved from registry at runtime
    chain: Chain.CELO,
    status: 'active',
  },
  {
    stablecoin: 'CHFm',
    collateralToken: 'USDm',
    contractAddress: '', // resolved from registry at runtime
    chain: Chain.CELO,
    status: 'active',
  },
];

/**
 * Minimal TroveManager ABI for reading trove data.
 */
export const TROVE_MANAGER_ABI = [
  {
    type: 'function',
    name: 'getLatestTroveData',
    inputs: [{ name: '_troveId', type: 'uint256' }],
    outputs: [
      {
        name: 'trove',
        type: 'tuple',
        components: [
          { name: 'entireDebt', type: 'uint256' },
          { name: 'entireColl', type: 'uint256' },
          { name: 'redistBoldDebtGain', type: 'uint256' },
          { name: 'redistCollGain', type: 'uint256' },
          { name: 'accruedInterest', type: 'uint256' },
          { name: 'recordedDebt', type: 'uint256' },
          { name: 'annualInterestRate', type: 'uint256' },
          { name: 'weightedRecordedDebt', type: 'uint256' },
          { name: 'accruedBatchManagementFee', type: 'uint256' },
          { name: 'lastInterestRateAdjTime', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTroveIdsCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTroveFromTroveIdsArray',
    inputs: [{ name: '_index', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTroveStatus',
    inputs: [{ name: '_troveId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getEntireBranchDebt',
    inputs: [],
    outputs: [{ name: 'entireSystemDebt', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getEntireBranchColl',
    inputs: [],
    outputs: [{ name: 'entireSystemColl', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;
