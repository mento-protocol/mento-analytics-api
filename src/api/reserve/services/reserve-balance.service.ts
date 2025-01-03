import { Inject, Injectable, Logger } from '@nestjs/common';
import { Chain, AssetBalance, ReserveAddressConfig, AssetConfig } from '@types';
import { ReserveValueService } from './reserve-value.service';
import { ethers } from 'ethers';
import { BaseBalanceFetcher } from './balance-fetchers';
import { ASSETS_CONFIGS } from '../config/assets.config';
import { BALANCE_FETCHERS } from '../constants';
import BigNumber from 'bignumber.js';
import * as Sentry from '@sentry/nestjs';

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
          this.logger.warn(`Asset config for ${symbol} not found`);
          return null;
        }

        try {
          // Fetch the balance for the asset.
          const balance = await fetcher.fetchBalance(
            assetConfig.address ?? null,
            reserveAddressConfig.address,
            reserveAddressConfig.category,
          );
          let usdValue = 0;
          let formattedBalance = '0';

          // If balance is 0 log a warning and skip value calculation
          if (balance === '0') {
            const errorMessage = `Balance is 0 for asset (${symbol}) ${assetConfig.address}`;
            const errorContext = {
              reserve_address: reserveAddressConfig.address,
              chain: reserveAddressConfig.chain,
              category: reserveAddressConfig.category,
            };
            this.logger.warn(errorContext, errorMessage);
          } else {
            // Get the usd value for the balance.
            usdValue = await this.valueService.calculateUsdValue(assetConfig, balance);

            // Check if the balance is already formatted
            if (BigNumber.isBigNumber(balance) || balance.includes('.')) {
              formattedBalance = balance;
            } else {
              formattedBalance = this.formatBalance(balance, assetConfig);
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

          Sentry.captureException(error, {
            level: 'error',
            extra: {
              reserve_address: reserveAddressConfig.address,
              chain: reserveAddressConfig.chain,
              reserve_category: reserveAddressConfig.category,
              symbol,
              description: errorMessage,
            },
            fingerprint: ['reserve-balance-fetch-error', symbol, reserveAddressConfig.chain],
          });

          return null;
        }
      }),
      // Filter out any null balances.
    ).then((balances) => balances.filter((b): b is AssetBalance => b !== null));
  }

  private formatBalance(balance: string, assetConfig: AssetConfig): string {
    return assetConfig.symbol === 'BTC' ? balance : ethers.formatUnits(balance, assetConfig.decimals);
  }
}
