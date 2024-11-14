import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mento } from '@mento/sdk';
import { JsonRpcProvider } from 'ethers';

@Injectable()
export class MentoService implements OnModuleInit {
  private mento: Mento;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const rpcUrl = this.configService.get<string>('RPC_URL');
    if (!rpcUrl) {
      throw new Error(
        'RPC_URL is not defined. Verify it is set in environment variables.',
      );
    }

    const provider = new JsonRpcProvider(rpcUrl);
    this.mento = await Mento.create({
      provider,
    });
  }

  getMentoInstance(): Mento {
    if (!this.mento) {
      throw new Error('Mento SDK not initialized');
    }
    return this.mento;
  }
}
