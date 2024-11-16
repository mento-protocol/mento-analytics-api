import { Injectable } from '@nestjs/common';
import { ERC20BalanceFetcher } from './services/erc20-balance-fetcher';
import { ChainProvidersService } from './services/chain-provider.service';
import { AddressCategory, AssetBalance, AssetConfig, Chain } from 'src/types';
import { RESERVE_ADDRESSES } from './config/addresses.config';
import { ASSETS_CONFIGS } from './config/assets.config';

@Injectable()
export class ReserveService {
  private readonly erc20Fetchers: Map<Chain, ERC20BalanceFetcher>;

  constructor(private readonly chainProviders: ChainProvidersService) {
    // Initialize ERC20 fetchers for each chain
    this.erc20Fetchers = new Map([
      [Chain.CELO, new ERC20BalanceFetcher(this.chainProviders.getProvider(Chain.CELO))],
      [Chain.ETHEREUM, new ERC20BalanceFetcher(this.chainProviders.getProvider(Chain.ETHEREUM))],
    ]);
  }

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
      this.fetchCurvePoolBalances(),
      this.fetchBitcoinBalances(),
    ]).then((results) => results.flat().forEach((balance) => holdings.push(balance)));

    return holdings;
  }

  /**
   * This function will fetch the balances of the mento reserve addresses on Celo
   * @returns The balances of the mento reserve addresses on Celo
   */
  private async fetchMentoReserveCeloBalances(): Promise<AssetBalance[]> {
    // Get addresses where the chain is celo and the category is mento reserve
    const mentoReserveCelo = RESERVE_ADDRESSES.find(
      (addr) => addr.chain === Chain.CELO && addr.category === AddressCategory.MENTO_RESERVE,
    );

    // TODO: Log an error and return an empty array
    // TODO: Sentry integration for logging errors
    if (!mentoReserveCelo) {
      throw new Error('Mento Reserve address on Celo not found');
    }

    const fetcher = this.erc20Fetchers.get(Chain.CELO)!;

    // Fetch balances for all assets in this reserve
    return Promise.all(
      mentoReserveCelo.assets.map(async (symbol) => {
        // Get the config for the asset with this symbol
        const assetConfig = ASSETS_CONFIGS[symbol];

        if (!assetConfig) {
          // TODO: This is not an error but a warning.
          // If the asset config is not there balances will not be accurate
          console.log(`Asset config for ${symbol} not found`);
          return null;
        }

        // Fetch the balance of the asset for this reserve address
        const balance = await fetcher.fetchBalance(assetConfig.address, mentoReserveCelo.address);

        // Return the balance of the asset for this reserve address with the calculated USD value
        return {
          symbol,
          address: mentoReserveCelo.address,
          chain: Chain.CELO,
          balance,
          usdValue: await this.calculateUsdValue(assetConfig, balance),
        };
      }),
    );
  }

  private async fetchMentoReserveEthereumBalances(): Promise<AssetBalance[]> {
    // TODO: Generalise this, this is the same as the Celo one
    const mentoReserveEth = RESERVE_ADDRESSES.find(
      (addr) => addr.chain === Chain.ETHEREUM && addr.category === AddressCategory.MENTO_RESERVE,
    );

    if (!mentoReserveEth) {
      // TODO: Better logging
      console.log('Mento Reserve address on Ethereum not found');
      return [];
    }

    const fetcher = this.erc20Fetchers.get(Chain.ETHEREUM)!;

    return Promise.all(
      mentoReserveEth.assets.map(async (symbol) => {
        const assetConfig = ASSETS_CONFIGS[symbol];
        const balance = await fetcher.fetchBalance(assetConfig.address, mentoReserveEth.address);

        return {
          symbol,
          address: mentoReserveEth.address,
          chain: Chain.ETHEREUM,
          balance,
          usdValue: await this.calculateUsdValue(assetConfig, balance),
        };
      }),
    );
  }

  private async fetchCurvePoolBalances(): Promise<AssetBalance[]> {
    const curvePool = RESERVE_ADDRESSES.find(
      (addr) => addr.chain === Chain.CELO && addr.category === AddressCategory.CURVE_POOL,
    );

    if (!curvePool) {
      console.log('Curve Pool address on Celo not found');
      return [];
    }

    const fetcher = this.erc20Fetchers.get(Chain.CELO)!;

    return Promise.all(
      curvePool.assets.map(async (symbol) => {
        const assetConfig = ASSETS_CONFIGS[symbol];
        const balance = await fetcher.fetchBalance(assetConfig.address, curvePool.address);

        return {
          symbol,
          address: curvePool.address,
          chain: Chain.CELO,
          balance,
          usdValue: await this.calculateUsdValue(assetConfig, balance),
        };
      }),
    );
  }

  private async fetchBitcoinBalances(): Promise<AssetBalance[]> {
    const bitcoinAddresses = RESERVE_ADDRESSES.filter((addr) => addr.chain === Chain.BITCOIN);

    if (bitcoinAddresses.length === 0) {
      console.log('Bitcoin addresses not found');
      return [];
    }

    // Use a Bitcoin API to fetch balances
    // This would need a separate implementation or external service
    return Promise.all(
      bitcoinAddresses.map(async (addr) => {
        const balance = await this.fetchBitcoinBalance(addr.address);
        const assetConfig = ASSETS_CONFIGS['BTC'];

        return {
          symbol: 'BTC',
          address: addr.address,
          chain: Chain.BITCOIN,
          balance,
          usdValue: await this.calculateUsdValue(assetConfig, balance),
        };
      }),
    );
  }

  private async calculateUsdValue(assetConfig: AssetConfig, balance: string): Promise<number> {
    console.log(assetConfig, balance);
    return 100;
  }

  private async fetchBitcoinBalance(address: string): Promise<string> {
    console.log(address);
    return '0';
  }
}
