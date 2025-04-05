import { Injectable, Logger } from '@nestjs/common';
import { AssetConfig } from 'src/types';
import { PriceFetcherService } from '@common/services/price-fetcher.service';
import BigNumber from 'bignumber.js';
import * as Sentry from '@sentry/nestjs';
import { formatUnits } from 'viem';

@Injectable()
export class ReserveValueService {
  private readonly logger = new Logger(ReserveValueService.name);

  constructor(private readonly priceFetcher: PriceFetcherService) {}

  async calculateUsdValue(assetConfig: AssetConfig, balance: string | BigNumber): Promise<number> {
    let price = 0;
    try {
      const rateSymbol = assetConfig.rateSymbol ?? assetConfig.symbol;
      price = await this.priceFetcher.getPrice(rateSymbol);

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
