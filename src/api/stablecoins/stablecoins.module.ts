import { Module } from '@nestjs/common';
import { StablecoinsService } from './stablecoins.service';
import { StablecoinsController } from './stablecoins.controller';
import { StablecoinAdjustmentsService } from './services/stablecoin-adjustments.service';

@Module({
  imports: [],
  controllers: [StablecoinsController],
  providers: [StablecoinsService, StablecoinAdjustmentsService],
  exports: [StablecoinsService, StablecoinAdjustmentsService],
})
export class StablecoinsModule {}
