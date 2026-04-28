import { BackingType, Chain } from '@types';

export type BridgeType = 'burn-and-mint' | 'lockbox';

export interface StablecoinNetworkDeployment {
  chain: Chain;
  /** Token contract address on this chain */
  address: string;
  decimals: number;
  /** Bridge type from hub (Celo) to this chain */
  bridge: BridgeType;
  /**
   * For lockbox bridges: NTT manager address on Celo that holds locked tokens.
   * The lockbox balance is subtracted from Celo totalSupply to get true Celo circulating supply.
   */
  celoLockboxAddress?: string;
}

export interface StablecoinBackingConfig {
  symbol: string;
  backing: BackingType;
  networks: Chain[];
  /** Non-Celo deployments with bridge type info */
  deployments?: StablecoinNetworkDeployment[];
  /** For CDP-backed stablecoins: the collateral token symbol */
  collateralToken?: string;
}

/**
 * Maps each Mento stablecoin to its backing mechanism and deployment chains.
 * Reserve-backed stablecoins are backed by the diversified crypto reserve.
 * CDP-backed stablecoins are minted by depositing collateral in a Liquity-style trove.
 *
 * Monad deployment addresses (from @mento-protocol/contracts):
 *   USDm: 0xBC69212B8E4d445b2307C9D32dD68E2A4Df00115
 *   GBPm: 0x39bb4E0a204412bB98e821d25e7d955e69d40Fd1
 */
export const STABLECOIN_BACKING_CONFIGS: StablecoinBackingConfig[] = [
  {
    symbol: 'USDm',
    backing: 'reserve',
    networks: [Chain.CELO, Chain.MONAD],
    deployments: [
      {
        chain: Chain.MONAD,
        address: '0xBC69212B8E4d445b2307C9D32dD68E2A4Df00115',
        decimals: 18,
        bridge: 'burn-and-mint',
      },
    ],
  },
  {
    symbol: 'EURm',
    backing: 'reserve',
    networks: [Chain.CELO, Chain.MONAD],
    deployments: [
      {
        chain: Chain.MONAD,
        address: '0x4D502d735B4C574B487Ed641ae87cEaE884731C7',
        decimals: 18,
        bridge: 'burn-and-mint',
      },
    ],
  },
  { symbol: 'BRLm', backing: 'reserve', networks: [Chain.CELO] },
  { symbol: 'XOFm', backing: 'reserve', networks: [Chain.CELO] },
  { symbol: 'KESm', backing: 'reserve', networks: [Chain.CELO] },
  { symbol: 'PHPm', backing: 'reserve', networks: [Chain.CELO] },
  { symbol: 'COPm', backing: 'reserve', networks: [Chain.CELO] },
  { symbol: 'GHSm', backing: 'reserve', networks: [Chain.CELO] },
  { symbol: 'NGNm', backing: 'reserve', networks: [Chain.CELO] },
  { symbol: 'ZARm', backing: 'reserve', networks: [Chain.CELO] },
  { symbol: 'JPYm', backing: 'cdp', networks: [Chain.CELO], collateralToken: 'USDm' },
  { symbol: 'CHFm', backing: 'cdp', networks: [Chain.CELO], collateralToken: 'USDm' },
  { symbol: 'CADm', backing: 'reserve', networks: [Chain.CELO] },
  { symbol: 'AUDm', backing: 'reserve', networks: [Chain.CELO] },
  {
    symbol: 'GBPm',
    backing: 'cdp',
    networks: [Chain.CELO, Chain.MONAD],
    collateralToken: 'USDm',
    deployments: [
      {
        chain: Chain.MONAD,
        address: '0x39bb4E0a204412bB98e821d25e7d955e69d40Fd1',
        decimals: 18,
        bridge: 'lockbox',
        celoLockboxAddress: '0x7895D03FfDeb14a57eF79c21C3eA14dADf2a7c3f',
      },
    ],
  },
];

/**
 * Lookup a stablecoin's backing config by symbol.
 * Falls back to reserve-backed on Celo if not found.
 */
export function getBackingConfig(symbol: string): StablecoinBackingConfig {
  return (
    STABLECOIN_BACKING_CONFIGS.find((c) => c.symbol === symbol) ?? {
      symbol,
      backing: 'reserve' as BackingType,
      networks: [Chain.CELO],
    }
  );
}
