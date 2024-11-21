import { AssetConfig, AssetSymbol, Chain } from 'src/types';
// TODO: Import paths alias - @types

/**
 * Asset groups that are used to group like/bridged assets by their main symbol.
 */
export const ASSET_GROUPS: Partial<Record<AssetSymbol, AssetSymbol[]>> = {
  ETH: ['ETH', 'WETH'],
  BTC: ['BTC', 'WBTC'],
  USDC: ['USDC', 'axlUSDC'],
};

// TODO: api/holdings/grouped is calculating incorrect total holdings. Check out why. Compare result to api/holdings

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
      name: 'Wrapped Ether (Wormhole)',
      decimals: 18,
      address: '0x66803FB87aBd4aaC3cbB3fAd7C3aa01f6F3FB207',
    },
    stEUR: {
      symbol: 'stEUR',
      name: 'Staked agEUR',
      decimals: 18,
      address: '0x004626A008B1aCdC4c74ab51644093b155e59A23',
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
  },
  [Chain.BITCOIN]: {
    BTC: {
      symbol: 'BTC',
      name: 'Bitcoin',
      decimals: 8,
    },
  },
};
