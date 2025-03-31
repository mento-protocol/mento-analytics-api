import { Injectable } from '@nestjs/common';
import { createPublicClient, webSocket, PublicClient } from 'viem';
import { ConfigService } from '@nestjs/config';
import { Chain } from '@types';
import { celo, mainnet } from 'viem/chains';

@Injectable()
export class ChainClientService {
  private clients: Map<Chain, any> = new Map();

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

    const celoClient = createPublicClient({
      chain: celo,
      transport: webSocket(celoRpcUrl),
    });
    this.clients.set(Chain.CELO, celoClient);

    const ethereumClient = createPublicClient({ chain: mainnet, transport: webSocket(ethereumRpcUrl) });
    this.clients.set(Chain.ETHEREUM, ethereumClient);
  }

  /**
   * Get a client for a given chain
   * @param chain - The chain to get the client for
   * @returns The client for the chain
   */
  getClient(chain: Chain): PublicClient {
    const client = this.clients.get(chain);
    if (!client) {
      throw new Error(`No client available for chain ${chain}`);
    }
    return client;
  }
}
