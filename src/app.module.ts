import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from '@nestjs/cache-manager';
import { CacheWarmerService } from '@common/services/cache-warmer.service';
import { CommonModule } from '@common/common.module';
import { StablecoinsModule } from '@api/stablecoins/stablecoins.module';
import { ReserveModule } from '@api/reserve/reserve.module';
import { HealthModule } from './api/health/health.module';
import { LoggerModule } from 'nestjs-pino';
import { getLocalPinoConfig, getProductionPinoConfig } from './config/logger.config';
import { SentryModule } from '@sentry/nestjs/setup';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';

@Module({
  imports: [
    SentryModule.forRoot(),
    ScheduleModule.forRoot(),
    CacheModule.register({
      isGlobal: true,
      ttl: 4500000,
    }),
    CommonModule,
    StablecoinsModule,
    ReserveModule,
    HealthModule,
    LoggerModule.forRoot(process.env.NODE_ENV === 'production' ? getProductionPinoConfig() : getLocalPinoConfig()),
  ],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }, CacheWarmerService],
})
export class AppModule {}
