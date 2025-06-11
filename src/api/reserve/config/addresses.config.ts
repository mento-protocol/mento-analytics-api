import { Chain, AddressCategory, ReserveAddressConfig } from '@types';

/**
 * The list of addresses that hold reserve assets.
 * @dev This file should only contain addresses that are used for holding reserve assets.
 *      Addresses for interacting with external protocols or contracts should be defined in a
 *      separate file.
 */
export const RESERVE_ADDRESS_CONFIGS: ReserveAddressConfig[] = [
  {
    address: '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Main Reserve',
    assets: ['CELO', 'USDC', 'axlUSDC', 'USDT', 'axlEUROC'],
    description: `The main reserve contract that manages reserve assets used to
    stabilize stablecoins through spending limits, asset allocation,
    and reserve ratio enforcement.`,
  },
  {
    address: '0x87647780180b8f55980c7d3ffefe08a9b29e9ae1',
    chain: Chain.CELO,
    category: AddressCategory.UNIV3_POOL,
    label: 'Reserve multisig on Celo',
    assets: ['CELO', 'WETH', 'USDT'],
    description: 'A reserve owned multisig with positions in Uniswap V3 on Celo',
  },
  {
    address: '0x87647780180b8f55980c7d3ffefe08a9b29e9ae1',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Reserve multisig on Celo',
    assets: ['CELO', 'USDGLO', 'USDC', 'stEUR'],
    description: `A reserve owned multisig holding assets on Celo`,
  },
  {
    address: '0x13a9803d547332c81Ebc6060F739821264DBcf1E',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Reserve address',
    assets: ['CELO'],
    description: 'Holds reserve owned funds on CELO',
  },
  {
    address: '0xDA7BFEF937F0944551a24b4C68B054bfA7127570',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Operational account',
    assets: ['CELO', 'USDC', 'USDT', 'axlEUROC', 'axlUSDC'],
    description: 'Holds reserve assets for operational and rebalancing purposes',
  },
  {
    address: '0xDA7BFEF937F0944551a24b4C68B054bfA7127570',
    chain: Chain.ETHEREUM,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Operational account',
    assets: ['USDC', 'USDT', 'EURC'],
    description: 'Holds reserve assets for operational and rebalancing purposes',
  },
  {
    address: '0xd0697f70E79476195B742d5aFAb14BE50f98CC1E',
    chain: Chain.ETHEREUM,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Mento Reserve on Ethereum',
    assets: ['ETH', 'WBTC', 'stETH', 'EURC', 'sDAI', 'USDC'],
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
  {
    address: '0xDA7BFEF937F0944551a24b4C68B054bfA7127570',
    chain: Chain.CELO,
    category: AddressCategory.AAVE,
    label: 'Aave assets in operational account',
    assets: ['CELO', 'USDT'],
    description: 'Reserve assets held in the Aave protocol',
  },
  {
    address: '0x87647780180B8f55980C7D3fFeFe08a9B29e9aE1',
    chain: Chain.CELO,
    category: AddressCategory.AAVE,
    label: 'Aave assets',
    assets: ['CELO', 'USDT'],
    description: 'Reserve assets held in the Aave protocol',
  },
];
