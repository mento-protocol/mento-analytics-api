import { Injectable } from '@nestjs/common';
import { ERC20BalanceFetcher } from './services/erc20-balance-fetcher';
import { ChainProvidersService } from './services/chain-provider.service';
import { AddressCategory, AssetBalance, AssetConfig, Chain, GroupedAssetBalance } from 'src/types';
import { RESERVE_ADDRESSES } from './config/addresses.config';
import { ASSETS_CONFIGS } from './config/assets.config';
import { PriceFetcherService } from '../../common/services/price-fetcher.service';
import { ethers } from 'ethers';
import { BitcoinBalanceFetcher } from './services/bitcoin-balance-fetcher';
import { ASSET_GROUPS } from './config/assets.config';

@Injectable()
export class ReserveService {
  private readonly erc20Fetchers: Map<Chain, ERC20BalanceFetcher>;

  constructor(
    private readonly chainProviders: ChainProvidersService,
    private readonly priceFetcher: PriceFetcherService,
    private readonly bitcoinFetcher: BitcoinBalanceFetcher,
  ) {
    this.erc20Fetchers = new Map([
      [Chain.CELO, new ERC20BalanceFetcher(this.chainProviders.getProvider(Chain.CELO))],
      [Chain.ETHEREUM, new ERC20BalanceFetcher(this.chainProviders.getProvider(Chain.ETHEREUM))],
    ]);
  }

  // TODO: Add a log or sentry alert for when a resserve address contains assets with little or no value

  /**
   * Get the balances of all reserve holdings
   * @returns The balances of all reserve holdings
   */
  async getReserveHoldings(): Promise<AssetBalance[]> {
    const holdings: AssetBalance[] = [];

    // Fetch balances for each reserve address category
    await Promise.all([
      this.fetchMentoReserveCeloBalances(),
      this.fetchMentoReserveEthereumBalances(),
      this.fetchBitcoinBalances(),
      this.fetchCurvePoolBalances(),
    ]).then((results) => results.flat().forEach((balance) => holdings.push(balance)));

    return holdings;
  }
  private async fetchCurvePoolBalances(): Promise<AssetBalance[]> {
    // TODO: Seems the curve pools are not being used anymore, confirm then remove.
    // Addresses:
    //          - 0x854ec4ede802e1205802c2bd2c08a43f778fc9a6
    return [];
  }

  /**
   * This function will fetch the balances of the mento reserve addresses on Celo
   * @returns The balances of the mento reserve addresses on Celo
   */
  private async fetchMentoReserveCeloBalances(): Promise<AssetBalance[]> {
    // Get all Celo Mento Reserve addresses
    const mentoReserveCeloAddresses = RESERVE_ADDRESSES.filter(
      (addr) => addr.chain === Chain.CELO && addr.category === AddressCategory.MENTO_RESERVE,
    );

    if (mentoReserveCeloAddresses.length === 0) {
      console.log('No Mento Reserve addresses found on Celo');
      return [];
    }

    const fetcher = this.erc20Fetchers.get(Chain.CELO)!;

    // For each reserve address, fetch all asset balances
    const allBalances = await Promise.all(
      mentoReserveCeloAddresses.flatMap((reserveAddress) =>
        // Map over each asset symbol for this reserve address
        reserveAddress.assets.map(async (symbol) => {
          // Get the config for this asset
          const assetConfig = ASSETS_CONFIGS[symbol];

          if (!assetConfig) {
            console.log(`Asset config for ${symbol} not found`);
            return null;
          }

          // Fetch the balance of the asset for this reserve address
          const balance = await fetcher.fetchBalance(assetConfig.address, reserveAddress.address);

          // Return the balance with USD value calculated
          return {
            symbol,
            address: reserveAddress.address,
            chain: Chain.CELO,
            balance: ethers.formatUnits(balance, assetConfig.decimals),
            usdValue: await this.calculateUsdValue(assetConfig, balance),
          };
        }),
      ),
    );

    // Filter out null values and return the array of balances
    return allBalances.filter((balance): balance is AssetBalance => balance !== null);
  }

  private async fetchMentoReserveEthereumBalances(): Promise<AssetBalance[]> {
    // Get the reserve addresses that live on Ethereum
    const ethReserveAddresses = RESERVE_ADDRESSES.filter(
      (addr) => addr.chain === Chain.ETHEREUM && addr.category === AddressCategory.MENTO_RESERVE,
    );

    if (ethReserveAddresses.length === 0) {
      console.log('Mento Reserve address on Ethereum not found');
      return [];
    }

    const fetcher = this.erc20Fetchers.get(Chain.ETHEREUM)!;

    // For each reserve address, fetch all asset balances
    const allBalances = await Promise.all(
      ethReserveAddresses.flatMap((reserveAddress) =>
        // Map over each asset symbol for this reserve address
        reserveAddress.assets.map(async (symbol) => {
          // Get the config for this asset
          const assetConfig = ASSETS_CONFIGS[symbol];

          if (!assetConfig) {
            console.log(`Asset config for ${symbol} not found`);
            return null;
          }

          // Fetch the balance of the asset for this reserve address
          // Pass null as tokenAddress for ETH, otherwise use the asset's address
          const balance = await fetcher.fetchBalance(
            symbol === 'ETH' ? null : assetConfig.address,
            reserveAddress.address,
          );

          // Return the balance with USD value calculated
          return {
            symbol,
            address: reserveAddress.address,
            chain: Chain.ETHEREUM,
            balance: ethers.formatUnits(balance, assetConfig.decimals),
            usdValue: await this.calculateUsdValue(assetConfig, balance),
          };
        }),
      ),
    );

    // Filter out null values and return the array of balances
    return allBalances.filter((balance): balance is AssetBalance => balance !== null);
  }

  private async fetchBitcoinBalances(): Promise<AssetBalance[]> {
    const bitcoinAddresses = RESERVE_ADDRESSES.filter((addr) => addr.chain === Chain.BITCOIN);

    if (bitcoinAddresses.length === 0) {
      console.log('Bitcoin addresses not found');
      return [];
    }

    return Promise.all(
      bitcoinAddresses.map(async (addr) => {
        const balance = await this.fetchBitcoinBalance(addr.address);
        const assetConfig = ASSETS_CONFIGS['BTC'];

        return {
          symbol: 'BTC',
          address: addr.address,
          chain: Chain.BITCOIN,
          balance: balance,
          usdValue: await this.calculateUsdValue(assetConfig, balance),
        };
      }),
    );
  }

  private async calculateUsdValue(assetConfig: AssetConfig, balance: string): Promise<number> {
    try {
      const price = await this.priceFetcher.getPrice(assetConfig.symbol);

      // For Bitcoin, the balance is already in satoshis, so we just need to convert to BTC
      if (assetConfig.symbol === 'BTC') {
        const btcBalance = Number(balance);
        return btcBalance * price;
      }

      // For other assets, use ethers.formatUnits as before
      const formattedBalance = ethers.formatUnits(balance, assetConfig.decimals);
      return Number(formattedBalance) * price;
    } catch (error) {
      console.error(`Failed to calculate USD value for ${assetConfig.symbol}:`, error);
      return 0;
    }
  }

  private async fetchBitcoinBalance(address: string): Promise<string> {
    const balance = await this.bitcoinFetcher.fetchBalance(address);
    return balance;
  }

  async getGroupedReserveHoldings(): Promise<{
    total_holdings_usd: number;
    assets: GroupedAssetBalance[];
  }> {
    const holdings = await this.getReserveHoldings();

    // Create reverse mapping for asset groups
    const symbolToGroup = Object.entries(ASSET_GROUPS).reduce(
      (acc, [mainSymbol, symbols]) => {
        symbols.forEach((symbol) => {
          acc[symbol] = mainSymbol;
        });
        return acc;
      },
      {} as Record<string, string>,
    );

    // Group by symbol (considering wrapped/native assets)
    const groupedHoldings = holdings.reduce(
      (acc, curr) => {
        // Determine the main symbol (e.g., ETH for WETH)
        const mainSymbol = symbolToGroup[curr.symbol] || curr.symbol;

        if (!acc[mainSymbol]) {
          acc[mainSymbol] = {
            symbol: mainSymbol,
            totalBalance: '0',
            usdValue: 0,
          };
        }

        // Add balances
        acc[mainSymbol].totalBalance = (Number(acc[mainSymbol].totalBalance) + Number(curr.balance)).toString();
        acc[mainSymbol].usdValue += curr.usdValue;

        return acc;
      },
      {} as Record<string, GroupedAssetBalance>,
    );

    const assets = Object.values(groupedHoldings);
    const total_holdings_usd = assets.reduce((sum, asset) => sum + asset.usdValue, 0);

    return {
      total_holdings_usd,
      assets: assets.sort((a, b) => b.usdValue - a.usdValue), // Sort by USD value descending
    };
  }
}
