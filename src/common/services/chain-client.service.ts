import { Injectable } from '@nestjs/common';
import { createPublicClient, webSocket, PublicClient, WebSocketTransportConfig } from 'viem';
import { ConfigService } from '@nestjs/config';
import { Chain } from '@types';
import { celo, mainnet } from 'viem/chains';
import { Logger } from '@nestjs/common';
import { Semaphore } from '@/utils';

@Injectable()
export class ChainClientService {
  private clients = new Map<Chain, PublicClient>();
  private blockWatchers = new Map<Chain, () => void>();
  private rpcLimiters = new Map<Chain, Semaphore>();
  private globalRpcLimiter = new Semaphore(1);
  private lastRequestTime = 0;
  private readonly minDelayBetweenRequests = 500; // ms
  private readonly logger = new Logger(ChainClientService.name);

  constructor(private config: ConfigService) {
    this.initializeProviders();
  }

  private initializeProviders() {
    const wsConfig: WebSocketTransportConfig = {
      timeout: 30000,
      reconnect: { attempts: 10, delay: 2000 },
    };

    // Create WebSocket clients
    const celoRpcUrl = this.getRequiredConfig('CELO_RPC_URL');
    const ethereumRpcUrl = this.getRequiredConfig('ETH_RPC_URL');

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

    // Initialize rate limiters (1 concurrent request per chain)
    this.rpcLimiters.set(Chain.CELO, new Semaphore(1));
    this.rpcLimiters.set(Chain.ETHEREUM, new Semaphore(1));

    this.logger.log('RPC clients initialized with enhanced WebSocket configuration');
  }

  private getRequiredConfig(key: string): string {
    const value = this.config.get(key);
    if (!value) throw new Error(`${key} is not set`);
    return value;
  }

  getClient(chain: Chain): PublicClient {
    const client = this.clients.get(chain);
    if (!client) throw new Error(`No client available for chain ${chain}`);
    return client;
  }

  private getRateLimiter(chain: Chain): Semaphore {
    const limiter = this.rpcLimiters.get(chain);
    if (!limiter) throw new Error(`No rate limiter available for chain ${chain}`);
    return limiter;
  }

  /**
   * Execute rate-limited RPC call with global and per-chain throttling
   */
  async executeRateLimited(chain: Chain, operation: (client: PublicClient) => Promise<string>): Promise<string> {
    const client = this.getClient(chain);
    const rateLimiter = this.getRateLimiter(chain);

    return await this.globalRpcLimiter.execute(async () => {
      return await rateLimiter.execute(async () => {
        // Enforce minimum delay between requests
        await this.enforceMinDelay();

        this.logger.debug(
          `RPC call on ${chain} (global queue: ${this.globalRpcLimiter.queueLength()}, ` +
            `chain queue: ${rateLimiter.queueLength()}, permits: ${rateLimiter.availablePermits()})`,
        );

        return await operation(client);
      });
    });
  }

  private async enforceMinDelay(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minDelayBetweenRequests) {
      const delay = this.minDelayBetweenRequests - timeSinceLastRequest;
      this.logger.debug(`Enforcing ${delay}ms delay between requests`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Watch for new blocks on a chain
   */
  watchBlocks(chain: Chain, callback: any): void {
    this.unwatchBlocks(chain);

    const client = this.getClient(chain);
    this.logger.log(`Starting block watcher for ${chain}`);

    const unwatch = client.watchBlockNumber({
      onBlockNumber: callback,
      onError: (error) => this.logger.error(`Block watcher error on ${chain}: ${error.message}`),
    });

    this.blockWatchers.set(chain, unwatch);
  }

  /**
   * Stop watching blocks on a chain
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
   * Clean up all watchers on module destroy
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
