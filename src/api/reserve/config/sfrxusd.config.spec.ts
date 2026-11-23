import { describe, expect, it } from 'vitest';
import { AddressCategory, Chain } from '@types';
import { getReserveAddressesByChain } from '@api/v2/config/reserve-addresses.config';
import { RESERVE_ADDRESS_CONFIGS } from './addresses.config';
import { ASSETS_CONFIGS } from './assets.config';

const HOLDERS = [
  { chain: Chain.CELO, address: '0x87647780180B8f55980C7D3fFeFe08a9B29e9aE1' },
  { chain: Chain.CELO, address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1' },
  { chain: Chain.ETHEREUM, address: '0xd0697f70E79476195B742d5aFAb14BE50f98CC1E' },
  { chain: Chain.ETHEREUM, address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1' },
];

describe('sfrxUSD reserve tracking configuration', () => {
  it.each([
    { chain: Chain.CELO, address: '0x00000000fD8C4B8A413A06821456801295921a71', isVault: false },
    { chain: Chain.ETHEREUM, address: '0xcf62f905562626cfcdd2261162a51fd02fc9c5b6', isVault: true },
  ])('defines share metadata and Ethereum pricing on $chain', ({ chain, address, isVault }) => {
    const config = ASSETS_CONFIGS[chain].sfrxUSD!;
    expect(config).toMatchObject({
      symbol: 'sfrxUSD',
      name: 'Staked Frax USD',
      decimals: 18,
      address,
      useDefiLlamaPrice: true,
      defiLlamaId: 'ethereum:0xcf62f905562626cfcdd2261162a51fd02fc9c5b6',
    });
    expect(config.isVault ?? false).toBe(isVault);
    expect(config.rateSymbol).toBeUndefined();
  });

  it('tracks exactly the four confirmed chain/holder pairs in v1, all of them reserve wallets in v2', () => {
    const key = ({ chain, address }: { chain: Chain; address: string }) => `${chain}:${address.toLowerCase()}`;
    const expected = HOLDERS.map(key).sort();
    const v1 = RESERVE_ADDRESS_CONFIGS.filter(({ assets }) => assets.includes('sfrxUSD'));
    expect(v1.map(key).sort()).toEqual(expected);
    expect(v1.every(({ category }) => category === AddressCategory.MENTO_RESERVE)).toBe(true);

    // v2 reads every configured asset at every reserve wallet on its chain, so the
    // confirmed holders only need to be registered reserve wallets.
    const v2 = [Chain.CELO, Chain.ETHEREUM].flatMap((chain) =>
      getReserveAddressesByChain(chain).map(({ address }) => key({ chain, address })),
    );
    expect(v2).toEqual(expect.arrayContaining(expected));
  });
});
