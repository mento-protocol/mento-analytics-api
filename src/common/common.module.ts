import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MentoService } from './services/mento.service';
import { ExchangeRatesService } from './services/exchange-rates.service';
import { PriceFetcherService } from './services/price-fetcher.service';
import { ChainProvidersService } from './services/chain-provider.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [MentoService, ExchangeRatesService, PriceFetcherService, ChainProvidersService],
  exports: [MentoService, ExchangeRatesService, PriceFetcherService, ChainProvidersService],
})
export class CommonModule {}
