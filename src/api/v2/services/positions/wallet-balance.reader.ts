import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '@common/services/mento.service';
import { MulticallBatchService } from '../multicall-batch.service';
import { PrimitiveCacheService } from '../primitive-cache.service';
import { getReserveAddressesByChain } from '../../config/reserve-addresses.config';
import { ASSETS_CONFIGS } from '@api/reserve/config/assets.config';
import { Chain } from '@types';
import { formatUnits } from 'viem';

export interface WalletBalancePosition {
  address: string;
  label: string;
  chain: Chain;
  token: string;
  token_address: string | null;
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
export class WalletBalanceReader {
  private readonly logger = new Logger(WalletBalanceReader.name);
  private stablecoinAddresses: Set<string> | null = null;

  constructor(
    private readonly multicallBatchService: MulticallBatchService,
    private readonly mentoService: MentoService,
    private readonly primitiveCacheService: PrimitiveCacheService,
  ) {}

  async readPositions(chain: Chain): Promise<WalletBalancePosition[]> {
    const addresses = getReserveAddressesByChain(chain);
    const chainAssets = ASSETS_CONFIGS[chain];
    if (!chainAssets || addresses.length === 0) return [];

    const stableSet = await this.getStablecoinAddressSet();
    const tokens = Object.values(chainAssets).filter((a) => a.address);
    if (tokens.length === 0) return [];

    // Check primitive cache first — collect what's cached vs what needs RPC
    const callPlan: { addrIdx: number; tokenIdx: number; cached: string | null }[] = [];
    for (let ai = 0; ai < addresses.length; ai++) {
      for (let ti = 0; ti < tokens.length; ti++) {
        const cached = await this.primitiveCacheService.getBalance(chain, tokens[ti].address!, addresses[ai].address);
        callPlan.push({ addrIdx: ai, tokenIdx: ti, cached });
      }
    }

    const uncachedIndices = callPlan.map((p, i) => (p.cached === null ? i : -1)).filter((i) => i >= 0);

    // Build multicall only for uncached entries
    let rpcResults: (bigint | null)[] = [];
    if (uncachedIndices.length > 0) {
      const calls = uncachedIndices.map((i) => ({
        address: tokens[callPlan[i].tokenIdx].address!,
        abi: [...ERC20_BALANCE_ABI],
        functionName: 'balanceOf',
        args: [addresses[callPlan[i].addrIdx].address],
      }));
      rpcResults = await this.multicallBatchService.batchRead<bigint>(chain, calls);
    }

    // Merge cached + fresh results
    const positions: WalletBalancePosition[] = [];
    let rpcIdx = 0;
    for (let i = 0; i < callPlan.length; i++) {
      const { addrIdx, tokenIdx, cached } = callPlan[i];
      const addr = addresses[addrIdx];
      const token = tokens[tokenIdx];

      let rawStr: string;
      if (cached !== null) {
        rawStr = cached;
      } else {
        const raw = rpcResults[rpcIdx++];
        if (raw == null) continue;
        rawStr = raw.toString();
        // Write to primitive cache
        await this.primitiveCacheService.setBalance(chain, token.address!, addr.address, rawStr);
      }

      if (rawStr === '0') continue;

      const balance = formatUnits(BigInt(rawStr), token.decimals);
      const isMentoStable = stableSet.has(token.address!.toLowerCase());

      positions.push({
        address: addr.address,
        label: addr.label,
        chain,
        token: token.symbol,
        token_address: token.address ?? null,
        balance,
        usd_value: 0,
        is_mento_stable: isMentoStable,
      });
    }

    const cachedCount = callPlan.filter((p) => p.cached !== null).length;
    this.logger.log(
      `Wallet balances on ${chain}: ${positions.length} non-zero (${cachedCount} cached, ${uncachedIndices.length} RPC)`,
    );
    return positions;
  }

  private async getStablecoinAddressSet(): Promise<Set<string>> {
    // Check primitive cache first
    const cached = await this.primitiveCacheService.getStablecoinAddresses();
    if (cached) return cached;

    if (this.stablecoinAddresses) return this.stablecoinAddresses;

    const set = new Set<string>();
    try {
      const mento = this.mentoService.getMentoInstance();
      const tokens = await mento.tokens.getStableTokens();
      for (const t of tokens) {
        set.add(t.address.toLowerCase());
      }
      await this.primitiveCacheService.setStablecoinAddresses(set);
    } catch (error) {
      this.logger.warn(`Failed to load stablecoin addresses from SDK: ${error}`);
    }
    this.stablecoinAddresses = set;
    return set;
  }
}
