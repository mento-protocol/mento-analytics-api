import { Module } from '@nestjs/common';
import { StablecoinsService } from './stablecoins.service';
import { StablecoinsController } from './stablecoins.controller';
@Module({
  imports: [],
  controllers: [StablecoinsController],
  providers: [StablecoinsService],
  exports: [StablecoinsService],
})
export class StablecoinsModule {}
