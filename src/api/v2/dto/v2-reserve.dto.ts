import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Chain } from '@types';

// --- Collateral ---

export type V2CollateralSourceType = 'wallet' | 'aave' | 'univ3' | 'fpmm' | 'stability_pool';

export class V2CollateralSourceDto {
  @ApiProperty({ enum: ['wallet', 'aave', 'univ3', 'fpmm', 'stability_pool'] })
  type: V2CollateralSourceType;
  @ApiProperty() label: string;
  @ApiProperty() identifier: string;
  @ApiProperty() balance: string;
  @ApiProperty() usd_value: number;
}

export class V2CollateralAssetDto {
  @ApiProperty() symbol: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() balance: string;
  @ApiProperty() usd_value: number;
  @ApiProperty() percentage: number;
  @ApiProperty({ type: [V2CollateralSourceDto] }) sources: V2CollateralSourceDto[];
}

export class V2CollateralDto {
  @ApiProperty() total_usd: number;
  @ApiProperty({ type: [V2CollateralAssetDto] }) assets: V2CollateralAssetDto[];
}

// --- Reserve-Held Supply ---

export class V2ReserveHeldTokenDto {
  @ApiProperty() symbol: string;
  @ApiProperty() amount: number;
  @ApiProperty() usd_value: number;
}

export class V2ReserveHeldSupplyDto {
  @ApiProperty() total_usd: number;
  @ApiProperty({ type: [V2ReserveHeldTokenDto] }) by_token: V2ReserveHeldTokenDto[];
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

/**
 * Net USDm the reserve would retain after closing the trove and repaying debt with a
 * safety buffer. `wiggleroom_pct` is the haircut applied to debt in that calculation.
 */
export class V2CdpTroveOverheadDto {
  @ApiProperty({ description: 'Net USD value retained after the haircut' }) usd: number;
  @ApiProperty({ description: 'Percentage buffer applied to debt before subtracting from collateral' })
  wiggleroom_pct: number;
}

export class V2CdpTroveDto {
  @ApiPropertyOptional() trove_id?: string;
  @ApiPropertyOptional() owner?: string;
  @ApiPropertyOptional() owner_label?: string;
  @ApiProperty() stablecoin: string;
  @ApiProperty() collateral_token: string;
  @ApiProperty() collateral_amount: string;
  @ApiProperty() collateral_usd: number;
  @ApiProperty() debt_amount: string;
  @ApiProperty() debt_usd: number;
  @ApiProperty() ratio: number;
  @ApiPropertyOptional() annual_interest_rate?: number;
  @ApiProperty() liquidation_price: number;
  @ApiProperty() status: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() contract_address: string;
  @ApiProperty({ type: V2CdpTroveOverheadDto }) overhead: V2CdpTroveOverheadDto;
}

export class V2CdpTrovesDto {
  @ApiProperty() total_collateral_usd: number;
  @ApiProperty() total_debt_usd: number;
  @ApiProperty({ type: [V2CdpTroveDto] }) troves: V2CdpTroveDto[];
}

// --- Wallet Balance Position ---

export class V2WalletBalancePositionDto {
  @ApiProperty() address: string;
  @ApiProperty() label: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() token: string;
  @ApiPropertyOptional() token_address: string | null;
  @ApiProperty() balance: string;
  @ApiProperty() usd_value: number;
  @ApiProperty() is_mento_stable: boolean;
}

// --- AAVE Position ---

export class V2AavePositionDto {
  @ApiProperty() address: string;
  @ApiProperty() label: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() token: string;
  @ApiProperty() a_token_address: string;
  @ApiProperty() balance: string;
  @ApiProperty() usd_value: number;
  @ApiProperty() is_mento_stable: boolean;
}

// --- Stability Pool Position ---

export class V2StabilityPoolPositionDto {
  @ApiProperty() pool_address: string;
  @ApiProperty() pool_label: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() depositor: string;
  @ApiProperty() depositor_label: string;
  @ApiProperty() deposit_token: string;
  @ApiProperty() deposit_amount: string;
  @ApiProperty() deposit_usd: number;
  @ApiProperty() collateral_gained_token: string;
  @ApiProperty() collateral_gained: string;
  @ApiProperty() collateral_gained_usd: number;
}

// --- Positions ---

export class V2UniV3TokenDto {
  @ApiProperty() symbol: string;
  @ApiProperty() address: string;
  @ApiProperty() amount: string;
}

export class V2UniV3PositionDto {
  @ApiProperty() position_id: number;
  @ApiProperty() owner: string;
  @ApiProperty() owner_label: string;
  @ApiProperty({ enum: Chain }) chain: Chain;
  @ApiProperty() pool_address: string;
  @ApiProperty() fee_tier: number;
  @ApiProperty() token0: V2UniV3TokenDto;
  @ApiProperty() token1: V2UniV3TokenDto;
  @ApiProperty() liquidity: string;
  @ApiProperty() in_range: boolean;
}

export class V2PositionsDto {
  @ApiProperty({ type: [V2WalletBalancePositionDto] }) wallet_balances: V2WalletBalancePositionDto[];
  @ApiProperty({ type: [V2AavePositionDto] }) aave_deposits: V2AavePositionDto[];
  @ApiProperty({ type: [V2UniV3PositionDto] }) univ3_positions: V2UniV3PositionDto[];
  @ApiProperty({ type: [V2LpPositionDto] }) fpmm_positions: any[];
  @ApiProperty({ type: [V2CdpTroveDto] }) cdp_troves: V2CdpTroveDto[];
  @ApiProperty({ type: [V2StabilityPoolPositionDto] }) stability_pool_deposits: V2StabilityPoolPositionDto[];
}

// --- Combined Reserve Response ---

export class V2ReserveResponseDto {
  @ApiProperty() collateral: V2CollateralDto;
  @ApiProperty() reserve_held_supply: V2ReserveHeldSupplyDto;
  @ApiProperty() lp_positions: V2LpPositionsDto;
  @ApiProperty() operational_holdings: V2OperationalHoldingsDto;
  @ApiProperty() cdp_troves: V2CdpTrovesDto;
  @ApiProperty() positions: V2PositionsDto;
}
