import { ApiProperty } from '@nestjs/swagger';
import { Chain } from '@types';

export class V2AddressDto {
  @ApiProperty() address: string;
  @ApiProperty() label: string;
  @ApiProperty({ required: false }) description?: string;
}

export class V2AddressCategoryDto {
  @ApiProperty() category: string;
  @ApiProperty({ type: [V2AddressDto] }) addresses: V2AddressDto[];
}

export class V2NetworkAddressesDto {
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty({ type: [V2AddressCategoryDto] }) categories: V2AddressCategoryDto[];
}

export class V2AddressesResponseDto {
  @ApiProperty({ type: [V2NetworkAddressesDto] }) networks: V2NetworkAddressesDto[];
}
