import { Injectable, Logger } from '@nestjs/common';
import { AssetConfig } from 'src/types';
import { ethers } from 'ethers';
import { PriceFetcherService } from '@common/services/price-fetcher.service';
import BigNumber from 'bignumber.js';

@Injectable()
export class ReserveValueService {
  private readonly logger = new Logger(ReserveValueService.name);

  constructor(private readonly priceFetcher: PriceFetcherService) {}

  async calculateUsdValue(assetConfig: AssetConfig, balance: string | BigNumber): Promise<number> {
    try {
      const rateSymbol = assetConfig.rateSymbol ?? assetConfig.symbol;
      const price = await this.priceFetcher.getPrice(rateSymbol);

      // Check if balance is already formatted (from UniV3Pool)
      if (balance instanceof BigNumber || balance.includes('.')) {
        const formattedBalance = balance instanceof BigNumber ? balance.toNumber() : Number(balance);
        return formattedBalance * price;
      }

      // Handle raw numbers (wei, satoshi, etc.)
      const formattedBalance =
        assetConfig.symbol === 'BTC' ? Number(balance) : Number(ethers.formatUnits(balance, assetConfig.decimals));

      return formattedBalance * price;
    } catch (error) {
      this.logger.error(`Failed to calculate USD value for ${assetConfig.symbol}:`, error, {
        balance,
        type: typeof balance,
        isFormatted: balance instanceof BigNumber || String(balance).includes('.'),
      });
      return 0;
    }
  }
}
