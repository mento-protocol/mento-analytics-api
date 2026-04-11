import { Injectable, Logger } from '@nestjs/common';
import { ChainClientService } from '@common/services/chain-client.service';
import { Chain } from '@types';
import { getAddress } from 'viem';

/**
 * A single readContract call description for multicall batching.
 */
export interface MulticallReadCall {
  address: string;
  abi: any;
  functionName: string;
  args?: any[];
}

/**
 * Wraps viem's multicall() to batch multiple readContract calls into single
 * RPC requests. Returns null for failed individual calls instead of throwing.
 */
@Injectable()
export class MulticallBatchService {
  private readonly logger = new Logger(MulticallBatchService.name);

  constructor(private readonly chainClientService: ChainClientService) {}

  /**
   * Execute multiple readContract calls in a single multicall RPC request.
   *
   * @param chain - The chain to execute on
   * @param calls - Array of contract read call descriptions
   * @returns Array of results in the same order as calls. Failed calls return null.
   */
  async batchRead<T = unknown>(chain: Chain, calls: MulticallReadCall[]): Promise<(T | null)[]> {
    if (calls.length === 0) return [];

    const client = this.chainClientService.getClient(chain);

    try {
      const results = await client.multicall({
        contracts: calls.map((call) => ({
          address: getAddress(call.address),
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
        })),
        allowFailure: true,
      } as any);

      const mapped = results.map((r, i) => {
        if (r.status === 'success') {
          return r.result as T;
        }
        this.logger.warn(
          `Multicall call #${i} failed (${calls[i].functionName} on ${calls[i].address}): ${r.error}`,
        );
        return null;
      });

      // If ALL calls failed, the multicall itself likely had an RPC issue — fall back to individual calls
      const allFailed = mapped.every((r) => r === null);
      if (allFailed && calls.length > 0) {
        this.logger.warn(`All ${calls.length} multicall calls failed on ${chain}, falling back to individual calls`);
        return this.fallbackIndividualCalls<T>(chain, calls);
      }

      return mapped;
    } catch (error) {
      // If multicall itself fails (e.g. no multicall3 on chain), fall back to individual calls
      this.logger.warn(`Multicall failed on ${chain}, falling back to individual calls: ${error}`);
      return this.fallbackIndividualCalls<T>(chain, calls);
    }
  }

  /**
   * Fallback: execute calls individually when multicall is not available or fails.
   */
  private async fallbackIndividualCalls<T>(chain: Chain, calls: MulticallReadCall[]): Promise<(T | null)[]> {
    const results = await Promise.allSettled(
      calls.map((call) =>
        this.chainClientService.executeRateLimited(chain, (client) =>
          client.readContract({
            address: getAddress(call.address),
            abi: call.abi,
            functionName: call.functionName,
            args: call.args,
          } as any),
        ),
      ),
    );

    return results.map((r, i) => {
      if (r.status === 'fulfilled') {
        return r.value as T;
      }
      this.logger.warn(
        `Individual call #${i} failed (${calls[i].functionName} on ${calls[i].address}): ${r.reason}`,
      );
      return null;
    });
  }
}
