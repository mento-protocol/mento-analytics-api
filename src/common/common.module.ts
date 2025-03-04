import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MentoService } from './services/mento.service';
import { ExchangeRatesService } from './services/exchange-rates.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { ChainProvidersService } from './services/chain-provider.service';
import { CacheService } from './services/cache.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [MentoService, ExchangeRatesService, PriceFetcherService, ChainProvidersService, CacheService],
  exports: [MentoService, ExchangeRatesService, PriceFetcherService, ChainProvidersService, CacheService],
})
export class CommonModule {}
