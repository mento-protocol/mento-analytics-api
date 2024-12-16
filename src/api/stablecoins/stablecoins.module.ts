import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { StablecoinsService } from './stablecoins.service';
import { StablecoinsController } from './stablecoins.controller';
@Module({
  imports: [
    CacheModule.register({
      ttl: 300, // Cache for 5 minutes
    }),
  ],
  controllers: [StablecoinsController],
  providers: [StablecoinsService],
  exports: [StablecoinsService],
})
export class StablecoinsModule {}
