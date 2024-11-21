import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ReserveService } from './services/reserve.service';
import { ConfigModule } from '@nestjs/config';
import { ChainProvidersService } from './services/chain-provider.service';
import { ReserveController } from './reserve.controller';
import { BitcoinBalanceFetcher } from './services/balance-fetchers/bitcoin-balance-fetcher';
import { ReserveBalanceService } from './services/reserve-balance.service';
import { ReserveValueService } from './services/reserve-value.service';
import { CeloBalanceFetcher, EthereumBalanceFetcher } from './services/balance-fetchers';
import { BALANCE_FETCHERS } from './constants/injection-tokens';

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
    ReserveBalanceService,
    ReserveValueService,
    ChainProvidersService,
    BitcoinBalanceFetcher,
    CeloBalanceFetcher,
    EthereumBalanceFetcher,
    {
      provide: BALANCE_FETCHERS,
      useFactory: (
        bitcoinFetcher: BitcoinBalanceFetcher,
        celoFetcher: CeloBalanceFetcher,
        ethereumFetcher: EthereumBalanceFetcher,
      ) => [bitcoinFetcher, celoFetcher, ethereumFetcher],
      inject: [BitcoinBalanceFetcher, CeloBalanceFetcher, EthereumBalanceFetcher],
    },
  ],
  exports: [ReserveService],
})
export class ReserveModule {}
