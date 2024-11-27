import { ApiProperty } from '@nestjs/swagger';

export class SupplyDto {
  @ApiProperty({ example: '1000000000000000000' })
  amount: string;

  @ApiProperty({ example: 1000000 })
  usd_value: number;
}

export class StablecoinDto {
  @ApiProperty({ example: 'cUSD' })
  symbol: string;

  @ApiProperty({ example: 'Celo Dollar' })
  name: string;

  @ApiProperty({ example: '0x874069Fa1Eb16D44d622F2e0Ca25eeA17236EA15' })
  address: string;

  @ApiProperty()
  supply: SupplyDto;

  @ApiProperty({ example: 18 })
  decimals: number;

  @ApiProperty({ example: 'USD' })
  fiat_symbol: string;

  @ApiProperty({
    example:
      'https://raw.githubusercontent.com/mento-protocol/reserve-site/refs/heads/main/public/assets/tokens/cUSD.svg',
    required: false,
  })
  icon_url?: string;
}

export class StablecoinsResponseDto {
  @ApiProperty({ example: 33155412 })
  total_supply_usd: number;

  @ApiProperty({ type: [StablecoinDto] })
  stablecoins: StablecoinDto[];
}
