import { Injectable, Logger } from '@nestjs/common';
import { StablecoinAdjustmentsService } from '@api/stablecoins/services/stablecoin-adjustments.service';
import { MentoService } from '@common/services/mento.service';
import { ExchangeRatesService } from '@common/services/exchange-rates.service';
import { ChainClientService } from '@common/services/chain-client.service';
import { V2StablecoinsResponseDto, V2StablecoinDto, V2NetworkSupplyDto } from '../dto/v2-stablecoins.dto';
import { getBackingConfig } from '../config/stablecoin-backing.config';
import { FpmmPositionsService } from './fpmm-positions.service';
import { formatUnits, parseAbi } from 'viem';
import { getFiatTickerFromSymbol } from '@common/constants';
import { ERC20_ABI } from '@/common/constants';
import { withRetry } from '@/utils';
import { ICONS_BASE_URL } from '@api/stablecoins/constants';
import { Chain } from '@types';

@Injectable()
export class V2StablecoinsService {
  private readonly logger = new Logger(V2StablecoinsService.name);

  constructor(
    private readonly adjustmentsService: StablecoinAdjustmentsService,
    private readonly mentoService: MentoService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly chainClientService: ChainClientService,
    private readonly fpmmPositionsService: FpmmPositionsService,
  ) {}

  async getStablecoins(): Promise<V2StablecoinsResponseDto> {
    const result = await withRetry(
      async () => {
        const mento = this.mentoService.getMentoInstance();
        const tokens = await mento.tokens.getStableTokens();

        const stablecoinTokens = tokens.map((t) => ({
          symbol: t.symbol,
          address: t.address,
          decimals: t.decimals,
        }));

        // Calculate all three adjustment categories separately
        const reserveByToken: Record<string, { amount: number; usdValue: number }> = {};
        const aaveByToken: Record<string, { amount: number; usdValue: number }> = {};
        const lostByToken: Record<string, { amount: number; usdValue: number }> = {};
        for (const token of stablecoinTokens) {
          reserveByToken[token.symbol] = { amount: 0, usdValue: 0 };
          aaveByToken[token.symbol] = { amount: 0, usdValue: 0 };
          lostByToken[token.symbol] = { amount: 0, usdValue: 0 };
        }

        // Fetch wallet adjustments AND FPMM positions in parallel
        const [reserveTotal, aaveTotal, lostTotal, fpmmPositions] = await Promise.all([
          this.adjustmentsService.calculateReserveHoldings(stablecoinTokens, reserveByToken),
          this.adjustmentsService.calculateAavePositions(stablecoinTokens, aaveByToken),
          this.adjustmentsService.calculateLostTokens(stablecoinTokens, lostByToken),
          this.getFpmmReserveHeldBySymbol(),
        ]);

        const stablecoins: V2StablecoinDto[] = await Promise.all(
          tokens.map(async (token) => {
            const fiatTicker = getFiatTickerFromSymbol(token.symbol);
            const celoSupply = Number(formatUnits(BigInt(token.totalSupply), token.decimals));
            const backingConfig = getBackingConfig(token.symbol);

            // Per-token Celo adjustments
            const walletHeld = reserveByToken[token.symbol]?.amount ?? 0;
            const aaveHeld = aaveByToken[token.symbol]?.amount ?? 0;
            const fpmmHeld = fpmmPositions[token.symbol] ?? 0;
            const celoReserveHeld = walletHeld + aaveHeld + fpmmHeld;
            const celoLost = lostByToken[token.symbol]?.amount ?? 0;

            // Query supply on non-Celo chains + build per-network breakdown
            // Handles lockbox vs burn-and-mint: lockbox deduction subtracted from Celo supply
            const { networkSupplies, lockboxDeduction } = await this.getNetworkSupplies(
              token.symbol, token.address, token.decimals, celoSupply,
              celoReserveHeld, celoLost, fiatTicker, backingConfig,
            );

            // Gross supply = sum of all network supplies (lockbox already deducted from Celo)
            const grossSupply = networkSupplies.reduce((sum, ns) => sum + Number(ns.supply.total), 0);

            // Aggregate decomposition across all chains
            const reserveHeld = celoReserveHeld;
            const lost = celoLost;
            const debt = Math.max(0, grossSupply - reserveHeld - lost);

            const totalUsd = await this.exchangeRatesService.convert(grossSupply, fiatTicker, 'USD');
            const debtUsd = await this.exchangeRatesService.convert(debt, fiatTicker, 'USD');
            const reserveHeldUsd = await this.exchangeRatesService.convert(reserveHeld, fiatTicker, 'USD');
            const lostUsd = lostByToken[token.symbol]?.usdValue ?? 0;

            const iconUrl = `${ICONS_BASE_URL}/${token.symbol}.svg`;

            return {
              symbol: token.symbol,
              name: token.name,
              backing_type: backingConfig.backing,
              fiat_symbol: fiatTicker,
              icon_url: iconUrl,
              networks: backingConfig.networks,
              supply: {
                total: grossSupply.toString(),
                total_usd: Number(totalUsd),
                debt: debt.toString(),
                debt_usd: Number(debtUsd),
                reserve_held: reserveHeld.toString(),
                reserve_held_usd: Number(reserveHeldUsd),
                lost: lost.toString(),
                lost_usd: Number(lostUsd),
              },
              network_supplies: networkSupplies,
              market_cap_percentage: 0,
            } as V2StablecoinDto;
          }),
        );

        const total_supply_usd = stablecoins.reduce((sum, c) => sum + c.supply.total_usd, 0);
        const total_debt_usd = stablecoins.reduce((sum, c) => sum + c.supply.debt_usd, 0);

        for (const coin of stablecoins) {
          coin.market_cap_percentage = total_supply_usd > 0 ? (coin.supply.total_usd / total_supply_usd) * 100 : 0;
        }

        const totalFpmmHeld = Object.values(fpmmPositions).reduce((s, v) => s + v, 0);
        this.logger.log(
          `V2 stablecoins - Total: $${total_supply_usd.toFixed(2)}, Debt: $${total_debt_usd.toFixed(2)}, ` +
            `Wallet held: $${reserveTotal.toFixed(2)}, AAVE: $${aaveTotal.toFixed(2)}, ` +
            `FPMM held: ${totalFpmmHeld.toFixed(2)} tokens, Lost: $${lostTotal.toFixed(2)}`,
        );

        return { total_supply_usd, total_debt_usd, stablecoins };
      },
      'Failed to fetch v2 stablecoins',
      { logger: this.logger, baseDelay: 8000 },
    );

    if (!result) {
      return { total_supply_usd: 0, total_debt_usd: 0, stablecoins: [] };
    }
    return result;
  }

  /**
   * Build per-network supply breakdown for a stablecoin.
   *
   * Bridge types affect how supply is computed:
   * - burn-and-mint: Celo burns tokens when bridging out. Celo totalSupply is already net.
   *   Total = Celo totalSupply + other chain totalSupply.
   * - lockbox: Celo locks tokens in a lockbox contract when bridging out. Celo totalSupply
   *   still includes locked tokens. Celo circulating = totalSupply - lockbox balance.
   *   Total = (Celo totalSupply - lockbox) + other chain totalSupply.
   *
   * Returns { networkSupplies, totalLockboxDeduction } so the caller can adjust the gross total.
   */
  private async getNetworkSupplies(
    symbol: string,
    celoAddress: string,
    celoDecimals: number,
    celoRawSupply: number,
    celoReserveHeld: number,
    celoLost: number,
    fiatTicker: string,
    backingConfig: ReturnType<typeof getBackingConfig>,
  ): Promise<{ networkSupplies: V2NetworkSupplyDto[]; lockboxDeduction: number }> {
    const supplies: V2NetworkSupplyDto[] = [];
    let totalLockboxDeduction = 0;

    // First pass: query other chains and compute lockbox deductions
    const otherChainSupplies: { deployment: (typeof backingConfig.deployments)[number]; supply: number }[] = [];

    if (backingConfig.deployments) {
      await Promise.all(
        backingConfig.deployments.map(async (deployment) => {
          try {
            // Query totalSupply on this chain
            const chainSupply = await this.chainClientService.executeRateLimited(deployment.chain, async (client) => {
              const totalSupply = await client.readContract({
                address: deployment.address as `0x${string}`,
                abi: parseAbi(ERC20_ABI),
                functionName: 'totalSupply',
              });
              return Number(formatUnits(totalSupply as bigint, deployment.decimals));
            });

            otherChainSupplies.push({ deployment, supply: chainSupply });

            // For lockbox bridges: read the lockbox balance on Celo to subtract
            if (deployment.bridge === 'lockbox' && deployment.celoLockboxAddress) {
              const lockboxBalance = await this.chainClientService.executeRateLimited(Chain.CELO, async (client) => {
                const bal = await client.readContract({
                  address: celoAddress as `0x${string}`,
                  abi: parseAbi(ERC20_ABI),
                  functionName: 'balanceOf',
                  args: [deployment.celoLockboxAddress as `0x${string}`],
                });
                return Number(formatUnits(bal as bigint, celoDecimals));
              });
              totalLockboxDeduction += lockboxBalance;
              this.logger.log(`${symbol} lockbox on Celo holds ${lockboxBalance.toFixed(2)} (deducted from Celo supply)`);
            }

            this.logger.log(`${symbol} on ${deployment.chain} [${deployment.bridge}]: ${chainSupply.toFixed(2)}`);
          } catch (error) {
            this.logger.warn(`Failed to fetch ${symbol} on ${deployment.chain}: ${error}`);
            otherChainSupplies.push({ deployment, supply: 0 });
          }
        }),
      );
    }

    // Celo supply: subtract lockbox balance for lockbox bridges
    const celoCorrectedSupply = celoRawSupply - totalLockboxDeduction;
    const celoDebt = Math.max(0, celoCorrectedSupply - celoReserveHeld - celoLost);
    const [celoTotalUsd, celoDebtUsd, celoHeldUsd, celoLostUsd] = await Promise.all([
      this.exchangeRatesService.convert(celoCorrectedSupply, fiatTicker, 'USD'),
      this.exchangeRatesService.convert(celoDebt, fiatTicker, 'USD'),
      this.exchangeRatesService.convert(celoReserveHeld, fiatTicker, 'USD'),
      this.exchangeRatesService.convert(celoLost, fiatTicker, 'USD'),
    ]);
    supplies.push({
      chain: Chain.CELO,
      address: celoAddress,
      supply: {
        total: celoCorrectedSupply.toString(), total_usd: Number(celoTotalUsd),
        debt: celoDebt.toString(), debt_usd: Number(celoDebtUsd),
        reserve_held: celoReserveHeld.toString(), reserve_held_usd: Number(celoHeldUsd),
        lost: celoLost.toString(), lost_usd: Number(celoLostUsd),
      },
    });

    // Other chains: all supply is debt (no adjustments on spoke chains yet)
    for (const { deployment, supply: chainSupply } of otherChainSupplies) {
      const chainUsd = await this.exchangeRatesService.convert(chainSupply, fiatTicker, 'USD');
      supplies.push({
        chain: deployment.chain,
        address: deployment.address,
        supply: {
          total: chainSupply.toString(), total_usd: Number(chainUsd),
          debt: chainSupply.toString(), debt_usd: Number(chainUsd),
          reserve_held: '0', reserve_held_usd: 0,
          lost: '0', lost_usd: 0,
        },
      });
    }

    return { networkSupplies: supplies, lockboxDeduction: totalLockboxDeduction };
  }

  /**
   * Get the debt-side (stablecoin) amounts locked in FPMM pools by the reserve.
   */
  private async getFpmmReserveHeldBySymbol(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    const chains = [Chain.CELO, Chain.MONAD];

    for (const chain of chains) {
      try {
        const positions = await this.fpmmPositionsService.getPositions(chain);
        for (const pos of positions) {
          const sym = pos.debt_token.symbol;
          result[sym] = (result[sym] ?? 0) + pos.debt_token.amount;
        }
      } catch (error) {
        this.logger.warn(`Failed to get FPMM positions on ${chain}: ${error}`);
      }
    }

    return result;
  }
}
