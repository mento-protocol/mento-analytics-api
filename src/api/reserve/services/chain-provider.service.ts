import { Injectable } from '@nestjs/common';
import { JsonRpcProvider, Provider } from 'ethers';
import { ConfigService } from '@nestjs/config';
import { Chain } from 'src/types';

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

    this.providers.set(Chain.CELO, new JsonRpcProvider(celoRpcUrl));
    this.providers.set(Chain.ETHEREUM, new JsonRpcProvider(ethereumRpcUrl));
  }

  /**
   * Get a provider for a given chain
   * @param chain - The chain to get the provider for
   * @returns The provider for the chain
   */
  getProvider(chain: Chain): Provider {
    const provider = this.providers.get(chain);
    if (!provider) {
      throw new Error(`No provider available for chain ${chain}`);
    }
    return provider;
  }
}
