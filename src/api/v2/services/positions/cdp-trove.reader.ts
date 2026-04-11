import { Injectable, Logger } from '@nestjs/common';
import { MulticallBatchService } from '../multicall-batch.service';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { RESERVE_ADDRESSES, getReserveAddressLabel } from '../../config/reserve-addresses.config';
import { CDP_CONTRACTS, TROVE_MANAGER_ABI } from '../../config/cdp.config';
import { Chain } from '@types';
import { formatUnits } from 'viem';

export interface CdpTrovePosition {
  trove_id: string;
  owner: string;
  owner_label: string;
  chain: Chain;
  status: 'active' | 'zombie' | 'closedByOwner' | 'closedByLiquidation';
  collateral_token: string;
  collateral_amount: string;
  collateral_usd: number;
  debt_token: string;
  debt_amount: string;
  debt_usd: number;
  ratio: number;
  annual_interest_rate: number;
  contract_address: string;
}

/** TroveNFT ABI for checking trove ownership */
const TROVE_NFT_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

const TROVE_MANAGER_ADDRESS = CDP_CONTRACTS.TROVE_MANAGER;
const TROVE_NFT_ADDRESS = '0x46273A5792013973b64a42E760E6F81d0472C6b6';

/** Map status enum from contract to string */
function mapTroveStatus(statusCode: number): CdpTrovePosition['status'] {
  switch (statusCode) {
    case 1: return 'active';
    case 4: return 'zombie';
    case 2: return 'closedByOwner';
    case 3: return 'closedByLiquidation';
    default: return 'closedByOwner';
  }
}

@Injectable()
export class CdpTroveReader {
  private readonly logger = new Logger(CdpTroveReader.name);

  constructor(
    private readonly multicallBatchService: MulticallBatchService,
    private readonly exchangeRatesService: ExchangeRatesService,
  ) {}

  /**
   * Enumerate all troves from TroveManager, filter to reserve-owned ones,
   * and read per-trove data.
   */
  async readPositions(): Promise<CdpTrovePosition[]> {
    const chain = Chain.CELO;

    try {
      // Step 1: Get trove count
      const [countResult] = await this.multicallBatchService.batchRead<bigint>(chain, [
        {
          address: TROVE_MANAGER_ADDRESS,
          abi: TROVE_MANAGER_ABI,
          functionName: 'getTroveIdsCount',
        },
      ]);

      if (countResult == null || countResult === 0n) {
        this.logger.log('No troves found in TroveManager');
        return [];
      }

      const troveCount = Number(countResult);
      this.logger.log(`Found ${troveCount} troves in TroveManager`);

      // Step 2: Get all trove IDs
      const idCalls = Array.from({ length: troveCount }, (_, i) => ({
        address: TROVE_MANAGER_ADDRESS,
        abi: [...TROVE_MANAGER_ABI],
        functionName: 'getTroveFromTroveIdsArray',
        args: [BigInt(i)],
      }));

      const troveIds = await this.multicallBatchService.batchRead<bigint>(chain, idCalls);

      // Step 3: Check ownership via TroveNFT.ownerOf for each trove
      const validTroveIds = troveIds.filter((id): id is bigint => id != null);
      const ownerCalls = validTroveIds.map((troveId) => ({
        address: TROVE_NFT_ADDRESS,
        abi: [...TROVE_NFT_ABI],
        functionName: 'ownerOf',
        args: [troveId],
      }));

      const owners = await this.multicallBatchService.batchRead<string>(chain, ownerCalls);

      // Step 4: Filter to reserve-owned troves
      const reserveAddressSet = new Set(
        RESERVE_ADDRESSES.map((a) => a.address.toLowerCase()),
      );

      const reserveTroves: { troveId: bigint; owner: string }[] = [];
      for (let i = 0; i < validTroveIds.length; i++) {
        const owner = owners[i];
        if (owner && reserveAddressSet.has(owner.toLowerCase())) {
          reserveTroves.push({ troveId: validTroveIds[i], owner });
        }
      }

      if (reserveTroves.length === 0) {
        this.logger.log('No reserve-owned troves found');
        return [];
      }

      this.logger.log(`Found ${reserveTroves.length} reserve-owned troves`);

      // Step 5: Read per-trove data (getLatestTroveData + getTroveStatus) in one batch
      const dataCalls = reserveTroves.flatMap((t) => [
        {
          address: TROVE_MANAGER_ADDRESS,
          abi: [...TROVE_MANAGER_ABI],
          functionName: 'getLatestTroveData',
          args: [t.troveId],
        },
        {
          address: TROVE_MANAGER_ADDRESS,
          abi: [...TROVE_MANAGER_ABI],
          functionName: 'getTroveStatus',
          args: [t.troveId],
        },
      ]);

      const dataResults = await this.multicallBatchService.batchRead(chain, dataCalls);

      // Step 6: Build positions
      const positions: CdpTrovePosition[] = [];
      for (let i = 0; i < reserveTroves.length; i++) {
        const { troveId, owner } = reserveTroves[i];
        const troveData = dataResults[i * 2] as any;
        const statusCode = dataResults[i * 2 + 1] as number | null;

        if (!troveData) {
          this.logger.warn(`Failed to read data for trove ${troveId}`);
          continue;
        }

        const entireDebt = troveData.entireDebt ?? troveData[0];
        const entireColl = troveData.entireColl ?? troveData[1];
        const annualInterestRate = troveData.annualInterestRate ?? troveData[6];

        const debtAmount = Number(formatUnits(BigInt(entireDebt), 18));
        const collAmount = Number(formatUnits(BigInt(entireColl), 18));
        const interestRate = Number(formatUnits(BigInt(annualInterestRate), 18));

        // USDm collateral is valued 1:1 with USD; GBPm debt needs GBP->USD conversion
        const collateralUsd = await this.exchangeRatesService.convert(collAmount, 'USD', 'USD');
        const debtUsd = await this.exchangeRatesService.convert(debtAmount, 'GBP', 'USD');
        const ratio = debtUsd > 0 ? collateralUsd / debtUsd : 0;

        positions.push({
          trove_id: troveId.toString(),
          owner,
          owner_label: getReserveAddressLabel(owner) ?? owner.slice(0, 10),
          chain,
          status: mapTroveStatus(statusCode ?? 0),
          collateral_token: 'USDm',
          collateral_amount: collAmount.toString(),
          collateral_usd: collateralUsd,
          debt_token: 'GBPm',
          debt_amount: debtAmount.toString(),
          debt_usd: debtUsd,
          ratio,
          annual_interest_rate: interestRate,
          contract_address: TROVE_MANAGER_ADDRESS,
        });
      }

      this.logger.log(`CDP trove positions: ${positions.length} reserve-owned troves`);
      return positions;
    } catch (error) {
      this.logger.warn(`Failed to read CDP troves: ${error}`);
      return [];
    }
  }
}
