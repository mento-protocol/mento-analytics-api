import { Injectable } from '@nestjs/common';
import { getReserveAddressesByChain } from '../config/reserve-addresses.config';
import { CDP_TROVE_CONFIGS, CDP_REGISTRIES } from '../config/cdp.config';
import { V2AddressesResponseDto, V2NetworkAddressesDto, V2AddressCategoryDto } from '../dto/v2-addresses.dto';
import { Chain } from '@types';

@Injectable()
export class V2AddressesService {
  getAddresses(): V2AddressesResponseDto {
    const networkMap = new Map<Chain, Map<string, V2AddressCategoryDto>>();
    const chainOrder = [Chain.CELO, Chain.ETHEREUM, Chain.MONAD];

    for (const chain of chainOrder) {
      const addresses = getReserveAddressesByChain(chain);
      if (addresses.length === 0) continue;

      const categoryMap = new Map<string, V2AddressCategoryDto>();
      const categoryKey = 'Mento Reserve';
      categoryMap.set(categoryKey, { category: categoryKey, addresses: [] });

      const group = categoryMap.get(categoryKey)!;
      for (const addr of addresses) {
        if (!group.addresses.some((a) => a.address.toLowerCase() === addr.address.toLowerCase())) {
          group.addresses.push({ address: addr.address, label: addr.label });
        }
      }

      networkMap.set(chain, categoryMap);
    }

    // Add CDP contract addresses
    for (const cdp of CDP_TROVE_CONFIGS) {
      if (cdp.status !== 'active') continue;

      const contractAddress = cdp.contractAddress || CDP_REGISTRIES[cdp.stablecoin];
      if (!contractAddress) continue;

      if (!networkMap.has(cdp.chain)) {
        networkMap.set(cdp.chain, new Map());
      }

      const categoryMap = networkMap.get(cdp.chain)!;
      const categoryKey = 'CDP Contract';

      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, { category: categoryKey, addresses: [] });
      }

      const label = cdp.contractAddress ? `${cdp.stablecoin} TroveManager` : `${cdp.stablecoin} AddressesRegistry`;

      categoryMap.get(categoryKey)!.addresses.push({
        address: contractAddress,
        label,
        description: `CDP system for minting ${cdp.stablecoin} with ${cdp.collateralToken} collateral`,
      });
    }

    const networks: V2NetworkAddressesDto[] = chainOrder
      .filter((c) => networkMap.has(c))
      .map((chain) => ({
        chain,
        categories: Array.from(networkMap.get(chain)!.values()),
      }));

    return { networks };
  }
}
