import { Chain } from '@/types';
import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface } from 'ethers';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { ChainProvidersService } from './chain-provider.service';

/**
 * Result structure returned by the multicall operations.
 * @property success - Whether the call was successful
 * @property returnData - The decoded return data from the call
 */
interface MulticallResult {
  success: boolean;
  returnData: string;
}

/**
 * Service for batching multiple ERC20 balance queries into a single RPC call.
 *
 * This service uses the ethers-multicall-provider package which automatically batches
 * simultaneous contract calls into a single RPC request, reducing the number of network
 * requests and helping to avoid rate limits.
 *
 * Key benefits:
 * 1. Automatic batching of simultaneous calls
 * 2. No changes needed to contract interaction code
 * 3. Reduced RPC usage and faster response times
 *
 * See: https://www.npmjs.com/package/ethers-multicall-provider
 */
@Injectable()
export class MulticallService {
  private readonly logger = new Logger(MulticallService.name);
  private readonly wrappedProviders: Partial<Record<Chain, any>> = {};
  private readonly erc20Interface = new Interface(['function balanceOf(address owner) view returns (uint256)']);

  constructor(private readonly chainProviders: ChainProvidersService) {
    // Initialize wrapped providers for each chain
    this.initializeWrappedProviders();
  }

  private initializeWrappedProviders() {
    try {
      // Create wrapped providers for each supported chain
      const celoProvider = this.chainProviders.getProvider(Chain.CELO);
      // Using any type to avoid type conflicts between ethers Provider and AbstractProvider
      this.wrappedProviders[Chain.CELO] = MulticallWrapper.wrap(celoProvider as any);

      const ethereumProvider = this.chainProviders.getProvider(Chain.ETHEREUM);
      this.wrappedProviders[Chain.ETHEREUM] = MulticallWrapper.wrap(ethereumProvider as any);

      this.logger.log('Multicall providers initialized successfully');
    } catch (err) {
      this.logger.error('Failed to initialize multicall providers', err);
      throw err;
    }
  }

  /**
   * Batch multiple ERC20 balanceOf calls into a single RPC request.
   *
   * This method:
   * 1. Takes an array of token addresses and account addresses
   * 2. Creates contract instances for each token using the wrapped provider
   * 3. Executes all balanceOf calls, which are automatically batched
   * 4. Formats the results
   *
   * @param chain - The chain to query (e.g., CELO, ETHEREUM)
   * @param calls - Array of {token, account} pairs to get balances for
   * @returns Array of results containing success status and decoded balance
   * @throws Error if the multicall provider is not available for the chain
   */
  async batchBalanceOf(chain: Chain, calls: { token: string; account: string }[]): Promise<MulticallResult[]> {
    const wrappedProvider = this.wrappedProviders[chain];
    if (!wrappedProvider) {
      throw new Error(`No multicall provider available for chain ${chain}`);
    }

    try {
      // Create contract instances for each token
      const contracts = calls.map(
        ({ token }) => new Contract(token, ['function balanceOf(address) view returns (uint256)'], wrappedProvider),
      );

      // Execute all calls - they will be automatically batched
      const balancePromises = contracts.map((contract, index) =>
        contract
          .balanceOf(calls[index].account)
          .then((balance: any) => ({
            success: true,
            returnData: balance.toString(),
          }))
          .catch((err: any) => {
            this.logger.warn(
              `Failed to get balance for token ${calls[index].token} and account ${calls[index].account}: ${err.message}`,
            );
            return {
              success: false,
              returnData: '0',
            };
          }),
      );

      // Wait for all promises to resolve
      return Promise.all(balancePromises);
    } catch (err) {
      this.logger.error(`Failed to batch balance requests for chain ${chain}: ${err.message}`);
      throw err;
    }
  }
}
