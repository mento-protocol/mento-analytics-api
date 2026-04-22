import { Injectable } from '@nestjs/common';
import { RESERVE_ADDRESS_CONFIGS } from '@api/reserve/config/addresses.config';
import { CDP_TROVE_CONFIGS } from '../config/cdp.config';
import { V2AddressesResponseDto, V2NetworkAddressesDto, V2AddressCategoryDto } from '../dto/v2-addresses.dto';
import { Chain } from '@types';

@Injectable()
export class V2AddressesService {
  getAddresses(): V2AddressesResponseDto {
    // Group reserve addresses by chain, then by category
    const networkMap = new Map<Chain, Map<string, V2AddressCategoryDto>>();

    for (const addr of RESERVE_ADDRESS_CONFIGS) {
      if (!networkMap.has(addr.chain)) {
        networkMap.set(addr.chain, new Map());
      }

      const categoryMap = networkMap.get(addr.chain)!;
      const categoryKey = addr.category;

      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, { category: categoryKey, addresses: [] });
      }

      const group = categoryMap.get(categoryKey)!;
      // Deduplicate by address
      if (!group.addresses.some((a) => a.address === addr.address)) {
        group.addresses.push({
          address: addr.address,
          label: addr.label ?? addr.address,
          description: addr.description,
        });
      }
    }

    // Add CDP contract addresses
    for (const cdp of CDP_TROVE_CONFIGS) {
      if (!cdp.contractAddress) continue;

      if (!networkMap.has(cdp.chain)) {
        networkMap.set(cdp.chain, new Map());
      }

      const categoryMap = networkMap.get(cdp.chain)!;
      const categoryKey = 'CDP Contract';

      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, { category: categoryKey, addresses: [] });
      }

      categoryMap.get(categoryKey)!.addresses.push({
        address: cdp.contractAddress,
        label: `${cdp.stablecoin} CDP`,
        description: `CDP trove for minting ${cdp.stablecoin} with ${cdp.collateralToken} collateral`,
      });
    }

    // Convert to response shape
    const networks: V2NetworkAddressesDto[] = Array.from(networkMap.entries()).map(([chain, categoryMap]) => ({
      chain,
      categories: Array.from(categoryMap.values()),
    }));

    return { networks };
  }
}
