import { describe, expect, it } from 'vitest';
import { AddressCategory, Chain } from '@types';
import { getReserveAddressesByChain } from '@api/v2/config/reserve-addresses.config';
import { RESERVE_ADDRESS_CONFIGS } from './addresses.config';
import { ASSETS_CONFIGS } from './assets.config';

const EUROP_ADDRESS = '0x888883b5F5D21fb10Dfeb70e8f9722B9FB0E5E51';

const EUROP_HOLDERS = [
  { chain: Chain.ETHEREUM, address: '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9' },
  { chain: Chain.ETHEREUM, address: '0xd0697f70E79476195B742d5aFAb14BE50f98CC1E' },
  { chain: Chain.ETHEREUM, address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1' },
  { chain: Chain.POLYGON, address: '0x4255Cf38e51516766180b33122029A88Cb853806' },
  { chain: Chain.POLYGON, address: '0x87647780180B8f55980C7D3fFeFe08a9B29e9aE1' },
  { chain: Chain.POLYGON, address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1' },
] as const;

describe('EUROP reserve tracking configuration', () => {
  it.each([Chain.ETHEREUM, Chain.POLYGON])('defines EUROP metadata on %s', (chain) => {
    expect(ASSETS_CONFIGS[chain].EUROP).toEqual({
      symbol: 'EUROP',
      name: 'Schuman EURØP',
      decimals: 6,
      address: EUROP_ADDRESS,
      rateSymbol: 'EURC',
    });
  });

  it.each(EUROP_HOLDERS)('tracks EUROP at $address on $chain', ({ chain, address }) => {
    const holderConfig = RESERVE_ADDRESS_CONFIGS.find(
      (config) =>
        config.chain === chain &&
        config.category === AddressCategory.MENTO_RESERVE &&
        config.address.toLowerCase() === address.toLowerCase(),
    );

    expect(holderConfig?.assets).toContain('EUROP');
  });

  it('includes the live Polygon reserve contract and multisigs in the canonical address registry', () => {
    const polygonAddresses = getReserveAddressesByChain(Chain.POLYGON).map(({ address }) => address.toLowerCase());
    const requiredAddresses = EUROP_HOLDERS.filter(({ chain }) => chain === Chain.POLYGON).map(({ address }) =>
      address.toLowerCase(),
    );

    expect(polygonAddresses).toEqual(expect.arrayContaining(requiredAddresses));
  });
});
