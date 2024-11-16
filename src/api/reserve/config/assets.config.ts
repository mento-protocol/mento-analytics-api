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
