import { ApiProperty } from '@nestjs/swagger';
import { Chain } from '@types';

export class V2AddressDto {
  @ApiProperty() address: string;
  @ApiProperty({ enum: Chain, isArray: true }) chains: Chain[];
  @ApiProperty() label: string;
  @ApiProperty({ enum: ['hot', 'cold', 'ops'] }) custodian_type: string;
  @ApiProperty({ required: false }) description?: string;
}

export class V2AddressesResponseDto {
  @ApiProperty({ type: [V2AddressDto] }) reserve: V2AddressDto[];
}
