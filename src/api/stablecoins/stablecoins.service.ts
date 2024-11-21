import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '@common/services/mento.service';
import { StablecoinDto, StablecoinsResponseDto } from './dto/stablecoin.dto';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';

@Injectable()
export class StablecoinsService {
  private readonly logger = new Logger(StablecoinsService.name);

  constructor(
    private readonly mentoService: MentoService,
    private readonly exchangeRatesService: ExchangeRatesService,
  ) {}

  // TODO: The number format is inconsistent between the reserve and stablecoins endpoints.
  //       Should use a shared utility function to format the numbers for consistency.
  //       For USD values, we want a number with 2 decimal places
  //       For token amounts, we want full precision as a string.

  // TODO: Need to add logic to subtract the amount of cUSD that has been preminted and is in the curve pool
  //       from the total supply.

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

            // TODO: In some cases we have pre-minted some of the stable coins, so using the totalSupply as is is not correct.
            //       We need to identify which ones these are and adjust accordingly. Currently the only one we do this for is cUSD.
            //       A clean way to handle this would be to have a function that can take a token and return the adjusted supply.
            //       const adjustedSupply = this.getAdjustedSupply(token);
            //       Ideally this function/logic should be close to where the data is fetched(sdk). However, that would require implementing
            //       curve pool logic in the sdk. This feels off but ultimately will be best as it means 3rd parties can use the same logic
            //       without having to know about Mento's curve pool. So to not introduce technical debt long term we should implement this in \
            //       the SDK.

            // Convert from fiat to USD
            const rawUsdValue = await this.exchangeRatesService.convert(Number(totalSupply), fiatTicker, 'USD');

            // Format USD value to have 2 decimal places
            const usdValue = Number(rawUsdValue.toFixed(2));

            return {
              symbol: token.symbol,
              name: token.name,
              address: token.address,
              supply: {
                amount: totalSupply.toString(),
                usd_value: usdValue,
              },
              decimals: token.decimals,
              // TODO: Move this URL to a config file
              // TODO: Check if the file exists, if not, use the default icon or blank?
              // TODO: Do we want to keep svgs in the reserve repo or move them somewhere else?
              icon_url: `https://raw.githubusercontent.com/mento-protocol/reserve-site/refs/heads/main/public/assets/tokens/${token.symbol}.svg`,
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
