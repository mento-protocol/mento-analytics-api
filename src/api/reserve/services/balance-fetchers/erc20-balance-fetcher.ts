import { Logger } from '@nestjs/common';
import { withRetry } from '@/utils';
import { Chain } from '@/types';
import { PublicClient, parseAbi } from 'viem';
import { ERC20_ABI } from '@mento-protocol/mento-sdk';

export class ERC20BalanceFetcher {
  private readonly logger = new Logger(ERC20BalanceFetcher.name);

  constructor(private client: PublicClient) {}

  /**
   * Fetch the balance of a token for a given holder address
   * @param tokenAddress - The address of the token (or null for native token)
   * @param holderAddress - The address of the holder
   * @returns The balance of the token
   */
  async fetchBalance(tokenAddress: string | null, holderAddress: string, chain: Chain): Promise<string> {
    return withRetry(
      async () => {
        // Handle native token case
        if (!tokenAddress) {
          const balance = await this.client.getBalance({
            address: holderAddress as `0x${string}`,
          });
          return balance.toString();
        }

        const balance = await this.client.readContract({
          address: tokenAddress as `0x${string}`,
          abi: parseAbi(ERC20_ABI),
          functionName: 'balanceOf',
          args: [holderAddress as `0x${string}`],
        });

        return balance.toString();
      },
      `Failed to fetch balance for asset ${tokenAddress} on ${chain.toString()} at ${holderAddress}`,
      {
        maxRetries: 3,
        logger: this.logger,
        baseDelay: 1000,
      },
    );
  }
}
