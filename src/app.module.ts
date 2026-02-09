import { CacheWarmerService } from '@/common/services/cache-warmer.service';
import { ReserveModule } from '@api/reserve/reserve.module';
import { StablecoinsModule } from '@api/stablecoins/stablecoins.module';
import { CommonModule } from '@common/common.module';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import { CacheModule as ApiCacheModule } from './api/cache/cache.module';
import { HealthModule } from './api/health/health.module';
import { CACHE_CONFIG } from './common/config/cache.config';
import { getLocalPinoConfig, getProductionPinoConfig } from './config/logger.config';

@Module({
  imports: [
    SentryModule.forRoot(),
    ScheduleModule.forRoot(),
    CacheModule.register({
      isGlobal: true,
      ttl: CACHE_CONFIG.TTL.DEFAULT,
    }),
    // Rate limiting: 3-tier (10 req/s, 50 req/10s, 100 req/min per IP)
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000, // 1 second window
        limit: 10, // max 10 requests per second
      },
      {
        name: 'medium',
        ttl: 10000, // 10 second window
        limit: 50, // max 50 requests per 10 seconds
      },
      {
        name: 'long',
        ttl: 60000, // 1 minute window
        limit: 100, // max 100 requests per minute
      },
    ]),
    CommonModule,
    StablecoinsModule,
    ReserveModule,
    HealthModule,
    ApiCacheModule,
    LoggerModule.forRoot(process.env.NODE_ENV === 'production' ? getProductionPinoConfig() : getLocalPinoConfig()),
  ],
  providers: [
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_FILTER, useClass: ThrottlerExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    CacheWarmerService,
  ],
})
export class AppModule {}
