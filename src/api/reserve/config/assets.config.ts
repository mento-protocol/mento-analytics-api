import { AssetConfig, Chain } from 'src/types';
// TODO: Import paths alias - @types

/**
 * Asset groups that are used to group like/bridged assets by their main symbol.
 */
export const ASSET_GROUPS: Record<string, string[]> = {
  ETH: ['ETH', 'WETH'],
  BTC: ['BTC', 'WBTC'],
  USDC: ['USDC', 'axlUSDC'],
};

export const ASSETS_CONFIGS: Record<string, AssetConfig> = {
  CLO: {
    symbol: 'CELO',
    name: 'Celo',
    chain: Chain.CELO,
    decimals: 18,
    address: '0x471EcE3750Da237f93B8E339c536989b8978a438',
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    chain: Chain.CELO,
    decimals: 6,
    address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
  },
  axlUSDC: {
    symbol: 'axlUSDC',
    name: 'Axelar USD Coin',
    chain: Chain.CELO,
    decimals: 6,
    address: '0xEB466342C4d449BC9f53A865D5Cb90586f405215',
  },
  USDT: {
    symbol: 'USDT',
    name: 'Mento USD Tether',
    chain: Chain.CELO,
    decimals: 6,
    address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
  },
  BTC: {
    symbol: 'BTC',
    name: 'Bitcoin',
    chain: Chain.BITCOIN,
    decimals: 8,
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    chain: Chain.ETHEREUM,
    decimals: 8,
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },
  stETH: {
    symbol: 'stETH',
    name: 'Lido Staked ETH',
    chain: Chain.ETHEREUM,
    decimals: 18,
    address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  },
  EURC: {
    symbol: 'EURC',
    name: 'Euro Coin',
    chain: Chain.ETHEREUM,
    decimals: 6,
    address: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ether',
    chain: Chain.ETHEREUM,
    decimals: 18,
  },
  USDGLO: {
    symbol: 'USDGLO',
    name: 'Glo Dollar',
    chain: Chain.CELO,
    decimals: 18,
    address: '0x4F604735c1cF31399C6E711D5962b2B3E0225AD3',
  },
  WETH: {
    symbol: 'WETH',
    name: 'Wrapped Ether (Wormhole)',
    chain: Chain.CELO,
    decimals: 18,
    address: '0x66803FB87aBd4aaC3cbB3fAd7C3aa01f6F3FB207',
  },
  sDAI: {
    symbol: 'sDAI',
    name: 'Savings Dai',
    chain: Chain.CELO,
    decimals: 18,
    address: '0x83F20F44975D03b1b09e64809B757c47f942BEeA',
  },
  stEUR: {
    symbol: 'stEUR',
    name: 'Staked agEUR',
    chain: Chain.CELO,
    decimals: 18,
    address: '0x004626A008B1aCdC4c74ab51644093b155e59A23',
  },
};

export type AssetSymbol = keyof typeof ASSETS_CONFIGS;
