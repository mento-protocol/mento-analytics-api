import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';
import { CacheWarmerService } from '@common/services/cache-warmer.service';
import { CommonModule } from '@common/common.module';
import { StablecoinsModule } from '@api/stablecoins/stablecoins.module';
import { ReserveModule } from '@api/reserve/reserve.module';
import { HealthModule } from './api/health/health.module';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CacheModule.register({
      isGlobal: true,
      ttl: 4500000,
    }),
    CommonModule,
    StablecoinsModule,
    ReserveModule,
    HealthModule,
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          target: 'pino-pretty',
          options: {
            singleLine: true,
          },
        },
      },
    }),
  ],
  providers: [CacheWarmerService],
})
export class AppModule {}
