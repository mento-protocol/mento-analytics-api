import { Injectable } from '@nestjs/common';
import { createPublicClient, webSocket, PublicClient, WebSocketTransportConfig } from 'viem';
import { ConfigService } from '@nestjs/config';
import { Chain } from '@types';
import { celo, mainnet } from 'viem/chains';
import { Logger } from '@nestjs/common';

@Injectable()
export class ChainClientService {
  private clients: Map<Chain, PublicClient> = new Map();
  private blockWatchers: Map<Chain, () => void> = new Map();
  private readonly logger = new Logger(ChainClientService.name);

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

    const wsConfig: WebSocketTransportConfig = {
      timeout: 20000,
      reconnect: {
        attempts: 5,
        delay: 5000,
      },
    };

    const celoClient = createPublicClient({
      chain: celo,
      transport: webSocket(celoRpcUrl, wsConfig),
    });
    this.clients.set(Chain.CELO, celoClient as PublicClient);

    const ethereumClient = createPublicClient({
      chain: mainnet,
      transport: webSocket(ethereumRpcUrl, wsConfig),
    });
    this.clients.set(Chain.ETHEREUM, ethereumClient as PublicClient);
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

  /**
   * Watch for new blocks on a specific chain and execute a callback
   * @param chain - The chain to watch
   * @param callback - The callback to execute when a new block is found
   */
  watchBlocks(chain: Chain, callback: any): void {
    this.unwatchBlocks(chain);

    const client = this.getClient(chain);

    this.logger.log(`Starting block watcher for ${chain}`);
    const unwatch = client.watchBlockNumber({
      onBlockNumber: callback,
      onError: (error) => {
        this.logger.error(`Error watching blocks on ${chain}: ${error.message}`);
      },
    });

    this.blockWatchers.set(chain, unwatch);
  }

  /**
   * Stop watching blocks on a specific chain
   * @param chain - The chain to stop watching
   */
  unwatchBlocks(chain: Chain): void {
    const unwatch = this.blockWatchers.get(chain);
    if (unwatch) {
      unwatch();
      this.blockWatchers.delete(chain);
      this.logger.log(`Stopped block watcher for ${chain}`);
    }
  }

  /**
   * Clean up all watchers when the module is destroyed
   */
  onModuleDestroy() {
    this.logger.log('Cleaning up chain watchers');
    for (const [chain, unwatch] of this.blockWatchers.entries()) {
      unwatch();
      this.logger.log(`Stopped block watcher for ${chain}`);
    }
    this.blockWatchers.clear();
  }
}
