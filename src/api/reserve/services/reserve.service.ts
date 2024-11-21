import { Injectable, Logger } from '@nestjs/common';
import { AssetBalance, GroupedAssetBalance } from 'src/types';
import { RESERVE_ADDRESS_CONFIGS } from '../config/addresses.config';
import { ASSET_GROUPS } from '../config/assets.config';
import { ReserveBalanceService } from './reserve-balance.service';

@Injectable()
export class ReserveService {
  private readonly logger = new Logger(ReserveService.name);

  constructor(private readonly balanceService: ReserveBalanceService) {}

  /**
   * Get the balances of all reserve holdings
   * @returns The balances of all reserve holdings
   */
  async getReserveHoldings(): Promise<AssetBalance[]> {
    try {
      const allBalances = await Promise.all(
        RESERVE_ADDRESS_CONFIGS.map((config) => this.balanceService.fetchBalancesByConfig(config)),
      );

      return allBalances.flat();
    } catch (error) {
      this.logger.error('Failed to fetch reserve holdings:', error);
      return [];
    }
  }

  /**
   * Get the grouped reserve holdings with total USD value
   */
  async getGroupedReserveHoldings(): Promise<{
    total_holdings_usd: number;
    assets: GroupedAssetBalance[];
  }> {
    const holdings = await this.getReserveHoldings();
    return this.groupHoldings(holdings);
  }

  private groupHoldings(holdings: AssetBalance[]): {
    total_holdings_usd: number;
    assets: GroupedAssetBalance[];
  } {
    const symbolToGroup = this.createSymbolToGroupMapping();
    const groupedHoldings = this.groupHoldingsBySymbol(holdings, symbolToGroup);
    const assets = Object.values(groupedHoldings);

    return {
      total_holdings_usd: this.calculateTotalUsdValue(assets),
      assets: this.sortAssetsByUsdValue(assets),
    };
  }

  private createSymbolToGroupMapping(): Record<string, string> {
    return Object.entries(ASSET_GROUPS).reduce(
      (acc, [mainSymbol, symbols]) => {
        symbols.forEach((symbol) => {
          acc[symbol] = mainSymbol;
        });
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  private groupHoldingsBySymbol(
    holdings: AssetBalance[],
    symbolToGroup: Record<string, string>,
  ): Record<string, GroupedAssetBalance> {
    return holdings.reduce(
      (acc, curr) => {
        const mainSymbol = symbolToGroup[curr.symbol] || curr.symbol;

        if (!acc[mainSymbol]) {
          acc[mainSymbol] = this.createInitialGroupedBalance(mainSymbol);
        }

        acc[mainSymbol] = this.updateGroupedBalance(acc[mainSymbol], curr);
        return acc;
      },
      {} as Record<string, GroupedAssetBalance>,
    );
  }

  private createInitialGroupedBalance(symbol: string): GroupedAssetBalance {
    return {
      symbol,
      totalBalance: '0',
      usdValue: 0,
    };
  }

  private updateGroupedBalance(grouped: GroupedAssetBalance, current: AssetBalance): GroupedAssetBalance {
    return {
      ...grouped,
      totalBalance: (Number(grouped.totalBalance) + Number(current.balance)).toString(),
      usdValue: grouped.usdValue + current.usdValue,
    };
  }

  private calculateTotalUsdValue(assets: GroupedAssetBalance[]): number {
    return assets.reduce((sum, asset) => sum + asset.usdValue, 0);
  }

  private sortAssetsByUsdValue(assets: GroupedAssetBalance[]): GroupedAssetBalance[] {
    return [...assets].sort((a, b) => b.usdValue - a.usdValue);
  }
}
