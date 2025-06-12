import { AssetConfig, AssetSymbol, Chain } from '@types';

/**
 * Asset groups that are used to group like/bridged assets by their main symbol.
 */
export const ASSET_GROUPS: Partial<Record<AssetSymbol, AssetSymbol[]>> = {
  ETH: ['ETH', 'WETH'],
  BTC: ['BTC', 'WBTC'],
  USDC: ['USDC', 'axlUSDC'],
  EURC: ['EURC', 'axlEUROC'],
};

/**
 * Mapping of chain to supported assets on that chain.
 * @dev This allows for adding assets with the same key. This could be useful for assets
 *      that exist on multiple chains e.g. native USDC on Celo & Eth.
 *      Chain => AssetSymbol => AssetConfig
 *      Example use:
 *      ASSETS_CONFIGS[Chain.CELO][AssetSymbol.USDC] - to get the config for USDC on Celo.
 *      ASSETS_CONFIGS[Chain.ETHEREUM][AssetSymbol.USDC] - to get the config for USDC on Ethereum.
 */
export const ASSETS_CONFIGS: Record<Chain, Partial<Record<AssetSymbol, AssetConfig>>> = {
  [Chain.CELO]: {
    CELO: {
      symbol: 'CELO',
      name: 'Celo',
      decimals: 18,
      address: '0x471EcE3750Da237f93B8E339c536989b8978a438',
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    },
    axlUSDC: {
      symbol: 'axlUSDC',
      name: 'Axelar USD Coin',
      decimals: 6,
      address: '0xEB466342C4d449BC9f53A865D5Cb90586f405215',
    },
    USDT: {
      symbol: 'USDT',
      name: 'USD Tether',
      decimals: 6,
      address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    },
    USDGLO: {
      symbol: 'USDGLO',
      name: 'Glo Dollar',
      decimals: 18,
      address: '0x4F604735c1cF31399C6E711D5962b2B3E0225AD3',
    },
    WETH: {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      address: '0xD221812de1BD094f35587EE8E174B07B6167D9Af',
    },
    stEUR: {
      symbol: 'stEUR',
      name: 'Staked agEUR',
      decimals: 18,
      address: '0x004626A008B1aCdC4c74ab51644093b155e59A23',
      rateSymbol: 'EURC',
    },
    axlEUROC: {
      symbol: 'axlEUROC',
      name: 'Axelar Wrapped EUROC',
      decimals: 6,
      address: '0x061cc5a2C863E0C1Cb404006D559dB18A34C762d',
      rateSymbol: 'EURC',
    },
  },
  [Chain.ETHEREUM]: {
    WBTC: {
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      decimals: 8,
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    },
    stETH: {
      symbol: 'stETH',
      name: 'Lido Staked ETH',
      decimals: 18,
      address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    },
    EURC: {
      symbol: 'EURC',
      name: 'Euro Coin',
      decimals: 6,
      address: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
    },
    ETH: {
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
    },
    sDAI: {
      symbol: 'sDAI',
      name: 'Savings Dai',
      decimals: 18,
      address: '0x83F20F44975D03b1b09e64809B757c47f942BEeA',
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    USDT: {
      symbol: 'USDT',
      name: 'USD Tether',
      decimals: 6,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    },
  },
  [Chain.BITCOIN]: {
    BTC: {
      symbol: 'BTC',
      name: 'Bitcoin',
      decimals: 8,
    },
  },
};
