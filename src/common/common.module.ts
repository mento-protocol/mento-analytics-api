import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MentoService } from './services/mento.service';
import { ExchangeRatesService } from './services/exchange-rates.service';
import { PriceFetcherService } from './services/price-fetcher.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [MentoService, ExchangeRatesService, PriceFetcherService],
  exports: [MentoService, ExchangeRatesService, PriceFetcherService],
})
export class CommonModule {}
