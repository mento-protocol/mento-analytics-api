import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '@common/services/mento.service';
import { StablecoinDto, StablecoinsResponseDto } from './dto/stablecoin.dto';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { ICONS_BASE_URL } from './constants';
import { formatUnits } from 'viem';
import { withRetry } from '@/utils';

@Injectable()
export class StablecoinsService {
  private readonly logger = new Logger(StablecoinsService.name);

  constructor(
    private readonly mentoService: MentoService,
    private readonly exchangeRatesService: ExchangeRatesService,
  ) {}

  async getStablecoins(): Promise<StablecoinsResponseDto> {
    return withRetry(
      async () => {
        const mento = this.mentoService.getMentoInstance();
        const tokens = await mento.getStableTokens();

        const stablecoins: StablecoinDto[] = await Promise.all(
          tokens.map(async (token) => {
            const fiatTicker = token.fiatTicker;
            const formattedTotalSupply = Number(formatUnits(BigInt(token.totalSupply), token.decimals));
            const rawUsdValue = await this.exchangeRatesService.convert(formattedTotalSupply, fiatTicker, 'USD');

            return {
              symbol: token.symbol,
              name: token.name,
              address: token.address,
              supply: {
                amount: formattedTotalSupply.toString(),
                usd_value: Number(rawUsdValue),
              },
              decimals: token.decimals,
              icon_url: `${ICONS_BASE_URL}/${token.symbol}.svg`,
              fiat_symbol: fiatTicker,
            };
          }),
        );

        const total_supply_usd = Number(stablecoins.reduce((sum, coin) => sum + coin.supply.usd_value, 0));

        return {
          total_supply_usd,
          stablecoins,
        };
      },
      'Failed to fetch stablecoins',
      { logger: this.logger, baseDelay: 5000 },
    );
  }
}
