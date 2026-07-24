import { describe, it, expect, vi } from 'vitest';
import { WalletBalanceReader } from './wallet-balance.reader';
import { Chain } from '@types';

/**
 * Regression test for the incident where a transient multicall failure silently
 * dropped a large reserve balance (AUSD on Ethereum) from the response. The reader
 * must now fall back to the last-known-good value instead of skipping the asset.
 */
describe('WalletBalanceReader — last-known-good fallback', () => {
  const AUSD = '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a';

  const makeReader = (opts: {
    batchRead: (chain: Chain, calls: unknown[]) => Promise<unknown[]>;
    getLastGoodBalance: (chain: Chain, token: string, holder: string) => Promise<string | null>;
    executeRateLimited?: () => Promise<bigint>;
  }) => {
    const multicall = { batchRead: vi.fn(opts.batchRead) };
    const mento = {
      getInitializedChains: () => [Chain.CELO],
      getMentoInstanceForChain: () => ({
        tokens: {
          getStableTokens: async () => [
            { address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', symbol: 'cUSD', decimals: 18 },
          ],
        },
      }),
    };
    const primitive = {
      getBalance: vi.fn().mockResolvedValue(null),
      setBalance: vi.fn().mockResolvedValue(undefined),
      getLastGoodBalance: vi.fn(opts.getLastGoodBalance),
      setStablecoinAddresses: vi.fn().mockResolvedValue(undefined),
    };
    const chainClient = {
      executeRateLimited: vi.fn(opts.executeRateLimited ?? (() => Promise.reject(new Error('rpc down')))),
    };
    const reader = new WalletBalanceReader(multicall as any, mento as any, primitive as any, chainClient as any);
    return { reader, multicall, primitive };
  };

  it('serves the last-known-good balance when the fresh read returns null (asset not dropped)', async () => {
    const { reader } = makeReader({
      // Every fresh ERC-20 read fails (simulates the transient multicall outage).
      batchRead: async (_chain, calls) => calls.map(() => null),
      // Only AUSD has a cached last-known-good value.
      getLastGoodBalance: async (_chain, token) =>
        token.toLowerCase() === AUSD.toLowerCase() ? '4393453000000' : null,
    });

    const warnings: { source: string; message: string }[] = [];
    const positions = await reader.readPositions(Chain.ETHEREUM, warnings as any);

    const ausd = positions.find((p) => p.token_address?.toLowerCase() === AUSD.toLowerCase());
    expect(ausd, 'AUSD must survive a failed fresh read via last-known-good').toBeDefined();
    expect(ausd!.balance).toBe('4393453'); // 4393453000000 / 1e6
    // Staleness is surfaced so the payload self-declares degraded data.
    expect(warnings.some((w) => w.message.includes('last-known-good'))).toBe(true);
  });

  it('drops nothing and adds no warning when fresh reads succeed', async () => {
    const { reader } = makeReader({
      // Fresh read returns a value for AUSD, null for everything else.
      batchRead: async (_chain, calls) =>
        calls.map((c: any) => (String(c.address).toLowerCase() === AUSD.toLowerCase() ? 1_000_000n : null)),
      getLastGoodBalance: async () => null,
    });

    const warnings: { source: string; message: string }[] = [];
    const positions = await reader.readPositions(Chain.ETHEREUM, warnings as any);

    const ausd = positions.find((p) => p.token_address?.toLowerCase() === AUSD.toLowerCase());
    expect(ausd!.balance).toBe('1'); // 1_000_000 / 1e6
    expect(warnings.length).toBe(0);
  });
});
