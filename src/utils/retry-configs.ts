import { Logger } from '@nestjs/common';

interface RetryOptions {
  maxRetries?: number;
  rateLimitMaxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  logger?: Logger;
}

/**
 * Standard retry configurations for different operation types
 */
export const RETRY_CONFIGS = {
  // For RPC calls (balance fetching, contract reads)
  RPC_CALL: {
    maxRetries: 5,
    rateLimitMaxRetries: 10,
    baseDelay: 1000,
    maxDelay: 30000,
  },

  // For SDK operations (UniV3, AAVE)
  SDK_OPERATION: {
    maxRetries: 8,
    rateLimitMaxRetries: 15,
    baseDelay: 2000,
    maxDelay: 60000,
  },

  // For external APIs (exchange rates, price data)
  EXTERNAL_API: {
    maxRetries: 5,
    rateLimitMaxRetries: 12,
    baseDelay: 10000,
    maxDelay: 300000,
  },
} as const satisfies Record<string, RetryOptions>;
