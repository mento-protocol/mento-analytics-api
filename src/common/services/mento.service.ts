import { Injectable, OnModuleInit } from '@nestjs/common';
import { Mento } from '@mento-protocol/mento-sdk';
import { ChainClientService } from './chain-client.service';
import { Chain } from '@/types';
import { PublicClient } from 'viem';

@Injectable()
export class MentoService implements OnModuleInit {
  private mento: Mento;

  constructor(private chainClientService: ChainClientService) {}

  async onModuleInit() {
    const client: PublicClient = this.chainClientService.getClient(Chain.CELO);
    if (!client) {
      throw new Error('Celo client was not found');
    }

    this.mento = await Mento.create({
      provider: client,
    });
  }

  getMentoInstance(): Mento {
    if (!this.mento) {
      throw new Error('Mento SDK not initialized');
    }
    return this.mento;
  }
}
