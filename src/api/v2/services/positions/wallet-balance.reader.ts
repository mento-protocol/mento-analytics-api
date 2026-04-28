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

type TokenSpec = { symbol: string; address: string; decimals: number };

@Injectable()
export class WalletBalanceReader {
  private readonly logger = new Logger(WalletBalanceReader.name);
  /** Mento stable address (lowercase) → { symbol, decimals }. Canonical Celo deployment. */
  private mentoStableMap: Map<string, { symbol: string; decimals: number }> | null = null;

  constructor(
    private readonly multicallBatchService: MulticallBatchService,
    private readonly mentoService: MentoService,
    private readonly primitiveCacheService: PrimitiveCacheService,
  ) {}

  async readPositions(chain: Chain): Promise<WalletBalancePosition[]> {
    const addresses = getReserveAddressesByChain(chain);
    if (addresses.length === 0) return [];

    const stableMap = await this.getMentoStableMap();

    // Build the token list. Collateral assets come from ASSETS_CONFIGS. On Celo,
    // also fetch every Mento stable (USDm, EURm, GBPm, ...) so balances in reserve
    // wallets — including small ancillary accounts like the Rebalancer Bot — are
    // captured. Monad already lists USDm/GBPm in ASSETS_CONFIGS under their native
    // addresses, so no extra merge is needed there.
    const chainAssets = ASSETS_CONFIGS[chain] ?? {};
    const tokens: TokenSpec[] = [];
    const seen = new Set<string>();
    for (const a of Object.values(chainAssets)) {
      if (!a.address) continue;
      const lower = a.address.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      tokens.push({ symbol: a.symbol, address: a.address, decimals: a.decimals });
    }
    if (chain === Chain.CELO) {
      for (const [addr, info] of stableMap) {
        if (seen.has(addr)) continue;
        seen.add(addr);
        tokens.push({ symbol: info.symbol, address: addr, decimals: info.decimals });
      }
    }
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
        if (raw == null) {
          this.logger.warn(`Multicall returned null for ${token.symbol} at ${addr.label} on ${chain}, skipping`);
          continue;
        }
        rawStr = raw.toString();
        // Write to primitive cache
        await this.primitiveCacheService.setBalance(chain, token.address!, addr.address, rawStr);
      }

      if (rawStr === '0') continue;

      const balance = formatUnits(BigInt(rawStr), token.decimals);
      // Mento stable by address (Celo canonical deployment) OR by symbol pattern
      // (covers Monad USDm/GBPm which have distinct addresses from Celo).
      const isMentoStable = stableMap.has(token.address.toLowerCase()) || /^[A-Z]{3}m$/.test(token.symbol);

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

  private async getMentoStableMap(): Promise<Map<string, { symbol: string; decimals: number }>> {
    if (this.mentoStableMap) return this.mentoStableMap;

    const map = new Map<string, { symbol: string; decimals: number }>();
    for (const chain of this.mentoService.getInitializedChains()) {
      try {
        const mento = this.mentoService.getMentoInstanceForChain(chain);
        const tokens = await mento.tokens.getStableTokens();
        for (const t of tokens) {
          map.set(t.address.toLowerCase(), { symbol: t.symbol, decimals: t.decimals });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to load stablecoin addresses for ${chain}: ${msg}`);
      }
    }

    if (map.size === 0) {
      throw new Error('Failed to load stablecoin addresses from SDK on any chain');
    }

    // Keep the legacy address-only cache in sync for other readers still using it.
    await this.primitiveCacheService.setStablecoinAddresses(new Set(map.keys()));
    this.mentoStableMap = map;
    return map;
  }
}
