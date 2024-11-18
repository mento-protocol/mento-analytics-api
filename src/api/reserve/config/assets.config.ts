import { AssetConfig, Chain } from 'src/types';

// TODO: Import paths @types
// TODO: Consider assets that existin on multiple chains. e.g. USDC on Ethereum and Celo
export const ASSETS_CONFIGS: Record<string, AssetConfig> = {
  CELO: {
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
    priceApi: {
      endpoint: 'https://api.coingecko.com/api/v3/simple/price',
      path: 'bitcoin.usd',
    },
  },
};
