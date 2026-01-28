import { Module } from '@nestjs/common';
import { CommonModule } from '@common/common.module';
import { ReserveService } from './services/reserve.service';
import { ConfigModule } from '@nestjs/config';
import { ReserveController } from './reserve.controller';
import { BitcoinBalanceFetcher } from './services/balance-fetchers/bitcoin-balance-fetcher';
import { ReserveBalanceService } from './services/reserve-balance.service';
import { ReserveValueService } from './services/reserve-value.service';
import { CeloBalanceFetcher, EthereumBalanceFetcher } from './services/balance-fetchers';
import { BALANCE_FETCHERS } from './constants/injection-tokens';
import { StablecoinsModule } from '../stablecoins/stablecoins.module';

@Module({
  imports: [CommonModule, ConfigModule, StablecoinsModule],
  controllers: [ReserveController],
  providers: [
    ReserveService,
    ReserveBalanceService,
    ReserveValueService,
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
