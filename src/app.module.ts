import { Module } from '@nestjs/common';
import { CommonModule } from '@common/common.module';
import { StablecoinsModule } from '@api/stablecoins/stablecoins.module';
import { ReserveModule } from '@api/reserve/reserve.module';
import { HealthModule } from './api/health/health.module';

@Module({
  imports: [CommonModule, StablecoinsModule, ReserveModule, HealthModule],
})
export class AppModule {}
