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
import { PrimitiveCacheService } from './services/primitive-cache.service';
import { V2CacheWarmerService } from './services/v2-cache-warmer.service';
import { V2PositionsService } from './services/v2-positions.service';
import { MulticallBatchService } from './services/multicall-batch.service';

// Position Readers
import { WalletBalanceReader } from './services/positions/wallet-balance.reader';
import { AaveReader } from './services/positions/aave.reader';
import { CdpTroveReader } from './services/positions/cdp-trove.reader';
import { StabilityPoolReader } from './services/positions/stability-pool.reader';
import { UniV3Reader } from './services/positions/univ3.reader';

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
    PrimitiveCacheService,
    V2CacheWarmerService,
    V2PositionsService,
    MulticallBatchService,
    WalletBalanceReader,
    AaveReader,
    CdpTroveReader,
    StabilityPoolReader,
    UniV3Reader,
  ],
})
export class V2Module {}
