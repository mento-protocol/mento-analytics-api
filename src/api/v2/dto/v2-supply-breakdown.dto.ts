import { ApiProperty } from '@nestjs/swagger';

export class V2SupplyBreakdownNodeDto {
  @ApiProperty() id: string;
  @ApiProperty() label: string;
  @ApiProperty() value_usd: number;
  @ApiProperty({ required: false }) color?: string;
  @ApiProperty({ type: [V2SupplyBreakdownNodeDto], required: false })
  children?: V2SupplyBreakdownNodeDto[];
}

export class V2SupplyBreakdownResponseDto {
  @ApiProperty() breakdown: V2SupplyBreakdownNodeDto;
}
