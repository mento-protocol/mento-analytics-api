import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '@common/services/mento.service';
import { StablecoinDto, StablecoinsResponseDto } from './dto/stablecoin.dto';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { ICONS_BASE_URL } from './constants';
import { formatUnits } from 'viem';
import { withRetry } from '@/utils';
import { STABLE_TOKEN_FIAT_MAPPING } from '@common/constants';

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
            const fiatTicker = STABLE_TOKEN_FIAT_MAPPING[token.symbol];
            const formattedTotalSupply = Number(formatUnits(BigInt(token.totalSupply), token.decimals));
            const rawUsdValue = await this.exchangeRatesService.convert(formattedTotalSupply, fiatTicker, 'USD');

            // Get the icon URL with fallback
            const iconUrl = await this.getIconUrl(token.symbol);

            return {
              symbol: token.symbol,
              name: token.name,
              address: token.address,
              supply: {
                amount: formattedTotalSupply.toString(),
                usd_value: Number(rawUsdValue),
              },
              decimals: token.decimals,
              icon_url: iconUrl,
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

  /**
   * Check if an icon exists for a given URL.
   * @param url The URL to check.
   * @returns True if the icon exists, false otherwise.
   */
  private async iconExists(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get the icon URL for a given symbol.
   * @param symbol The symbol of the stablecoin.
   * @returns The icon URL for the stablecoin.
   */
  private async getIconUrl(symbol: string): Promise<string> {
    const iconUrl = `${ICONS_BASE_URL}/${symbol}.svg`;

    if (await this.iconExists(iconUrl)) {
      return iconUrl;
    } else {
      this.logger.warn(`Icon not found for ${symbol}, using default.svg`);
      return `${ICONS_BASE_URL}/default.svg`;
    }
  }
}
