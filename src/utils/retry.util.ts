import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

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
      logger.warn(error, `${errorMessage} after ${attempt} attempts. Retrying...`);
      if (attempt === maxRetries) {
        logger.error(error, `${errorMessage} after ${maxRetries} attempts`);
        Sentry.captureException(error, {
          level: 'error',
          extra: {
            description: errorMessage,
          },
        });
        throw error;
      }
      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * baseDelay));
    }
  }
}

/**
 * Utility function to retry an async operation with exponential backoff until a condition is met
 * @param operation The async operation to retry
 * @param condition The condition to check the result of the operation
 * @param options Configuration options for retry behavior
 * @returns The result of the operation
 */
export async function retryWithCondition<T>(
  operation: () => Promise<T>,
  condition: (result: T) => boolean,
  options: RetryOptions & {
    warningMessage: string;
  } = { warningMessage: 'Operation failed condition check' },
): Promise<T> {
  const { maxRetries, logger, baseDelay, warningMessage } = { ...defaultOptions, ...options };
  let attempt = 0;

  while (attempt < maxRetries) {
    const result = await operation();

    if (condition(result)) {
      return result;
    }

    attempt++;
    if (attempt === maxRetries) {
      logger.warn(`${warningMessage} after ${maxRetries} attempts`);
      return result;
    }

    // Exponential backoff
    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * baseDelay));
  }
}
