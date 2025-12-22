import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MentoService } from './services/mento.service';
import { ExchangeRatesService } from './services/exchange-rates.service';
import { CoinMarketCapPriceFetcherService } from './services/coinmarketcap-price-fetcher.service';
import { DefiLlamaPriceFetcherService } from './services/defillama-price-fetcher.service';
import { ChainClientService } from './services/chain-client.service';
import { CacheService } from './services/cache.service';

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
    CoinMarketCapPriceFetcherService,
    DefiLlamaPriceFetcherService,
    ChainClientService,
    CacheService,
  ],
  exports: [
    MentoService,
    ExchangeRatesService,
    CoinMarketCapPriceFetcherService,
    DefiLlamaPriceFetcherService,
    ChainClientService,
    CacheService,
  ],
})
export class CommonModule {}
