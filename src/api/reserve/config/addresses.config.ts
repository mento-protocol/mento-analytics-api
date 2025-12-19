import { AddressCategory, Chain, ReserveAddressConfig } from '@types';

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
    label: 'Mento Pools Liquidity Reserve',
    assets: ['CELO', 'USDC', 'axlUSDC', 'USDT', 'axlEUROC'],
    description: `The main reserve contract that manages reserve assets used to
    stabilize stablecoins through spending limits, asset allocation,
    and reserve ratio enforcement.`,
  },
  {
    address: '0x87647780180b8f55980c7d3ffefe08a9b29e9ae1',
    chain: Chain.CELO,
    category: AddressCategory.UNIV3_POOL,
    label: 'Mento Reserve Custody Multisig',
    assets: ['CELO', 'WETH', 'USDT'],
    description: 'A reserve owned multisig with positions in Uniswap V3 on Celo',
  },
  {
    address: '0x87647780180b8f55980c7d3ffefe08a9b29e9ae1',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Mento Reserve Custody Multisig',
    assets: ['CELO', 'USDGLO', 'USDC', 'stEUR'],
    description: `A reserve owned multisig holding assets on Celo`,
  },
  {
    address: '0xd0697f70E79476195B742d5aFAb14BE50f98CC1E',
    chain: Chain.ETHEREUM,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Mento Reserve Custody Multisig',
    assets: ['ETH', 'WBTC', 'stETH', 'EURC', 'USDC', 'sUSDS'],
    description: 'Main Mento reserve holding collateral assets on Ethereum',
  },
  {
    address: '0x87647780180B8f55980C7D3fFeFe08a9B29e9aE1',
    chain: Chain.CELO,
    category: AddressCategory.AAVE,
    label: 'Mento Reserve Custody Multisig',
    assets: ['CELO', 'USDT'],
    description: 'Reserve assets held in the Aave protocol',
  },
  {
    address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Mento Operational Multisig',
    assets: ['CELO', 'USDC', 'USDT', 'axlEUROC', 'axlUSDC', 'WETH'],
    description: 'Holds reserve assets for rebalancing purposes',
  },
  {
    address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1',
    chain: Chain.ETHEREUM,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Mento Operational Multisig',
    assets: ['USDC', 'USDT', 'ETH', 'stETH', 'EURA', 'EURC'],
    description: 'Holds reserve assets for rebalancing purposes',
  },
  {
    address: '0xD3D2e5c5Af667DA817b2D752d86c8f40c22137E1',
    chain: Chain.CELO,
    category: AddressCategory.AAVE,
    label: 'Mento Operational Multisig',
    assets: ['CELO', 'USDT'],
    description: 'Reserve assets held in the Aave protocol',
  },
  {
    address: '0x9d65E69aC940dCB469fd7C46368C1e094250a400',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Celo Community Shared Reserve',
    assets: ['CELO'],
    description: 'Holds reserve assets',
  },
  {
    address: '0xaa8299fc6a685b5f9ce9bda8d0b3ea3d54731976',
    chain: Chain.CELO,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Reserve Rebalancer Bot',
    assets: ['CELO', 'USDC', 'USDT', 'axlEUROC', 'axlUSDC', 'WETH'],
    description: 'Holds reserve assets for rebalancing purposes',
  },
  {
    address: '0xaa8299fc6a685b5f9ce9bda8d0b3ea3d54731976',
    chain: Chain.ETHEREUM,
    category: AddressCategory.MENTO_RESERVE,
    label: 'Reserve Rebalancer Bot',
    assets: ['USDC', 'USDT', 'ETH', 'stETH'],
    description: 'Holds reserve assets for rebalancing purposes',
  },
];
