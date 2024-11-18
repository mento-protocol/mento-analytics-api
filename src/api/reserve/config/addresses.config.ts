import { Chain, AddressCategory, ReserveAddress } from 'src/types';

// TODO: Import paths @types

export const RESERVE_ADDRESSES: ReserveAddress[] = [
  {
    address: '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Main Reserve',
    assets: ['CELO', 'USDC', 'axlUSDC', 'USDT'], //TODO: Consider making assets strongly typed
    description: 'Main Mento reserve holding collateral assets on Celo',
  },
  // {
  //   address: '0xd0697f70E79476195B742d5aFAb14BE50f98CC1E',
  //   chain: Chain.ETHEREUM,
  //   category: AddressCategory.MENTO_RESERVE,
  //   label: 'Mento Reserve on Ethereum',
  //   assets: ['ETH', 'WBTC', 'stETH', 'EURC'],
  //   description: 'Main Mento reserve holding collateral assets on Ethereum',
  // },
  // {
  //   address: '0x13a9803d547332c81Ebc6060F739821264DBcf1E',
  //   chain: Chain.ETHEREUM,
  //   category: AddressCategory.MENTO_RESERVE,
  //   label: 'Mento Reserve on Ethereum',
  //   assets: ['ETH'],
  //   description: 'Main Mento reserve holding collateral assets on Ethereum',
  // },
];
