import { Contract, Provider } from 'ethers';
import { ERC20_ABI } from '@mento-protocol/mento-sdk';
import { Logger } from '@nestjs/common';
import { retryWithCondition } from '@/utils';

export class ERC20BalanceFetcher {
  constructor(private provider: Provider) {}

  /**
   * Fetch the balance of a token for a given holder address
   * @param tokenAddress - The address of the token (or null for native token)
   * @param holderAddress - The address of the holder
   * @returns The balance of the token
   */
  async fetchBalance(tokenAddress: string | null, holderAddress: string): Promise<string> {
    // Double provider access needed due to JsonRpcProvider wrapping the underlying provider
    const network = await this.provider.provider.getNetwork();
    const chain = network.name;

    const balance = await retryWithCondition(
      async () => {
        // Handle native token (ETH) case
        if (!tokenAddress) {
          const balance = await this.provider.getBalance(holderAddress);
          return balance.toString();
        }

        // Handle ERC20 tokens
        const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
        const balance = await contract.balanceOf(holderAddress);
        return balance.toString();
      },
      (balance) => BigInt(balance) >= BigInt(50),
      {
        maxRetries: 3,
        logger: new Logger('ERC20BalanceFetcher'),
        baseDelay: 1000,
        warningMessage: `Low balance detected for asset ${tokenAddress} on ${chain} at ${holderAddress}`,
      },
    );

    return balance;
  }
}
