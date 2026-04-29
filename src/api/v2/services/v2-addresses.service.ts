import { Injectable } from '@nestjs/common';
import { RESERVE_ADDRESSES } from '../config/reserve-addresses.config';
import { V2AddressesResponseDto } from '../dto/v2-addresses.dto';

@Injectable()
export class V2AddressesService {
  getAddresses(): V2AddressesResponseDto {
    return {
      reserve: RESERVE_ADDRESSES.map((addr) => ({
        address: addr.address,
        chains: addr.chains,
        label: addr.label,
        custodian_type: addr.custodianType,
        description: addr.description,
      })),
    };
  }
}
