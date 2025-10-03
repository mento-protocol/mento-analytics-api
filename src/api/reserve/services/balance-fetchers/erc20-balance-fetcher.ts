import { Logger } from '@nestjs/common';
import { withRetry, RETRY_CONFIGS } from '@/utils';
import { Chain } from '@/types';
import { parseAbi } from 'viem';
import { ERC20_ABI } from '@mento-protocol/mento-sdk';
import { ChainClientService } from '@/common/services/chain-client.service';

export class ERC20BalanceFetcher {
  private readonly logger = new Logger(ERC20BalanceFetcher.name);

  constructor(private chainClientService: ChainClientService) {}

  /**
   * Fetch token balance with rate limiting and retry logic
   */
  async fetchBalance(tokenAddress: string | null, holderAddress: string, chain: Chain): Promise<string> {
    return withRetry(
      async () => {
        return await this.chainClientService.executeRateLimited(chain, async (client) => {
          this.logger.debug(`Fetching balance: ${tokenAddress || 'native'} for ${holderAddress} on ${chain}`);

          // Native token
          if (!tokenAddress) {
            const balance = await client.getBalance({ address: holderAddress as `0x${string}` });
            return balance.toString();
          }

          // ERC20 token
          const balance = await client.readContract({
            address: tokenAddress as `0x${string}`,
            abi: parseAbi(ERC20_ABI),
            functionName: 'balanceOf',
            args: [holderAddress as `0x${string}`],
          });

          return (balance as bigint).toString();
        });
      },
      `Failed to fetch balance for ${tokenAddress || 'native'} on ${chain}`,
      { ...RETRY_CONFIGS.RPC_CALL, logger: this.logger },
    );
  }
}
