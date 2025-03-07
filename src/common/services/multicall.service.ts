import { Chain } from '@/types';
import { Injectable, Logger } from '@nestjs/common';
import { Contract, Interface } from 'ethers';
import { ChainProvidersService } from './chain-provider.service';

/**
 * ABI for the Multicall3 contract's aggregate3 function.
 * This is a read-only (view) function that allows batching multiple contract calls into a single RPC request.
 * Each call can be configured to allow failure, making it more resilient than the regular aggregate function.
 * See: https://www.multicall3.com/abi#ethers-js
 */
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)',
];

/**
 * Addresses of the Multicall3 contract deployed on different chains.
 * Multicall3 is typically deployed at the same address on most EVM chains through CREATE2.
 * See: https://www.multicall3.com/deployments
 */
const MULTICALL3_ADDRESSES: Partial<Record<Chain, string>> = {
  [Chain.CELO]: '0xcA11bde05977b3631167028862bE2a173976CA11',
  [Chain.ETHEREUM]: '0xcA11bde05977b3631167028862bE2a173976CA11',
};

/**
 * Interface for the ERC20 balanceOf function.
 * Used to encode function calls and decode return data.
 */
const ERC20_INTERFACE = new Interface(['function balanceOf(address owner) view returns (uint256)']);

/**
 * Result structure returned by the Multicall3 contract.
 * @property success - Whether the call was successful
 * @property returnData - The encoded return data from the call
 */
interface MulticallResult {
  success: boolean;
  returnData: string;
}

/**
 * Service for batching multiple ERC20 balance queries into a single RPC call using Multicall3.
 *
 * This service helps reduce RPC calls and avoid rate limits by:
 * 1. Batching multiple token balance queries into a single request
 * 2. Supporting failed calls within a batch (they return 0 instead of failing the entire batch)
 * 3. Using read-only calls to minimize RPC usage
 *
 * The service uses the Multicall3 contract, which is deployed at the same address on most EVM chains.
 * See: https://multicall3.com/
 */
@Injectable()
export class MulticallService {
  private readonly logger = new Logger(MulticallService.name);
  private readonly contracts: Partial<Record<Chain, Contract>>;

  constructor(private readonly chainProviders: ChainProvidersService) {
    this.contracts = {
      [Chain.CELO]: new Contract(
        MULTICALL3_ADDRESSES[Chain.CELO],
        MULTICALL3_ABI,
        this.chainProviders.getProvider(Chain.CELO),
      ),
      [Chain.ETHEREUM]: new Contract(
        MULTICALL3_ADDRESSES[Chain.ETHEREUM],
        MULTICALL3_ABI,
        this.chainProviders.getProvider(Chain.ETHEREUM),
      ),
    };
  }

  /**
   * Batch multiple ERC20 balanceOf calls into a single RPC request.
   *
   * This method:
   * 1. Takes an array of token addresses and account addresses
   * 2. Encodes all balanceOf calls
   * 3. Executes them in a single multicall
   * 4. Decodes the results
   *
   * Failed calls within the batch will return '0' instead of throwing an error.
   * This makes the method more resilient to individual token contract issues.
   *
   * @param chain - The chain to query (e.g., CELO, ETHEREUM)
   * @param calls - Array of {token, account} pairs to get balances for
   * @returns Array of results containing success status and decoded balance
   * @throws Error if the multicall contract is not available for the chain
   * @throws Error if the batch request fails entirely
   */
  async batchBalanceOf(chain: Chain, calls: { token: string; account: string }[]): Promise<MulticallResult[]> {
    const multicall = this.contracts[chain];
    if (!multicall) {
      throw new Error(`No multicall contract available for chain ${chain}`);
    }

    const callData = calls.map(({ token, account }) => ({
      target: token,
      allowFailure: true,
      callData: ERC20_INTERFACE.encodeFunctionData('balanceOf', [account]),
    }));

    try {
      const results = await multicall.aggregate3.staticCall(callData);
      return results.map((result: MulticallResult) => ({
        success: result.success,
        returnData: result.success
          ? ERC20_INTERFACE.decodeFunctionResult('balanceOf', result.returnData)[0].toString()
          : '0',
      }));
    } catch (error) {
      this.logger.error(`Failed to batch balance requests for chain ${chain}:`, error);
      throw error;
    }
  }
}
