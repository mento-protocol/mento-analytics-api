import { Injectable, Logger } from '@nestjs/common';
import { MulticallBatchService } from '../multicall-batch.service';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { RESERVE_ADDRESSES, getReserveAddressLabel } from '../../config/reserve-addresses.config';
import {
  CDP_TROVE_CONFIGS,
  CDP_REGISTRIES,
  ADDRESSES_REGISTRY_ABI,
  TROVE_MANAGER_ABI,
  CDP_WIGGLEROOM_PCT,
  CdpTroveConfig,
} from '../../config/cdp.config';
import { getFiatTickerFromSymbol } from '@common/constants';
import { Chain } from '@types';
import { formatUnits } from 'viem';

/**
 * Net USDm the reserve would retain after closing a trove and paying back debt
 * (plus a safety buffer for redemption fees, interest accrual, oracle drift).
 * Clamped at zero for undercollateralized troves.
 */
export interface CdpTroveOverhead {
  /** Net USD value retained after the haircut. */
  usd: number;
  /** Collateral committed to servicing debt (debt * (1 + wiggleroom)), clamped to collateral_usd. */
  committed_capital_usd: number;
  /** Percentage buffer applied to debt before subtracting from collateral. */
  wiggleroom_pct: number;
}

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
  /** Net USDm the reserve would retain after closing the trove. */
  overhead: CdpTroveOverhead;
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

/** Map status enum from contract to string */
function mapTroveStatus(statusCode: number): CdpTrovePosition['status'] {
  switch (statusCode) {
    case 1:
      return 'active';
    case 4:
      return 'zombie';
    case 2:
      return 'closedByOwner';
    case 3:
      return 'closedByLiquidation';
    default:
      return 'closedByOwner';
  }
}

/** Resolved on-chain addresses for a single CDP instance */
interface ResolvedCdpAddresses {
  troveManager: string;
  troveNFT: string;
}

@Injectable()
export class CdpTroveReader {
  private readonly logger = new Logger(CdpTroveReader.name);

  /** Cache of resolved addresses per stablecoin symbol */
  private resolvedAddresses = new Map<string, ResolvedCdpAddresses>();

  constructor(
    private readonly multicallBatchService: MulticallBatchService,
    private readonly exchangeRatesService: ExchangeRatesService,
  ) {}

  /**
   * Enumerate troves from all CDP instances, filter to reserve-owned ones,
   * and read per-trove data.
   */
  async readPositions(): Promise<CdpTrovePosition[]> {
    const activeConfigs = CDP_TROVE_CONFIGS.filter((c) => c.status === 'active');
    const allPositions: CdpTrovePosition[] = [];

    for (const config of activeConfigs) {
      try {
        const positions = await this.readPositionsForConfig(config);
        allPositions.push(...positions);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to read CDP troves for ${config.stablecoin}: ${msg}`);
      }
    }

    this.logger.log(`CDP trove positions: ${allPositions.length} reserve-owned troves across ${activeConfigs.length} CDPs`);
    return allPositions;
  }

  /**
   * Resolve TroveManager and TroveNFT addresses from the on-chain registry.
   * Cached after first resolution.
   */
  private async resolveAddresses(stablecoin: string, chain: Chain): Promise<ResolvedCdpAddresses> {
    const cached = this.resolvedAddresses.get(stablecoin);
    if (cached) return cached;

    const registryAddress = CDP_REGISTRIES[stablecoin];
    if (!registryAddress) {
      throw new Error(`No CDP registry configured for ${stablecoin}`);
    }

    const results = await this.multicallBatchService.batchRead<string>(chain, [
      { address: registryAddress, abi: [...ADDRESSES_REGISTRY_ABI], functionName: 'troveManager' },
      { address: registryAddress, abi: [...ADDRESSES_REGISTRY_ABI], functionName: 'troveNFT' },
    ]);

    const [troveManager, troveNFT] = results;
    if (!troveManager || !troveNFT) {
      throw new Error(`Failed to resolve addresses from registry ${registryAddress} for ${stablecoin}`);
    }

    const resolved = { troveManager, troveNFT };
    this.resolvedAddresses.set(stablecoin, resolved);
    this.logger.log(`Resolved ${stablecoin} CDP: TroveManager=${troveManager}, TroveNFT=${troveNFT}`);
    return resolved;
  }

  /**
   * Read trove positions for a single CDP config.
   */
  private async readPositionsForConfig(config: CdpTroveConfig): Promise<CdpTrovePosition[]> {
    const chain = config.chain;
    const { troveManager, troveNFT } = await this.resolveAddresses(config.stablecoin, chain);

    // Step 1: Get trove count
    const [countResult] = await this.multicallBatchService.batchRead<bigint>(chain, [
      {
        address: troveManager,
        abi: TROVE_MANAGER_ABI,
        functionName: 'getTroveIdsCount',
      },
    ]);

    if (countResult == null) {
      throw new Error(`Missing trove count from TroveManager for ${config.stablecoin}`);
    }

    if (countResult === 0n) {
      this.logger.log(`No troves found for ${config.stablecoin}`);
      return [];
    }

    const troveCount = Number(countResult);
    this.logger.log(`Found ${troveCount} troves for ${config.stablecoin}`);

    // Step 2: Get all trove IDs
    const idCalls = Array.from({ length: troveCount }, (_, i) => ({
      address: troveManager,
      abi: [...TROVE_MANAGER_ABI],
      functionName: 'getTroveFromTroveIdsArray',
      args: [BigInt(i)],
    }));

    const troveIds = await this.multicallBatchService.batchRead<bigint>(chain, idCalls);
    if (troveIds.some((id) => id == null)) {
      throw new Error(`Missing trove ID while enumerating ${config.stablecoin} TroveManager`);
    }

    // Step 3: Check ownership via TroveNFT.ownerOf for each trove
    const validTroveIds = troveIds.filter((id): id is bigint => id != null);
    const ownerCalls = validTroveIds.map((troveId) => ({
      address: troveNFT,
      abi: [...TROVE_NFT_ABI],
      functionName: 'ownerOf',
      args: [troveId],
    }));

    const owners = await this.multicallBatchService.batchRead<string>(chain, ownerCalls);
    if (owners.some((owner) => owner == null)) {
      throw new Error(`Missing trove owner while scanning ${config.stablecoin} TroveNFT`);
    }

    // Step 4: Filter to reserve-owned troves
    const reserveAddressSet = new Set(RESERVE_ADDRESSES.map((a) => a.address.toLowerCase()));

    const reserveTroves: { troveId: bigint; owner: string }[] = [];
    for (let i = 0; i < validTroveIds.length; i++) {
      const owner = owners[i];
      if (owner && reserveAddressSet.has(owner.toLowerCase())) {
        reserveTroves.push({ troveId: validTroveIds[i], owner });
      }
    }

    if (reserveTroves.length === 0) {
      this.logger.log(`No reserve-owned troves found for ${config.stablecoin}`);
      return [];
    }

    this.logger.log(`Found ${reserveTroves.length} reserve-owned ${config.stablecoin} troves`);

    // Step 5: Read per-trove data (getLatestTroveData + getTroveStatus) in one batch
    const dataCalls = reserveTroves.flatMap((t) => [
      {
        address: troveManager,
        abi: [...TROVE_MANAGER_ABI],
        functionName: 'getLatestTroveData',
        args: [t.troveId],
      },
      {
        address: troveManager,
        abi: [...TROVE_MANAGER_ABI],
        functionName: 'getTroveStatus',
        args: [t.troveId],
      },
    ]);

    const dataResults = await this.multicallBatchService.batchRead(chain, dataCalls);

    // Step 6: Build positions
    const fiatTicker = getFiatTickerFromSymbol(config.stablecoin);
    const positions: CdpTrovePosition[] = [];
    for (let i = 0; i < reserveTroves.length; i++) {
      const { troveId, owner } = reserveTroves[i];
      const troveData = dataResults[i * 2] as any;
      const statusCode = dataResults[i * 2 + 1] as number | null;

      if (!troveData || statusCode == null) {
        throw new Error(`Missing trove payload for ${config.stablecoin} trove ${troveId}`);
      }

      const entireDebt = troveData.entireDebt ?? troveData[0];
      const entireColl = troveData.entireColl ?? troveData[1];
      const annualInterestRate = troveData.annualInterestRate ?? troveData[6];

      const debtAmount = Number(formatUnits(BigInt(entireDebt), 18));
      const collAmount = Number(formatUnits(BigInt(entireColl), 18));
      const interestRate = Number(formatUnits(BigInt(annualInterestRate), 18));

      // USDm collateral is valued 1:1 with USD; debt needs fiat->USD conversion
      const collateralUsd = await this.exchangeRatesService.convert(collAmount, 'USD', 'USD');
      const debtUsd = await this.exchangeRatesService.convert(debtAmount, fiatTicker, 'USD');
      const ratio = debtUsd > 0 ? collateralUsd / debtUsd : 0;
      const committedCapitalUsd = Math.min(collateralUsd, debtUsd * (1 + CDP_WIGGLEROOM_PCT / 100));
      const overheadUsd = Math.max(0, collateralUsd - committedCapitalUsd);

      positions.push({
        trove_id: troveId.toString(),
        owner,
        owner_label: getReserveAddressLabel(owner) ?? owner.slice(0, 10),
        chain,
        status: mapTroveStatus(statusCode),
        collateral_token: config.collateralToken,
        collateral_amount: collAmount.toString(),
        collateral_usd: collateralUsd,
        debt_token: config.stablecoin,
        debt_amount: debtAmount.toString(),
        debt_usd: debtUsd,
        ratio,
        annual_interest_rate: interestRate,
        contract_address: troveManager,
        overhead: { usd: overheadUsd, committed_capital_usd: committedCapitalUsd, wiggleroom_pct: CDP_WIGGLEROOM_PCT },
      });
    }

    return positions;
  }
}
