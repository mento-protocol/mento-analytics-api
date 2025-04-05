import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MentoService } from './services/mento.service';
import { ExchangeRatesService } from './services/exchange-rates.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { ChainClientService } from './services/chain-client.service';
import { CacheService } from './services/cache.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [MentoService, ExchangeRatesService, PriceFetcherService, ChainClientService, CacheService],
  exports: [MentoService, ExchangeRatesService, PriceFetcherService, ChainClientService, CacheService],
})
export class CommonModule {}
