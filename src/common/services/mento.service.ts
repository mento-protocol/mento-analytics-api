import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Mento, ChainId } from '@mento-protocol/mento-sdk';
import { ChainClientService } from './chain-client.service';
import { Chain } from '@/types';

/** Maps our internal Chain enum to the SDK's ChainId */
const CHAIN_TO_SDK: Partial<Record<Chain, ChainId>> = {
  [Chain.CELO]: ChainId.CELO,
  [Chain.MONAD]: ChainId.MONAD,
};

@Injectable()
export class MentoService implements OnModuleInit {
  private readonly logger = new Logger(MentoService.name);
  private instances = new Map<Chain, Mento>();

  constructor(private chainClientService: ChainClientService) {}

  async onModuleInit() {
    for (const [chain, sdkChainId] of Object.entries(CHAIN_TO_SDK)) {
      try {
        const client = this.chainClientService.getClient(chain as Chain);
        if (!client) continue;
        const mento = await Mento.create(sdkChainId as ChainId, client);
        this.instances.set(chain as Chain, mento);
        this.logger.log(`Mento SDK initialized for ${chain}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to initialize Mento SDK for ${chain}: ${msg}`);
      }
    }

    if (!this.instances.has(Chain.CELO)) {
      throw new Error('Mento SDK failed to initialize for Celo');
    }
  }

  /** Get the Mento instance for Celo (default, backwards-compatible). */
  getMentoInstance(): Mento {
    return this.getMentoInstanceForChain(Chain.CELO);
  }

  /** Get the Mento instance for a specific chain. */
  getMentoInstanceForChain(chain: Chain): Mento {
    const instance = this.instances.get(chain);
    if (!instance) {
      throw new Error(`Mento SDK not initialized for ${chain}`);
    }
    return instance;
  }

  /** Get all initialized chains. */
  getInitializedChains(): Chain[] {
    return [...this.instances.keys()];
  }
}
