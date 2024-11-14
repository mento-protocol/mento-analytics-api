import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { StablecoinsModule } from './api/stablecoins/stablecoins.module';

@Module({
  imports: [CommonModule, StablecoinsModule],
})
export class AppModule {}
