import { RESERVE_ADDRESSES } from './addresses.config';
import { ASSETS_CONFIGS } from './assets.config';
import { AssetConfig, Chain, ReserveAddress } from 'src/types';

export function getAddressesByChain(chain: Chain): ReserveAddress[] {
  return RESERVE_ADDRESSES.filter((addr) => addr.chain === chain);
}

export function getAssetAddresses(symbol: string): ReserveAddress[] {
  return RESERVE_ADDRESSES.filter((addr) => addr.assets.includes(symbol));
}

export function getAssetConfig(symbol: string): AssetConfig | undefined {
  return ASSETS_CONFIGS[symbol];
}
