import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '../../common/services/mento.service';
import { StablecoinDto, StablecoinsResponseDto } from './dto/stablecoin.dto';
import { Mento } from '@mento/sdk';

@Injectable()
export class StablecoinsService {
  private readonly logger = new Logger(StablecoinsService.name);
  private readonly mento: Mento;

  constructor(private readonly mentoService: MentoService) {}

  async getStablecoins(): Promise<StablecoinsResponseDto> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const mento = this.mentoService.getMentoInstance();
        const tokens = await mento.getStableTokens();

        const stablecoins: StablecoinDto[] = await Promise.all(
          tokens.map(async (token) => {
            // TODO: Integrate service to get the actual price to calculate the real value
            const usdValue = Number(token.totalSupply);

            return {
              symbol: token.symbol,
              name: token.name,
              supply: {
                amount: token.totalSupply.toString(),
                usd_value: usdValue,
              },

              // TODO: Think about how we want to handle icons
              //       Maybe we want to store them in a separate github repo like the token lists
              //       Or maybe even store them in this repo
              icon_url: `https://raw.githubusercontent.com/mento-protocol/reserve-site/refs/heads/main/public/assets/tokens/cUSD.svg`,
            };
          }),
        );

        const total_supply_usd = stablecoins.reduce((sum, coin) => sum + coin.supply.usd_value, 0);

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
