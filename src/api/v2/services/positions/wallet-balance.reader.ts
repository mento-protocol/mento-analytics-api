import { Injectable, Logger } from '@nestjs/common';
import { MentoService } from '@common/services/mento.service';
import { MulticallBatchService } from '../multicall-batch.service';
import { RESERVE_ADDRESSES, getReserveAddressesByChain } from '../../config/reserve-addresses.config';
import { ASSETS_CONFIGS } from '@api/reserve/config/assets.config';
import { Chain, AssetSymbol } from '@types';
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
  /** Cache of stablecoin addresses (lowercase) for is_mento_stable classification */
  private stablecoinAddresses: Set<string> | null = null;

  constructor(
    private readonly multicallBatchService: MulticallBatchService,
    private readonly mentoService: MentoService,
  ) {}

  /**
   * Read ERC20 balances at all reserve addresses for configured assets on a given chain.
   * Tags each position with is_mento_stable by checking against Mento SDK's stablecoin list.
   */
  async readPositions(chain: Chain): Promise<WalletBalancePosition[]> {
    const addresses = getReserveAddressesByChain(chain);
    const chainAssets = ASSETS_CONFIGS[chain];
    if (!chainAssets || addresses.length === 0) return [];

    const stableSet = await this.getStablecoinAddressSet();

    // Build list of tokens that have on-chain addresses (skip native tokens like ETH, BTC)
    const tokens = Object.values(chainAssets).filter((a) => a.address);

    if (tokens.length === 0) return [];

    // Build multicall: for each (address, token) pair, one balanceOf call
    const calls = addresses.flatMap((addr) =>
      tokens.map((token) => ({
        address: token.address!,
        abi: [...ERC20_BALANCE_ABI],
        functionName: 'balanceOf',
        args: [addr.address],
      })),
    );

    const results = await this.multicallBatchService.batchRead<bigint>(chain, calls);

    const positions: WalletBalancePosition[] = [];
    let callIdx = 0;
    for (const addr of addresses) {
      for (const token of tokens) {
        const raw = results[callIdx++];
        if (raw == null || raw === 0n) continue;

        const balance = formatUnits(raw, token.decimals);
        const isMentoStable = stableSet.has(token.address!.toLowerCase());

        positions.push({
          address: addr.address,
          label: addr.label,
          chain,
          token: token.symbol,
          token_address: token.address ?? null,
          balance,
          usd_value: 0, // enriched later by orchestrator
          is_mento_stable: isMentoStable,
        });
      }
    }

    this.logger.log(`Wallet balances on ${chain}: ${positions.length} non-zero positions`);
    return positions;
  }

  /**
   * Build set of stablecoin addresses from Mento SDK. Cached after first call.
   */
  private async getStablecoinAddressSet(): Promise<Set<string>> {
    if (this.stablecoinAddresses) return this.stablecoinAddresses;

    const set = new Set<string>();
    try {
      const mento = this.mentoService.getMentoInstance();
      const tokens = await mento.tokens.getStableTokens();
      for (const t of tokens) {
        set.add(t.address.toLowerCase());
      }
    } catch (error) {
      this.logger.warn(`Failed to load stablecoin addresses from SDK: ${error}`);
    }
    this.stablecoinAddresses = set;
    return set;
  }
}
