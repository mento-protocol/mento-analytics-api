import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MentoService } from './services/mento.service';
import { ExchangeRatesService } from './services/exchange-rates.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [MentoService, ExchangeRatesService],
  exports: [MentoService, ExchangeRatesService],
})
export class CommonModule {}
