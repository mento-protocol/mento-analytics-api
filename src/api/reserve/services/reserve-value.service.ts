import { Injectable, Logger } from '@nestjs/common';
import { AssetConfig, Chain } from 'src/types';
import { CoinMarketCapPriceFetcherService } from '@common/services/coinmarketcap-price-fetcher.service';
import { DefiLlamaPriceFetcherService } from '@common/services/defillama-price-fetcher.service';
import BigNumber from 'bignumber.js';
import * as Sentry from '@sentry/nestjs';
import { formatUnits } from 'viem';

@Injectable()
export class ReserveValueService {
  private readonly logger = new Logger(ReserveValueService.name);

  constructor(
    private readonly coinMarketCapPriceFetcher: CoinMarketCapPriceFetcherService,
    private readonly defiLlamaPriceFetcher: DefiLlamaPriceFetcherService,
  ) {}

  async calculateUsdValue(assetConfig: AssetConfig, balance: string | BigNumber, chain: Chain): Promise<number> {
    let price = 0;
    try {
      if (assetConfig.useDefiLlamaPrice && assetConfig.address) {
        const defiLlamaId = `${chain}:${assetConfig.address}`;
        price = await this.defiLlamaPriceFetcher.getPrice(defiLlamaId);
      } else {
        const rateSymbol = assetConfig.rateSymbol ?? assetConfig.symbol;
        price = await this.coinMarketCapPriceFetcher.getPrice(rateSymbol);
      }

      // Check if balance is already formatted (from UniV3Pool)
      if (balance instanceof BigNumber || balance.includes('.')) {
        const formattedBalance = balance instanceof BigNumber ? balance.toNumber() : Number(balance);
        return formattedBalance * price;
      }

      // Handle raw numbers (wei, satoshi, etc.)
      const formattedBalance =
        assetConfig.symbol === 'BTC' ? Number(balance) : Number(formatUnits(BigInt(balance), assetConfig.decimals));

      return formattedBalance * price;
    } catch (error) {
      const errorMessage = `Failed to calculate USD value for ${assetConfig.symbol}: ${error}`;
      const errorContext = {
        assetSymbol: assetConfig.symbol,
        balance: balance.toString(),
        rateSymbol: assetConfig.rateSymbol ?? assetConfig.symbol,
        price: price,
      };

      this.logger.error({ ...errorContext }, errorMessage);
      Sentry.captureException(error, {
        level: 'error',
        extra: {
          ...errorContext,
          description: errorMessage,
        },
      });
      return 0;
    }
  }
}
