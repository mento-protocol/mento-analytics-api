import { Inject, Injectable, Logger } from '@nestjs/common';
import { AssetBalance, AssetConfig, Chain, ReserveAddressConfig } from '@types';
import BigNumber from 'bignumber.js';
import { formatUnits } from 'viem';
import { ASSETS_CONFIGS } from '../config/assets.config';
import { BALANCE_FETCHERS } from '../constants';
import { BaseBalanceFetcher } from './balance-fetchers';
import { ReserveValueService } from './reserve-value.service';

/**
 * Service for fetching and formatting asset balances across different chains.
 * Uses chain-specific balance fetchers to retrieve balances for configured reserve addresses
 * and fetches their USD values.
 */
@Injectable()
export class ReserveBalanceService {
  private readonly logger = new Logger(ReserveBalanceService.name);
  private readonly balanceFetchers: Map<Chain, BaseBalanceFetcher>;

  constructor(
    private readonly valueService: ReserveValueService,
    @Inject(BALANCE_FETCHERS) balanceFetchers: BaseBalanceFetcher[],
  ) {
    this.balanceFetchers = new Map(balanceFetchers.map((fetcher) => [fetcher.getChain(), fetcher]));
  }

  async fetchBalancesByConfig(reserveAddressConfig: ReserveAddressConfig): Promise<AssetBalance[]> {
    // Get the balance fetcher for the chain of the reserve address.
    const fetcher = this.balanceFetchers.get(reserveAddressConfig.chain);

    // If no balance fetcher is found, log a warning and return an empty array.
    if (!fetcher) {
      this.logger.warn(
        `No balance fetcher found for chain ${reserveAddressConfig.chain}. Skipping address ${reserveAddressConfig.address}.`,
      );
      return [];
    }

    // If the balance fetcher does not support the category of the reserve address,
    // log a warning and return an empty array.
    if (!fetcher.supportsCategory(reserveAddressConfig.category)) {
      this.logger.warn(
        `Fetcher for ${reserveAddressConfig.chain} doesn't support ${reserveAddressConfig.category}. 
        Verify config for address ${reserveAddressConfig.address} has correct category or update 
        balance fetcher for ${reserveAddressConfig.chain}.`,
      );
      return [];
    }

    this.logger.debug(
      reserveAddressConfig,
      `Fetching balance for reserve address config: ${reserveAddressConfig.address}`,
    );

    return Promise.all(
      reserveAddressConfig.assets.map(async (symbol) => {
        // Get the asset config for the symbol.
        const assetConfig = ASSETS_CONFIGS[reserveAddressConfig.chain][symbol];
        if (!assetConfig) {
          this.logger.warn(`Asset config for ${symbol} on ${reserveAddressConfig.chain} not found`);
          return null;
        }

        try {
          // Fetch the balance for the asset.
          // Returns displayBalance (for UI) and valueCalculationBalance (for USD calculation)
          const balanceResult = await fetcher.fetchBalance(
            assetConfig.address ?? null,
            reserveAddressConfig.address,
            reserveAddressConfig.category,
            assetConfig.isVault ?? false,
          );
          let usdValue = 0;
          let formattedBalance = '0';

          // If balance is 0 log a warning and skip value calculation
          if (balanceResult.displayBalance === '0') {
            const msg = `Balance is 0 for asset ${symbol} (${assetConfig.address}) on ${reserveAddressConfig.chain} at ${reserveAddressConfig.address}`;
            const context = {
              reserve_address: reserveAddressConfig.address,
              chain: reserveAddressConfig.chain,
              category: reserveAddressConfig.category,
            };
            this.logger.debug(context, msg);
          } else {
            // Get the usd value using valueCalculationBalance (raw token balance for vaults)
            usdValue = await this.valueService.calculateUsdValue(
              assetConfig,
              balanceResult.valueCalculationBalance,
              reserveAddressConfig.chain,
            );

            // Format the display balance for UI
            const displayBal = balanceResult.displayBalance;
            if (BigNumber.isBigNumber(displayBal) || displayBal.includes('.')) {
              formattedBalance = displayBal;
            } else {
              formattedBalance = this.formatBalance(displayBal, assetConfig);
            }
          }

          return {
            symbol,
            assetAddress: assetConfig.address,
            reserveAddress: reserveAddressConfig.address,
            chain: reserveAddressConfig.chain,
            balance: formattedBalance,
            usdValue: usdValue,
            type: reserveAddressConfig.category,
          };
        } catch (error) {
          const errorMessage = `Failed to fetch balance for ${symbol} on ${reserveAddressConfig.chain} at ${reserveAddressConfig.address}`;
          this.logger.error(error, errorMessage);

          return null;
        }
      }),
      // Filter out any null balances.
    ).then((balances) => balances.filter((b): b is AssetBalance => b !== null));
  }

  private formatBalance(balance: string, assetConfig: AssetConfig): string {
    return assetConfig.symbol === 'BTC' ? balance : formatUnits(BigInt(balance), assetConfig.decimals);
  }
}
