import { ApiProperty } from '@nestjs/swagger';
import { BackingType, Chain } from '@types';

export class V2StablecoinSupplyDto {
  @ApiProperty() total: string;
  @ApiProperty() total_usd: number;
  @ApiProperty() debt: string;
  @ApiProperty() debt_usd: number;
  @ApiProperty() reserve_held: string;
  @ApiProperty() reserve_held_usd: number;
  @ApiProperty() lost: string;
  @ApiProperty() lost_usd: number;
}

export class V2StablecoinDto {
  @ApiProperty() symbol: string;
  @ApiProperty() name: string;
  @ApiProperty() backing_type: BackingType;
  @ApiProperty() fiat_symbol: string;
  @ApiProperty({ required: false }) icon_url?: string;
  @ApiProperty({ enum: Chain, isArray: true }) networks: Chain[];
  @ApiProperty() supply: V2StablecoinSupplyDto;
  @ApiProperty() market_cap_percentage: number;
}

export class V2StablecoinsResponseDto {
  @ApiProperty() total_supply_usd: number;
  @ApiProperty() total_debt_usd: number;
  @ApiProperty({ type: [V2StablecoinDto] }) stablecoins: V2StablecoinDto[];
}
