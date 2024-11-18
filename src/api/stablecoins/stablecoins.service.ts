import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '../../common/services/mento.service';
import { StablecoinDto, StablecoinsResponseDto } from './dto/stablecoin.dto';
import { ExchangeRatesService } from '../../common/services/exchange-rates.service';

@Injectable()
export class StablecoinsService {
  private readonly logger = new Logger(StablecoinsService.name);

  constructor(
    private readonly mentoService: MentoService,
    private readonly exchangeRatesService: ExchangeRatesService,
  ) {}

  async getStablecoins(): Promise<StablecoinsResponseDto> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const mento = this.mentoService.getMentoInstance();
        const tokens = await mento.getStableTokens();

        const stablecoins: StablecoinDto[] = await Promise.all(
          tokens.map(async (token) => {
            const fiatTicker = token.fiatTicker;
            const totalSupply = token.totalSupply;

            // Convert from fiat to USD
            const rawUsdValue = await this.exchangeRatesService.convert(Number(totalSupply), fiatTicker, 'USD');

            // Format USD value to have 2 decimal places
            const usdValue = Number(rawUsdValue.toFixed(2));

            return {
              symbol: token.symbol,
              name: token.name,
              supply: {
                amount: totalSupply.toString(),
                usd_value: usdValue,
              },
              decimals: token.decimals,
              icon_url: `https://raw.githubusercontent.com/mento-protocol/reserve-site/refs/heads/main/public/assets/tokens/cUSD.svg`,
              fiat_symbol: fiatTicker,
            };
          }),
        );

        const total_supply_usd = Number(stablecoins.reduce((sum, coin) => sum + coin.supply.usd_value, 0).toFixed(2));

        return {
          total_supply_usd,
          stablecoins,
        };
      } catch (error) {
        attempt++;
        if (attempt === maxRetries) {
          this.logger.error('Failed to fetch stablecoins after multiple attempts', error.stack);
          throw error;
        }
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }
}
