import { ApiProperty } from '@nestjs/swagger';
import { AddressCategory, Chain, type AssetBalance } from 'src/types';

export class ReserveHoldingsResponseDto {
  @ApiProperty({ example: 137827466 })
  total_holdings_usd: number;

  @ApiProperty()
  assets: AssetBalance[];
}

export class CompositionItem {
  @ApiProperty({ example: 'CELO' })
  symbol: string;

  @ApiProperty({ example: 63.34 })
  percentage: number;

  @ApiProperty({ example: 87288921 })
  usd_value: number;
}

export class ReserveCompositionResponseDto {
  @ApiProperty({ type: [CompositionItem] })
  composition: CompositionItem[];
}

export class AddressItem {
  @ApiProperty({ example: '0x9380fA34Fd9e4Fd14c06305fd7B6199089eD4eb9' })
  address: string;

  @ApiProperty({ example: 'Main Reserve', required: false })
  label?: string;
}

export class AddressGroup {
  @ApiProperty({ enum: Chain })
  network: Chain;

  @ApiProperty({ enum: AddressCategory })
  category: AddressCategory;

  @ApiProperty({ type: [AddressItem] })
  addresses: AddressItem[];
}

export class ReserveAddressesResponseDto {
  @ApiProperty({ type: [AddressGroup] })
  addresses: AddressGroup[];
}
