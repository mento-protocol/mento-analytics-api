import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Chain } from '@types';
import { V2MetaDto } from './v2-meta.dto';

export class V2SupplyOverviewDto {
  @ApiProperty() total_usd: number;
  @ApiProperty() debt_usd: number;
  @ApiProperty() reserve_debt_usd: number;
  @ApiProperty() cdp_debt_usd: number;
  @ApiProperty() reserve_held_usd: number;
  @ApiProperty() lost_usd: number;
  @ApiProperty() stablecoin_count: number;
}

export class V2ReserveBackingDto {
  @ApiProperty() collateral_usd: number;
  @ApiProperty() debt_usd: number;
  @ApiProperty() ratio: number;
  @ApiProperty() stablecoin_count: number;
}

export class V2CdpBackingDto {
  @ApiProperty() stablecoin: string;
  @ApiProperty() collateral_token: string;
  @ApiProperty() collateral_usd: number;
  @ApiProperty() collateral_amount: string;
  @ApiProperty() debt_usd: number;
  @ApiProperty() debt_amount: string;
  @ApiProperty() ratio: number;
  @ApiProperty() status: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
}

export class V2OverviewResponseDto {
  @ApiProperty() supply: V2SupplyOverviewDto;
  @ApiProperty() reserve_backing: V2ReserveBackingDto;
  @ApiProperty({ type: [V2CdpBackingDto] }) cdp_backings: V2CdpBackingDto[];
  @ApiProperty() timestamp: string;
  @ApiPropertyOptional() meta?: V2MetaDto;
}
