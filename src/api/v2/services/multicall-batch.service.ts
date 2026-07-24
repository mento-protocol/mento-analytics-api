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

/** Max calls per multicall RPC request. Keeps payloads reasonable for RPC providers. */
const MAX_BATCH_SIZE = 30;

/** Delay between batches to avoid rate limits (ms) */
const INTER_BATCH_DELAY = 100;

/** How many extra passes to retry results that came back null (transient RPC / 429). */
const MAX_NULL_RETRIES = 2;
/** Base backoff between null-retry passes (ms), scaled by attempt number. */
const NULL_RETRY_DELAY = 300;

/**
 * Wraps viem's multicall() to batch multiple readContract calls into single
 * RPC requests. Chunks large batches, serializes per-chain, and falls back
 * to individual rate-limited calls on failure.
 */
@Injectable()
export class MulticallBatchService {
  private readonly logger = new Logger(MulticallBatchService.name);

  constructor(private readonly chainClientService: ChainClientService) {}

  /**
   * Execute multiple readContract calls batched via multicall.
   * Large call lists are chunked into groups of MAX_BATCH_SIZE and
   * sent sequentially with a small delay between chunks.
   */
  async batchRead<T = unknown>(chain: Chain, calls: MulticallReadCall[]): Promise<(T | null)[]> {
    if (calls.length === 0) return [];

    const results = await this.runChunks<T>(chain, calls);

    // Retry only the calls that came back null. A transient RPC hiccup or a 429
    // rate-limit shouldn't silently drop a data point (e.g. a large reserve balance)
    // and poison the cached result — retry the failed subset with backoff.
    for (let attempt = 1; attempt <= MAX_NULL_RETRIES; attempt++) {
      const nullIdx: number[] = [];
      for (let i = 0; i < results.length; i++) if (results[i] === null) nullIdx.push(i);
      if (nullIdx.length === 0) break;

      await new Promise((r) => setTimeout(r, NULL_RETRY_DELAY * attempt));
      const retry = await this.runChunks<T>(
        chain,
        nullIdx.map((i) => calls[i]),
      );
      let recovered = 0;
      nullIdx.forEach((i, k) => {
        if (retry[k] !== null) {
          results[i] = retry[k];
          recovered++;
        }
      });
      this.logger.debug(
        `Null-retry ${attempt} on ${chain}: recovered ${recovered}/${nullIdx.length}, ${nullIdx.length - recovered} still null`,
      );
    }

    return results;
  }

  /** Chunk a call list and execute each chunk via multicall (with per-chunk fallback). */
  private async runChunks<T>(chain: Chain, calls: MulticallReadCall[]): Promise<(T | null)[]> {
    const chunks: MulticallReadCall[][] = [];
    for (let i = 0; i < calls.length; i += MAX_BATCH_SIZE) {
      chunks.push(calls.slice(i, i + MAX_BATCH_SIZE));
    }

    const allResults: (T | null)[] = [];

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];

      // Small delay between chunks to avoid overwhelming the RPC
      if (ci > 0) {
        await new Promise((r) => setTimeout(r, INTER_BATCH_DELAY));
      }

      const chunkResults = await this.executeChunk<T>(chain, chunk);
      allResults.push(...chunkResults);
    }

    return allResults;
  }

  /**
   * Execute a single chunk via multicall, going through the chain rate limiter.
   */
  private async executeChunk<T>(chain: Chain, calls: MulticallReadCall[]): Promise<(T | null)[]> {
    try {
      // Go through executeRateLimited so we respect the per-chain concurrency limits
      return await this.chainClientService.executeRateLimited<(T | null)[]>(chain, async (client) => {
        const results: { status: string; result?: unknown }[] = await (client.multicall as any)({
          contracts: calls.map((call) => ({
            address: getAddress(call.address),
            abi: call.abi,
            functionName: call.functionName,
            args: call.args,
          })),
          allowFailure: true,
        });

        const mapped = results.map((r) => {
          if (r.status === 'success') {
            return r.result as T;
          }
          return null;
        });

        // If all calls in this chunk failed, log once (not per-call)
        const failCount = mapped.filter((r) => r === null).length;
        if (failCount === calls.length) {
          this.logger.warn(`All ${calls.length} calls failed in multicall chunk on ${chain}`);
        } else if (failCount > 0) {
          this.logger.debug(`${failCount}/${calls.length} calls failed in multicall chunk on ${chain}`);
        }

        return mapped;
      });
    } catch (error) {
      // Multicall itself failed (no multicall3, RPC error, etc.) — fall back to individual calls
      this.logger.warn(
        `Multicall chunk failed on ${chain}, falling back to individual calls: ${(error as Error).message?.slice(0, 100)}`,
      );
      return this.fallbackIndividualCalls<T>(chain, calls);
    }
  }

  /**
   * Fallback: execute calls individually with rate limiting and small delays.
   */
  private async fallbackIndividualCalls<T>(chain: Chain, calls: MulticallReadCall[]): Promise<(T | null)[]> {
    const results: (T | null)[] = [];

    // Execute sequentially with rate limiter to avoid burst
    for (const call of calls) {
      try {
        const result = await this.chainClientService.executeRateLimited<unknown>(chain, (client) =>
          (client.readContract as any)({
            address: getAddress(call.address),
            abi: call.abi,
            functionName: call.functionName,
            args: call.args,
          }),
        );
        results.push(result as T);
      } catch {
        results.push(null);
      }
    }

    return results;
  }
}
