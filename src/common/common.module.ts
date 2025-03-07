import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheService } from './services/cache.service';
import { ChainProvidersService } from './services/chain-provider.service';
import { ExchangeRatesService } from './services/exchange-rates.service';
import { MentoService } from './services/mento.service';
import { MulticallService } from './services/multicall.service';
import { PriceFetcherService } from './services/price-fetcher.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [
    MentoService,
    ExchangeRatesService,
    PriceFetcherService,
    ChainProvidersService,
    CacheService,
    MulticallService,
  ],
  exports: [
    MentoService,
    ExchangeRatesService,
    PriceFetcherService,
    ChainProvidersService,
    CacheService,
    MulticallService,
  ],
})
export class CommonModule {}
