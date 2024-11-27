import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '@common/services/mento.service';
import { StablecoinDto, StablecoinsResponseDto } from './dto/stablecoin.dto';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { ICONS_BASE_URL } from './constants';
import { ethers } from 'ethers';

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
            const formattedTotalSupply = Number(ethers.formatUnits(token.totalSupply, token.decimals));

            // TODO: In some cases we have pre-minted some of the stable coins, so using the totalSupply as is is not correct.
            //       We need to identify which ones these are and adjust accordingly. Currently the only one we do this for is cUSD.
            //       A clean way to handle this would be to have a function that can take a token and return the adjusted supply.
            //       const adjustedSupply = this.getAdjustedSupply(token);
            //       Ideally this function/logic should be close to where the data is fetched(sdk). However, that would require implementing
            //       curve pool logic in the sdk. This feels off but ultimately will be best as it means 3rd parties can use the same logic
            //       without having to know about Mento's curve pool. So to not introduce technical debt long term we should implement this in \
            //       the SDK.

            // Convert from fiat to USD
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
