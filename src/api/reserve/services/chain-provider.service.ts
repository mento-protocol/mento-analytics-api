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
    // TODO: Add checks to make sure RPC URLS are valid
    this.providers.set(Chain.CELO, new JsonRpcProvider(this.config.get('CELO_RPC_URL')));
    this.providers.set(Chain.ETHEREUM, new JsonRpcProvider(this.config.get('ETH_RPC_URL')));
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
