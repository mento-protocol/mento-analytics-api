import { RESERVE_ADDRESS_CONFIGS } from './addresses.config';
import { ASSETS_CONFIGS } from './assets.config';
import { AssetConfig, Chain, ReserveAddressConfig } from 'src/types';

export function getAddressesByChain(chain: Chain): ReserveAddressConfig[] {
  return RESERVE_ADDRESS_CONFIGS.filter((addr) => addr.chain === chain);
}

export function getAssetAddresses(symbol: string): ReserveAddressConfig[] {
  return RESERVE_ADDRESS_CONFIGS.filter((addr) => addr.assets.includes(symbol));
}

export function getAssetConfig(symbol: string): AssetConfig | undefined {
  return ASSETS_CONFIGS[symbol];
}
