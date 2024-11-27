import { Module } from '@nestjs/common';
import { CommonModule } from '@common/common.module';
import { HealthController } from './health.controller';

@Module({
  imports: [CommonModule],
  controllers: [HealthController],
})
export class HealthModule {}
