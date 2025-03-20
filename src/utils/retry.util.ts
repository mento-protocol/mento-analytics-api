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

      // Check for DNS-related errors first
      const isDnsError = error?.code === 'EAI_AGAIN' && error?.message?.includes('getaddrinfo');

      if (isDnsError) {
        logger.warn(`DNS resolution error. Attempt ${attempt}/${maxRetries}. Waiting before retry...`);
      } else if (error?.code === 'BAD_DATA' && error?.value?.[0]?.code === -32005) {
        logger.warn(`Rate limit exceeded. Attempt ${attempt}/${maxRetries}. Waiting before retry...`);
      } else {
        logger.warn(`${errorMessage} after ${attempt} attempts. Retrying...`);
      }

      if (attempt === maxRetries) {
        // For the final error, log more details but still keep it readable
        if (isDnsError) {
          logger.error(`DNS resolution failed after ${maxRetries} attempts. Last error: ${error.message}`, error.stack);
        } else if (error?.code === 'BAD_DATA' && error?.value?.[0]?.code === -32005) {
          logger.error(`Rate limit exceeded. All ${maxRetries} retry attempts failed.`, error.stack);
        } else {
          logger.error(`${errorMessage} after ${maxRetries} attempts: ${error.message}`, error.stack);
        }
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
    try {
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
    } catch (error) {
      attempt++;

      // Check for DNS-related errors
      const isDnsError =
        error?.message?.includes('getaddrinfo') || error?.message?.includes('DNS') || error?.code === 'EAI_AGAIN';

      if (isDnsError) {
        logger.warn(`DNS resolution error. Attempt ${attempt}/${maxRetries}. Waiting before retry...`);
        // Use longer delay for DNS errors
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * baseDelay * 2));
      } else {
        logger.warn(`${warningMessage} after ${attempt} attempts. Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * baseDelay));
      }

      if (attempt === maxRetries) {
        if (isDnsError) {
          logger.error(`DNS resolution failed after ${maxRetries} attempts. Last error: ${error.message}`, error.stack);
        } else {
          logger.error(`${warningMessage} after ${maxRetries} attempts: ${error.message}`, error.stack);
        }
        throw error;
      }
    }
  }
}
