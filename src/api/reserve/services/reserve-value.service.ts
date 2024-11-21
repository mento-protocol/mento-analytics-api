import { Injectable, Logger } from '@nestjs/common';
import { AssetConfig } from 'src/types';
import { ethers } from 'ethers';
import { PriceFetcherService } from 'src/common/services/price-fetcher.service';

/**
 * Service for calculating USD values of asset balances.
 * Handles balance formatting and price fetching for different assets.
 */
@Injectable()
export class ReserveValueService {
  private readonly logger = new Logger(ReserveValueService.name);

  constructor(private readonly priceFetcher: PriceFetcherService) {}

  async calculateUsdValue(assetConfig: AssetConfig, balance: string): Promise<number> {
    try {
      // If the asset has a rate symbol set, then we use this to get the price instead
      const rateSymbol = assetConfig.rateSymbol ?? assetConfig.symbol;

      const price = await this.priceFetcher.getPrice(rateSymbol);
      const formattedBalance =
        assetConfig.symbol === 'BTC' ? Number(balance) : Number(ethers.formatUnits(balance, assetConfig.decimals));

      return formattedBalance * price;
    } catch (error) {
      this.logger.error(`Failed to calculate USD value for ${assetConfig.symbol}:`, error);
      return 0;
    }
  }
}
