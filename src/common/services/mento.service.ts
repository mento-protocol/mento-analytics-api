import { Injectable, OnModuleInit } from '@nestjs/common';
import { Mento, ChainId } from '@mento-protocol/mento-sdk';
import { ChainClientService } from './chain-client.service';
import { Chain } from '@/types';

@Injectable()
export class MentoService implements OnModuleInit {
  private mento: Mento;

  constructor(private chainClientService: ChainClientService) {}

  async onModuleInit() {
    const client = this.chainClientService.getClient(Chain.CELO);
    if (!client) {
      throw new Error('Celo client was not found');
    }

    this.mento = await Mento.create(ChainId.CELO, client);
  }

  getMentoInstance(): Mento {
    if (!this.mento) {
      throw new Error('Mento SDK not initialized');
    }
    return this.mento;
  }
}
