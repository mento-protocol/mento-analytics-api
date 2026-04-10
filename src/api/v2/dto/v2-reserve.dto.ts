import { ApiProperty } from '@nestjs/swagger';
import { Chain } from '@types';

// --- Collateral ---

export class V2CollateralAssetDto {
  @ApiProperty() symbol: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() balance: string;
  @ApiProperty() usd_value: number;
  @ApiProperty() percentage: number;
}

export class V2CollateralDto {
  @ApiProperty() total_usd: number;
  @ApiProperty({ type: [V2CollateralAssetDto] }) assets: V2CollateralAssetDto[];
}

// --- LP Positions ---

export class V2LpTokenDto {
  @ApiProperty() symbol: string;
  @ApiProperty() amount: string;
}

export class V2LpPositionDto {
  @ApiProperty() pool_name: string;
  @ApiProperty() pool_type: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() reserve_liquidity_usd: number;
  @ApiProperty() token_a: V2LpTokenDto;
  @ApiProperty() token_b: V2LpTokenDto;
  @ApiProperty() pool_share_pct: number;
}

export class V2LpPositionsDto {
  @ApiProperty() total_usd: number;
  @ApiProperty({ type: [V2LpPositionDto] }) positions: V2LpPositionDto[];
}

// --- Operational Holdings ---

export class V2OperationalHoldingDto {
  @ApiProperty() token: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() wallet_label: string;
  @ApiProperty() balance: string;
  @ApiProperty() usd_value: number;
}

export class V2OperationalHoldingsDto {
  @ApiProperty() total_usd: number;
  @ApiProperty({ type: [V2OperationalHoldingDto] }) holdings: V2OperationalHoldingDto[];
}

// --- CDP Troves ---

export class V2CdpTroveDto {
  @ApiProperty() stablecoin: string;
  @ApiProperty() collateral_token: string;
  @ApiProperty() collateral_amount: string;
  @ApiProperty() collateral_usd: number;
  @ApiProperty() debt_amount: string;
  @ApiProperty() debt_usd: number;
  @ApiProperty() ratio: number;
  @ApiProperty() liquidation_price: number;
  @ApiProperty() status: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() contract_address: string;
}

export class V2CdpTrovesDto {
  @ApiProperty() total_collateral_usd: number;
  @ApiProperty() total_debt_usd: number;
  @ApiProperty({ type: [V2CdpTroveDto] }) troves: V2CdpTroveDto[];
}

// --- Combined Reserve Response ---

export class V2ReserveResponseDto {
  @ApiProperty() collateral: V2CollateralDto;
  @ApiProperty() lp_positions: V2LpPositionsDto;
  @ApiProperty() operational_holdings: V2OperationalHoldingsDto;
  @ApiProperty() cdp_troves: V2CdpTrovesDto;
}
