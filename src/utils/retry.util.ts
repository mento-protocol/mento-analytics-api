import { Logger } from '@nestjs/common';

interface RetryOptions {
  maxRetries?: number;
  logger?: Logger;
  baseDelay?: number; // milliseconds
}

const defaultOptions: Required<RetryOptions> = {
  maxRetries: 3,
  logger: new Logger('RetryUtil'),
  baseDelay: 1000,
};

/**
 * Utility function to retry an async operation with exponential backoff
 * @param operation The async operation to retry
 * @param errorMessage The error message to log if all retries fail
 * @param options Configuration options for retry behavior
 * @returns The result of the operation
 * @throws The last error encountered if all retries fail
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  errorMessage: string,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries, logger, baseDelay } = { ...defaultOptions, ...options };
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (attempt === maxRetries) {
        logger.error(`${errorMessage} after ${maxRetries} attempts:`, error);
        throw error;
      }
      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * baseDelay));
    }
  }
}
