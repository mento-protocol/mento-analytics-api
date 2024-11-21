import { Chain, AddressCategory, ReserveAddressConfig } from 'src/types';

// TODO: Import paths @types

// TODO: stEUR USD value comes through as 0, check out why

export const RESERVE_ADDRESS_CONFIGS: ReserveAddressConfig[] = [
  {
    address: '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Main Reserve',
    assets: ['CELO'],
    // assets: ['CELO', 'USDC', 'axlUSDC', 'USDT'],
    description: 'Main Mento reserve holding collateral assets on Celo',
  },
  {
    address: '0x87647780180b8f55980c7d3ffefe08a9b29e9ae1',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Reserve multisig on Celo',
    assets: ['CELO'],
    // assets: ['CELO', 'USDGLO', 'USDC', 'WETH', 'stEUR'],
    description: 'Reserve multisig on Celo',
  },
  // TODO: What is this address?? Currently listed on the reserve site
  {
    address: '0x13a9803d547332c81Ebc6060F739821264DBcf1E',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: '???????',
    assets: ['CELO'],
    description: '??????',
  },
  {
    address: '0xDA7BFEF937F0944551a24b4C68B054bfA7127570',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: '???????',
    assets: ['CELO', 'USDC'],
    description: '??????',
  },
  {
    address: '38EPdP4SPshc5CiUCzKcLP9v7Vqo5u1HBL',
    chain: Chain.BITCOIN,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Bitcoin Reserve',
    assets: ['BTC'],
    description: 'Reserve address holding Bitcoin',
  },
  {
    address: '3Hc1Wje1DeJU5ahXdmD8Pt2yAfoYep331z',
    chain: Chain.BITCOIN,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Bitcoin Reserve',
    assets: ['BTC'],
    description: 'Reserve address holding Bitcoin',
  },
  {
    address: '0xd0697f70E79476195B742d5aFAb14BE50f98CC1E',
    chain: Chain.ETHEREUM,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Mento Reserve on Ethereum',
    assets: ['ETH', 'WBTC', 'stETH', 'EURC', 'sDAI'],
    description: 'Main Mento reserve holding collateral assets on Ethereum',
  },
  {
    address: '0x13a9803d547332c81Ebc6060F739821264DBcf1E',
    chain: Chain.ETHEREUM,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Mento Reserve on Ethereum',
    assets: ['ETH'],
    description: 'Reserve holding collateral assets on Ethereum',
  },
];
