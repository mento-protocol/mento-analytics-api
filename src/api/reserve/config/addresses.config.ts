import { Chain, AddressCategory, ReserveAddress } from 'src/types';

// TODO: Import paths @types

export const RESERVE_ADDRESSES: ReserveAddress[] = [
  {
    address: '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Main Reserve',
    assets: ['CELO'], //TODO: Consider making assets strongly typed
    description: 'Main Mento reserve holding collateral assets on Celo',
  },
];
