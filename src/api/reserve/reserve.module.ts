import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ReserveService } from './reserve.service';
import { ConfigModule } from '@nestjs/config';
import { ERC20BalanceFetcher } from './services/erc20-balance-fetcher';
import { ChainProvidersService } from './services/chain-provider.service';
import { ReserveController } from './reserve.controller';
import { BitcoinBalanceFetcher } from './services/bitcoin-balance-fetcher';

@Module({
  imports: [
    CacheModule.register({
      ttl: 300, // 5 minutes cache
    }),
    ConfigModule,
  ],
  controllers: [ReserveController],
  providers: [
    ReserveService,
    ChainProvidersService,
    BitcoinBalanceFetcher,
    {
      provide: 'ERC20_BALANCE_FETCHER',
      useClass: ERC20BalanceFetcher,
    },
  ],
  exports: [ReserveService],
})
export class ReserveModule {}
