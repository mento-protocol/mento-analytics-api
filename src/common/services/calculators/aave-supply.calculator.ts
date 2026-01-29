import { Injectable, Logger } from '@nestjs/common';
import { parseAbi } from 'viem';
import { ChainClientService } from '@/common/services/chain-client.service';
import { Chain } from '@types';
import { ERC20_ABI } from '@/common/constants';
import { AAVE_TOKEN_MAPPINGS } from '@/common/config/aave.config';

/**
 * Calculates the amount of tokens supplied to AAVE protocol.
 *
 * When tokens are supplied to AAVE, the protocol mints corresponding "aTokens"
 * as receipt tokens. The balance of the aTokens represents the total
 * amount of the original token supplied to the protocol.
 */
@Injectable()
export class AAVESupplyCalculator {
  private readonly logger = new Logger(AAVESupplyCalculator.name);

  constructor(private readonly chainClientService: ChainClientService) { }

  /**
   * Gets the balance of the corresponding aToken for the specified token address
   * that is held by the holder addresses.
   * @param tokenAddress - The address of the token to get the balance for.
   * @param holderAddresses - The addresses to check for aToken balances.
   * @param chain - The chain to query.
   * @returns The balance of the corresponding aToken.
   */
  async getAmount(tokenAddress: string, holderAddresses: string[], chain: Chain): Promise<bigint> {
    const chainMappings = AAVE_TOKEN_MAPPINGS[chain];
    if (!chainMappings) {
      this.logger.warn(`No AAVE_TOKEN_MAPPINGS entry for chain: ${chain}`);
      return 0n; // No mappings for this chain
    }

    const aTokenAddress = chainMappings[tokenAddress];
    if (!aTokenAddress) {
      this.logger.warn(`No AAVE_TOKEN_MAPPINGS entry for chain: ${chain} and tokenAddress: ${tokenAddress}`);
      return 0n; // No aToken mapping for this token
    }

    const client = this.chainClientService.getClient(chain);

    const balances = await Promise.all(
      holderAddresses.map(async (holderAddress) => {
        try {
          const balance = await client.readContract({
            address: aTokenAddress as `0x${string}`,
            abi: parseAbi(ERC20_ABI),
            functionName: 'balanceOf',
            args: [holderAddress as `0x${string}`],
          });
          return balance as bigint;
        } catch (error) {
          this.logger.warn(`Failed to fetch AAVE balance for ${holderAddress}: ${error}`);
          return 0n;
        }
      }),
    );

    return balances.reduce((acc, balance) => acc + balance, 0n);
  }
}
