import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '../../common/services/mento.service';
import { StablecoinDto, StablecoinsResponseDto } from './dto/stablecoin.dto';

@Injectable()
export class StablecoinsService {
  private readonly logger = new Logger(StablecoinsService.name);

  constructor(private readonly mentoService: MentoService) {}

  async getStablecoins(): Promise<StablecoinsResponseDto> {
    try {
      // TODO: would be better to do mento.getStableTokens instead of having to get the instance
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

      const total_supply_usd = stablecoins.reduce(
        (sum, coin) => sum + coin.supply.usd_value,
        0,
      );

      return {
        total_supply_usd,
        stablecoins,
      };
    } catch (error) {
      this.logger.error('Failed to fetch stablecoins', error.stack);
      throw error;
    }
  }
}
