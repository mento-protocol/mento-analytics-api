export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
] as const;

export const UNIV3_POSITION_MANAGER_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address, uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)',
] as const;

export const UNIV3_FACTORY_ABI = [
  'function getPool(address, address, uint24) view returns (address)',
] as const;

export const UNIV3_POOL_ABI = [
  'function slot0() view returns (uint160, int24, uint160, int24, uint16, uint16)',
] as const;
