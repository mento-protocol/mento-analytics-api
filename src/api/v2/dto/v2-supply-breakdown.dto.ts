import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { V2MetaDto } from './v2-meta.dto';

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
  @ApiPropertyOptional() meta?: V2MetaDto;
}
