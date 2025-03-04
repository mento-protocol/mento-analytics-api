import { Module } from '@nestjs/common';
import { CommonModule } from '@common/common.module';
import { CacheController } from './cache.controller';

@Module({
  imports: [CommonModule],
  controllers: [CacheController],
})
export class CacheModule {}
