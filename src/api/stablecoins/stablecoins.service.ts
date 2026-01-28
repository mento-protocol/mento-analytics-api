import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '@common/services/mento.service';
import { StablecoinDto, StablecoinsResponseDto } from './dto/stablecoin.dto';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { ICONS_BASE_URL } from './constants';
import { formatUnits } from 'viem';
import { withRetry } from '@/utils';
import { getFiatTickerFromSymbol } from '@common/constants';
import { StablecoinAdjustmentsService } from './services/stablecoin-adjustments.service';

@Injectable()
export class StablecoinsService {
  private readonly logger = new Logger(StablecoinsService.name);

  constructor(
    private readonly mentoService: MentoService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly adjustmentsService: StablecoinAdjustmentsService,
  ) {}

  async getStablecoins(): Promise<StablecoinsResponseDto> {
    const stablecoinsResponse = await withRetry(
      async () => {
        const mento = this.mentoService.getMentoInstance();
        const tokens = await mento.getStableTokens();

        // Calculate adjustments first (reserve holdings, AAVE positions, lost tokens)
        const adjustments = await this.adjustmentsService.calculateTotalAdjustments(
          tokens.map((t) => ({ symbol: t.symbol, address: t.address, decimals: t.decimals })),
        );

        const stablecoins: StablecoinDto[] = await Promise.all(
          tokens.map(async (token) => {
            const fiatTicker = getFiatTickerFromSymbol(token.symbol);
            const grossSupply = Number(formatUnits(BigInt(token.totalSupply), token.decimals));

            // Apply per-token adjustment
            const tokenAdjustment = adjustments.byToken[token.symbol];
            const netSupply = tokenAdjustment ? Math.max(0, grossSupply - tokenAdjustment.amount) : grossSupply;

            const rawUsdValue = await this.exchangeRatesService.convert(netSupply, fiatTicker, 'USD');

            // Get the icon URL with fallback
            const iconUrl = await this.getIconUrl(token.symbol);

            return {
              symbol: token.symbol,
              name: token.name,
              address: token.address,
              supply: {
                amount: netSupply.toString(),
                usd_value: Number(rawUsdValue),
              },
              decimals: token.decimals,
              icon_url: iconUrl,
              fiat_symbol: fiatTicker,
            };
          }),
        );

        const total_supply_usd = Number(stablecoins.reduce((sum, coin) => sum + coin.supply.usd_value, 0));

        this.logger.log(
          `Stablecoin supply - Total adjustments: $${adjustments.totalUsdValue.toFixed(2)}, ` +
            `Net outstanding: $${total_supply_usd.toFixed(2)}`,
        );

        return { total_supply_usd, stablecoins };
      },
      'Failed to fetch stablecoins',
      { logger: this.logger, baseDelay: 8000 },
    );
    if (!stablecoinsResponse) {
      this.logger.warn('Failed to fetch stablecoins, returning default values');
      return { total_supply_usd: 0, stablecoins: [] };
    }
    return stablecoinsResponse;
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
