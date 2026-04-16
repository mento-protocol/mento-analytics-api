import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '@common/services/mento.service';
import { MulticallBatchService } from '../multicall-batch.service';
import { getReserveAddressesByChain } from '../../config/reserve-addresses.config';
import { AAVE_TOKEN_MAPPINGS } from '@common/config/aave.config';
import { ASSETS_CONFIGS } from '@api/reserve/config/assets.config';
import { Chain } from '@types';
import { formatUnits } from 'viem';

export interface AavePosition {
  address: string;
  label: string;
  chain: Chain;
  token: string;
  a_token_address: string;
  balance: string;
  usd_value: number;
  is_mento_stable: boolean;
}

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

@Injectable()
export class AaveReader {
  private readonly logger = new Logger(AaveReader.name);
  /** address (lowercase) → symbol for every Mento stable. Used as fallback when underlying token isn't in ASSETS_CONFIGS. */
  private stablecoinMap: Map<string, string> | null = null;

  constructor(
    private readonly multicallBatchService: MulticallBatchService,
    private readonly mentoService: MentoService,
  ) {}

  /**
   * Read aToken balances for all reserve addresses on a given chain.
   * Uses AAVE_TOKEN_MAPPINGS to find the aToken for each underlying token.
   */
  async readPositions(chain: Chain): Promise<AavePosition[]> {
    const tokenMappings = AAVE_TOKEN_MAPPINGS[chain];
    if (!tokenMappings) return [];

    const addresses = getReserveAddressesByChain(chain);
    if (addresses.length === 0) return [];

    const stableMap = await this.getStablecoinMap();
    const chainAssets = ASSETS_CONFIGS[chain] ?? {};

    // Build (underlyingAddress, aTokenAddress, symbol, decimals) tuples.
    // Resolution order: ASSETS_CONFIGS → Mento stable map (cUSD, cEUR, ...) → UNKNOWN
    const aaveTokens = Object.entries(tokenMappings).map(([underlying, aToken]) => {
      const lower = underlying.toLowerCase();
      const assetConfig = Object.values(chainAssets).find((a) => a.address?.toLowerCase() === lower);
      const mentoSymbol = stableMap.get(lower);
      return {
        underlyingAddress: underlying,
        aTokenAddress: aToken,
        symbol: assetConfig?.symbol ?? mentoSymbol ?? 'UNKNOWN',
        decimals: assetConfig?.decimals ?? 18, // Mento stables are always 18 decimals
      };
    });

    // Build multicall: for each (reserveAddress, aToken) pair, one balanceOf
    const calls = addresses.flatMap((addr) =>
      aaveTokens.map((token) => ({
        address: token.aTokenAddress,
        abi: [...ERC20_BALANCE_ABI],
        functionName: 'balanceOf',
        args: [addr.address],
      })),
    );

    const results = await this.multicallBatchService.batchRead<bigint>(chain, calls);

    const positions: AavePosition[] = [];
    let callIdx = 0;
    for (const addr of addresses) {
      for (const token of aaveTokens) {
        const raw = results[callIdx++];
        if (raw == null || raw === 0n) continue;

        const balance = formatUnits(raw, token.decimals);
        const isMentoStable = stableMap.has(token.underlyingAddress.toLowerCase());

        positions.push({
          address: addr.address,
          label: addr.label,
          chain,
          token: token.symbol,
          a_token_address: token.aTokenAddress,
          balance,
          usd_value: 0, // enriched later by orchestrator
          is_mento_stable: isMentoStable,
        });
      }
    }

    this.logger.log(`AAVE positions on ${chain}: ${positions.length} non-zero positions`);
    return positions;
  }

  private async getStablecoinMap(): Promise<Map<string, string>> {
    if (this.stablecoinMap) return this.stablecoinMap;

    const map = new Map<string, string>();
    try {
      const mento = this.mentoService.getMentoInstance();
      const tokens = await mento.tokens.getStableTokens();
      for (const t of tokens) {
        map.set(t.address.toLowerCase(), t.symbol);
      }
    } catch (error) {
      this.logger.warn(`Failed to load stablecoin addresses from SDK: ${error}`);
    }
    this.stablecoinMap = map;
    return map;
  }
}
