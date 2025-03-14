import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Chain } from '@types';
import { JsonRpcProvider, Provider } from 'ethers';
import { MulticallWrapper } from 'ethers-multicall-provider';

@Injectable()
export class ChainProvidersService {
  private providers: Map<Chain, Provider> = new Map();

  constructor(private config: ConfigService) {
    this.initializeProviders();
  }

  private initializeProviders() {
    const celoRpcUrl = this.config.get('CELO_RPC_URL');
    if (!celoRpcUrl) {
      throw new Error('CELO_RPC_URL is not set');
    }

    const ethereumRpcUrl = this.config.get('ETH_RPC_URL');
    if (!ethereumRpcUrl) {
      throw new Error('ETH_RPC_URL is not set');
    }

    // Create base providers
    const celoProvider = new JsonRpcProvider(celoRpcUrl, 42220, { staticNetwork: true });
    const ethereumProvider = new JsonRpcProvider(ethereumRpcUrl, 1, { staticNetwork: true });

    // Wrap with MulticallWrapper
    this.providers.set(Chain.CELO, MulticallWrapper.wrap(celoProvider));
    this.providers.set(Chain.ETHEREUM, MulticallWrapper.wrap(ethereumProvider));
  }

  /**
   * Get a provider for a given chain
   * @param chain - The chain to get the provider for
   * @returns The provider for the chain (wrapped with MulticallWrapper)
   */
  getProvider(chain: Chain): Provider {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`No provider available for chain ${chain}`);
    }
    return provider;
  }
}
