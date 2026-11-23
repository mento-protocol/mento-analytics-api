import { describe, expect, it, vi } from 'vitest';
import { Chain } from '@types';
import { ASSETS_CONFIGS } from '@api/reserve/config/assets.config';
import { RESERVE_ADDRESS_CONFIGS } from '@api/reserve/config/addresses.config';
import { ReserveBalanceService } from '@api/reserve/services/reserve-balance.service';
import { ReserveValueService } from '@api/reserve/services/reserve-value.service';
import { CeloBalanceFetcher } from '@api/reserve/services/balance-fetchers/celo.balance-fetcher';
import { EthereumBalanceFetcher } from '@api/reserve/services/balance-fetchers/ethereum.balance-fetcher';
import { WalletBalanceReader } from './positions/wallet-balance.reader';
import { V2PositionsService } from './v2-positions.service';
import { V2ReserveService } from './v2-reserve.service';

const PRICE_ID = 'ethereum:0xcf62f905562626cfcdd2261162a51fd02fc9c5b6';
const PRICE = 1.2223;

function prices() {
  const cmc = { getPrice: vi.fn().mockRejectedValue(new Error('sfrxUSD must use DeFiLlama')) };
  const llama = {
    getPrice: vi.fn(async (id: string) => {
      if (id !== PRICE_ID) throw new Error(`No price for ${id}`);
      return PRICE;
    }),
  };
  return { cmc, llama };
}

describe('sfrxUSD share valuation', () => {
  it.each([Chain.CELO, Chain.ETHEREUM])('v1 prices %s shares using the Ethereum price ID', async (chain) => {
    const { cmc, llama } = prices();
    const service = new ReserveValueService(cmc as any, llama as any);
    const config = ASSETS_CONFIGS[chain].sfrxUSD!;
    expect(await service.calculateUsdValue(config, '2000000000000000000', chain)).toBeCloseTo(2 * PRICE);
    expect(await service.calculateUsdValue(config, '0', chain)).toBe(0);
    expect(llama.getPrice).toHaveBeenCalledWith(PRICE_ID);
    expect(cmc.getPrice).not.toHaveBeenCalled();
  });

  it('keeps the chain/address price ID default for assets without an override', async () => {
    const llama = { getPrice: vi.fn().mockResolvedValue(1.1) };
    const service = new ReserveValueService({} as any, llama as any);
    const config = ASSETS_CONFIGS[Chain.ETHEREUM].sUSDS!;
    expect(await service.calculateUsdValue(config, '1000000000000000000', Chain.ETHEREUM)).toBe(1.1);
    expect(llama.getPrice).toHaveBeenCalledWith(`ethereum:${config.address}`);
  });

  it.each([0n, 2n * 10n ** 18n])(
    'v1 reads raw share balances (%s) without applying the vault rate twice',
    async (raw) => {
      const { cmc, llama } = prices();
      const readContract = vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
        if (functionName === 'balanceOf') return raw;
        // Underlying frxUSD differs from the number of shares and must not be used for valuation.
        if (address === ASSETS_CONFIGS[Chain.ETHEREUM].sfrxUSD!.address && functionName === 'maxWithdraw') {
          return (raw * 12223n) / 10000n;
        }
        throw new Error('Celo OFT does not implement vault methods');
      });
      const client = { executeRateLimited: async (_chain: Chain, fn: any) => fn({ readContract }) };
      const service = new ReserveBalanceService(new ReserveValueService(cmc as any, llama as any), [
        new CeloBalanceFetcher(client as any, {} as any, {} as any),
        new EthereumBalanceFetcher(client as any),
      ]);
      const balances = await Promise.all(
        RESERVE_ADDRESS_CONFIGS.filter((c) => c.assets.includes('sfrxUSD')).map((config) =>
          service.fetchBalancesByConfig({ ...config, assets: ['sfrxUSD'] }),
        ),
      );
      expect(balances.flat()).toHaveLength(4);
      for (const balance of balances.flat()) {
        expect(balance.balance).toBe(raw === 0n ? '0' : '2');
        expect(balance.usdValue).toBeCloseTo(raw === 0n ? 0 : 2 * PRICE);
      }
    },
  );

  it.each([0n, 2n * 10n ** 18n])('v2 reads exactly four holders and values shares (%s) once per chain', async (raw) => {
    const { cmc, llama } = prices();
    const calls: { chain: Chain; token: string; holder: string; method: string }[] = [];
    const primitive = {
      getBalance: vi.fn().mockResolvedValue(null),
      setBalance: vi.fn().mockResolvedValue(undefined),
      setStablecoinAddresses: vi.fn().mockResolvedValue(undefined),
      setReaderSnapshot: vi.fn().mockResolvedValue(undefined),
    };
    const multicall = {
      batchRead: async (chain: Chain, batch: any[]) =>
        batch.map((call) => {
          const config = ASSETS_CONFIGS[chain].sfrxUSD;
          if (call.address !== config?.address) return 0n;
          calls.push({ chain, token: call.address, holder: call.args[0], method: call.functionName });
          return raw;
        }),
    };
    const mento = {
      getInitializedChains: () => [Chain.CELO],
      getMentoInstanceForChain: () => ({
        tokens: {
          getStableTokens: async () => [
            { address: '0x765DE816845861e75A25fCA122bb6898B8B1282a', symbol: 'USDm', decimals: 18 },
          ],
        },
      }),
    };
    const reader = new WalletBalanceReader(
      multicall as any,
      mento as any,
      primitive as any,
      {
        executeRateLimited: async () => 0n,
      } as any,
    );
    const emptyReader = { readPositions: async () => [] };
    const service = new V2PositionsService(
      reader,
      emptyReader as any,
      emptyReader as any,
      emptyReader as any,
      emptyReader as any,
      { getPositions: async () => [] } as any,
      {} as any,
      cmc as any,
      llama as any,
      primitive as any,
    );
    const response = await new V2ReserveService(service).getReserve();
    const expectedPairs = [
      'celo:0x87647780180b8f55980c7d3ffefe08a9b29e9ae1',
      'celo:0xd3d2e5c5af667da817b2d752d86c8f40c22137e1',
      'ethereum:0xd0697f70e79476195b742d5afab14be50f98cc1e',
      'ethereum:0xd3d2e5c5af667da817b2d752d86c8f40c22137e1',
    ].sort();
    expect(calls.map((c) => `${c.chain}:${c.holder.toLowerCase()}`).sort()).toEqual(expectedPairs);
    expect(calls.every((c) => c.method === 'balanceOf')).toBe(true);
    const wallets = response.positions.wallet_balances.filter((p) => p.token === 'sfrxUSD');
    expect(wallets.map((p) => `${p.chain}:${p.address.toLowerCase()}`).sort()).toEqual(expectedPairs);
    for (const wallet of wallets) {
      expect(wallet.balance).toBe(raw === 0n ? '0' : '2');
      expect(wallet.usd_value).toBeCloseTo(raw === 0n ? 0 : 2 * PRICE);
      expect(wallet.is_mento_stable).toBe(false);
    }
    expect(response.collateral.assets.filter((a) => a.symbol === 'sfrxUSD')).toHaveLength(2);
    expect(response.collateral.total_usd).toBeCloseTo(raw === 0n ? 0 : 8 * PRICE);
    expect(response.reserve_held_supply.total_usd).toBe(0);
    expect(response.meta?.warnings ?? []).toEqual([]);
    expect(cmc.getPrice).not.toHaveBeenCalled();
    if (raw !== 0n) {
      expect(llama.getPrice).toHaveBeenCalledExactlyOnceWith(PRICE_ID);
    } else {
      expect(llama.getPrice).not.toHaveBeenCalled();
    }
  });
});
