import { Injectable, Logger } from '@nestjs/common';
import { formatUnits, parseAbi } from 'viem';
import { ChainClientService } from '@/common/services/chain-client.service';
import { ExchangeRatesService } from '@/common/services/exchange-rates.service';
import { Chain, MENTO_STABLECOIN_SYMBOLS } from '@types';
import { withRetry, RETRY_CONFIGS } from '@/utils';
import { ERC20_ABI, ViemAdapter, AAVESupplyCalculator } from '@mento-protocol/mento-sdk';
import { RESERVE_STABLECOIN_HOLDERS, AAVE_STABLECOIN_HOLDERS } from '../config/adjustments.config';
import { getFiatTickerFromSymbol } from '@/common/constants';

interface StablecoinToken {
  symbol: string;
  address: string;
  decimals: number;
}

interface TokenAdjustment {
  /** Adjustment amount in token units (formatted, not raw) */
  amount: number;
  /** Adjustment amount in USD */
  usdValue: number;
}

interface AdjustmentResult {
  /** Total USD value of all adjustments */
  totalUsdValue: number;
  /** Per-token adjustments keyed by token symbol */
  byToken: Record<string, TokenAdjustment>;
}

@Injectable()
export class StablecoinAdjustmentsService {
  private readonly logger = new Logger(StablecoinAdjustmentsService.name);

  constructor(
    private readonly chainClientService: ChainClientService,
    private readonly exchangeRatesService: ExchangeRatesService,
  ) {}

  /**
   * Calculate total USD value of stablecoins that should be subtracted from outstanding supply.
   * This includes:
   * - Stablecoins held directly by reserve addresses
   * - Stablecoins deposited in AAVE by the reserve
   * - Lost tokens (self-held by contract + additional dead addresses)
   */
  async calculateTotalAdjustments(stablecoins: StablecoinToken[]): Promise<AdjustmentResult> {
    const mentoStablecoins = stablecoins.filter((token) =>
      MENTO_STABLECOIN_SYMBOLS.includes(token.symbol as (typeof MENTO_STABLECOIN_SYMBOLS)[number]),
    );

    const byToken: Record<string, TokenAdjustment> = {};

    if (mentoStablecoins.length === 0) {
      return { totalUsdValue: 0, byToken };
    }

    // Initialize per-token tracking
    for (const token of mentoStablecoins) {
      byToken[token.symbol] = { amount: 0, usdValue: 0 };
    }

    const [reserveHoldings, aavePositions, lostTokens] = await Promise.all([
      this.calculateReserveHoldings(mentoStablecoins, byToken),
      this.calculateAavePositions(mentoStablecoins, byToken),
      this.calculateLostTokens(mentoStablecoins, byToken),
    ]);

    const totalUsdValue = reserveHoldings + aavePositions + lostTokens;

    this.logger.log(
      `Stablecoin adjustments - Reserve: $${reserveHoldings.toFixed(2)}, ` +
        `AAVE: $${aavePositions.toFixed(2)}, Lost: $${lostTokens.toFixed(2)}, ` +
        `Total: $${totalUsdValue.toFixed(2)}`,
    );

    return { totalUsdValue, byToken };
  }

  /**
   * Calculate USD value of stablecoins held directly by reserve addresses
   */
  private async calculateReserveHoldings(
    stablecoins: StablecoinToken[],
    byToken: Record<string, TokenAdjustment>,
  ): Promise<number> {
    let totalUsdValue = 0;

    for (const token of stablecoins) {
      for (const holder of RESERVE_STABLECOIN_HOLDERS) {
        try {
          const balance = await this.fetchERC20Balance(token.address, holder.address);
          if (BigInt(balance) > 0n) {
            const formattedAmount = Number(formatUnits(BigInt(balance), token.decimals));
            const usdValue = await this.convertToUsd(balance, token.decimals, token.symbol);
            totalUsdValue += usdValue;
            byToken[token.symbol].amount += formattedAmount;
            byToken[token.symbol].usdValue += usdValue;
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch ${token.symbol} balance for ${holder.label}: ${error}`);
        }
      }
    }

    return totalUsdValue;
  }

  /**
   * Calculate USD value of stablecoins deposited in AAVE by reserve addresses
   */
  private async calculateAavePositions(
    stablecoins: StablecoinToken[],
    byToken: Record<string, TokenAdjustment>,
  ): Promise<number> {
    let totalUsdValue = 0;

    const adapter = new ViemAdapter(this.chainClientService.getClient(Chain.CELO));

    for (const token of stablecoins) {
      for (const holder of AAVE_STABLECOIN_HOLDERS) {
        try {
          const calculator = new AAVESupplyCalculator(adapter, [holder.address]);
          const balance = await withRetry(
            () => calculator.getAmount(token.address),
            `Failed to fetch AAVE balance for ${token.symbol}`,
            { ...RETRY_CONFIGS.SDK_OPERATION, logger: this.logger },
          );

          const balanceStr = balance?.toString() || '0';
          if (BigInt(balanceStr) > 0n) {
            const formattedAmount = Number(formatUnits(BigInt(balanceStr), token.decimals));
            const usdValue = await this.convertToUsd(balanceStr, token.decimals, token.symbol);
            totalUsdValue += usdValue;
            byToken[token.symbol].amount += formattedAmount;
            byToken[token.symbol].usdValue += usdValue;
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch AAVE ${token.symbol} balance for ${holder.label}: ${error}`);
        }
      }
    }

    return totalUsdValue;
  }

  /**
   * Calculate USD value of lost tokens (tokens held by their own contract address)
   */
  private async calculateLostTokens(
    stablecoins: StablecoinToken[],
    byToken: Record<string, TokenAdjustment>,
  ): Promise<number> {
    let totalUsdValue = 0;

    for (const token of stablecoins) {
      try {
        // Check self-held balance (token contract holding its own tokens)
        const balance = await this.fetchERC20Balance(token.address, token.address);
        if (BigInt(balance) > 0n) {
          const formattedAmount = Number(formatUnits(BigInt(balance), token.decimals));
          const usdValue = await this.convertToUsd(balance, token.decimals, token.symbol);
          totalUsdValue += usdValue;
          byToken[token.symbol].amount += formattedAmount;
          byToken[token.symbol].usdValue += usdValue;
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch ${token.symbol} self-held balance: ${error}`);
      }
    }

    return totalUsdValue;
  }

  /**
   * Fetch ERC20 token balance
   */
  private async fetchERC20Balance(tokenAddress: string, holderAddress: string): Promise<string> {
    return withRetry(
      async () => {
        return await this.chainClientService.executeRateLimited<string>(Chain.CELO, async (client) => {
          const balance = await client.readContract({
            address: tokenAddress as `0x${string}`,
            abi: parseAbi(ERC20_ABI),
            functionName: 'balanceOf',
            args: [holderAddress as `0x${string}`],
          });
          return (balance as bigint).toString();
        });
      },
      `Failed to fetch balance for ${tokenAddress}`,
      { ...RETRY_CONFIGS.GENERAL_RPC, logger: this.logger },
    );
  }

  /**
   * Convert token amount to USD value
   */
  private async convertToUsd(balance: string, decimals: number, symbol: string): Promise<number> {
    const formattedBalance = Number(formatUnits(BigInt(balance), decimals));
    const fiatTicker = getFiatTickerFromSymbol(symbol);
    return this.exchangeRatesService.convert(formattedBalance, fiatTicker, 'USD');
  }
}
