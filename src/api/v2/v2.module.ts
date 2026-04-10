import { Module } from '@nestjs/common';
import { StablecoinsModule } from '@api/stablecoins/stablecoins.module';
import { ReserveModule } from '@api/reserve/reserve.module';

// Controllers
import { V2OverviewController } from './controllers/v2-overview.controller';
import { V2StablecoinsController } from './controllers/v2-stablecoins.controller';
import { V2ReserveController } from './controllers/v2-reserve.controller';
import { V2AddressesController } from './controllers/v2-addresses.controller';
import { V2SupplyBreakdownController } from './controllers/v2-supply-breakdown.controller';

// Services
import { V2OverviewService } from './services/v2-overview.service';
import { V2StablecoinsService } from './services/v2-stablecoins.service';
import { V2ReserveService } from './services/v2-reserve.service';
import { V2AddressesService } from './services/v2-addresses.service';
import { V2SupplyBreakdownService } from './services/v2-supply-breakdown.service';
import { FpmmPositionsService } from './services/fpmm-positions.service';

@Module({
  imports: [StablecoinsModule, ReserveModule],
  controllers: [
    V2OverviewController,
    V2StablecoinsController,
    V2ReserveController,
    V2AddressesController,
    V2SupplyBreakdownController,
  ],
  providers: [
    V2OverviewService,
    V2StablecoinsService,
    V2ReserveService,
    V2AddressesService,
    V2SupplyBreakdownService,
    FpmmPositionsService,
  ],
})
export class V2Module {}
