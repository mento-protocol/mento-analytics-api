import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

interface RetryOptions {
  maxRetries?: number;
  logger?: Logger;
  baseDelay?: number;
  maxDelay?: number;
  rateLimitMaxRetries?: number;
}

const defaultOptions: Required<RetryOptions> = {
  maxRetries: 3,
  logger: new Logger('RetryUtil'),
  baseDelay: 1000,
  maxDelay: 60000,
  rateLimitMaxRetries: 10,
};

enum ErrorType {
  RATE_LIMIT = 'Rate Limited',
  WEBSOCKET = 'WebSocket Failure',
  API_ERROR = 'API Error',
  CONTRACT_ERROR = 'Contract Execution Error',
  GENERAL = 'General Error',
}

const ERROR_DETAILS = {
  patterns: {
    [ErrorType.RATE_LIMIT]: [
      '429',
      '503',
      'too many requests',
      'service unavailable',
      'rate limit',
      'quota exceeded',
      'server overload',
    ],
    [ErrorType.WEBSOCKET]: ['websocket', 'socket has been closed', 'socketclosederror', 'connection closed'],
    [ErrorType.CONTRACT_ERROR]: [
      'contractfunctionexecutionerror',
      'missing or invalid parameters',
      'execution reverted',
    ],
    [ErrorType.API_ERROR]: ['unexpected token', 'is not valid json', 'syntaxerror', '<html>', '<!doctype'],
  },
  contexts: {
    [ErrorType.RATE_LIMIT]: 'Consider reducing request frequency or upgrading API limits.',
    [ErrorType.WEBSOCKET]: 'Consider switching to HTTP transport for better stability.',
    [ErrorType.CONTRACT_ERROR]:
      'Contract call failed with invalid parameters or reverted. This may be due to race conditions in batch operations.',
    [ErrorType.API_ERROR]: 'External API is returning HTML instead of JSON.',
    [ErrorType.GENERAL]: 'Check error details above.',
  },
};

const BACKOFF_MULTIPLIERS = {
  [ErrorType.RATE_LIMIT]: 3,
  [ErrorType.WEBSOCKET]: 4,
  [ErrorType.CONTRACT_ERROR]: 3,
  [ErrorType.API_ERROR]: 5,
  [ErrorType.GENERAL]: 2,
};

/**
 * Classify error type based on error content
 */
function classifyError(error: any): ErrorType {
  if (!error) return ErrorType.GENERAL;

  const errorString = error.toString().toLowerCase();
  const errorMessage = error.message?.toLowerCase() || '';
  const statusCode = error.status || error.statusCode;

  // Check status codes first
  if (statusCode === 429 || statusCode === 503) return ErrorType.RATE_LIMIT;

  // Check pattern matches
  for (const [type, patterns] of Object.entries(ERROR_DETAILS.patterns)) {
    if (patterns.some((pattern) => errorString.includes(pattern) || errorMessage.includes(pattern))) {
      return type as ErrorType;
    }
  }

  return ErrorType.GENERAL;
}

/**
 * Retry an async operation with exponential backoff and intelligent error handling
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  errorMessage: string,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries, logger, baseDelay, maxDelay, rateLimitMaxRetries } = { ...defaultOptions, ...options };

  let attempt = 0;
  const errorTypes = new Set<ErrorType>();

  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      const errorType = classifyError(error);
      errorTypes.add(errorType);

      // Use extended retries for special error types
      const needsExtendedRetries = errorType !== ErrorType.GENERAL;
      const effectiveMaxRetries = needsExtendedRetries ? rateLimitMaxRetries : maxRetries;

      logger.warn(error, `${errorMessage} after ${attempt} attempts (${errorType}). Retrying...`);

      if (attempt >= effectiveMaxRetries) {
        const context = ERROR_DETAILS.contexts[errorType];
        logger.error(error, `${errorMessage} after ${attempt} attempts. ${context}`);

        Sentry.captureException(error, {
          level: 'error',
          extra: {
            description: errorMessage,
            errorType,
            errorTypes: Array.from(errorTypes),
            totalAttempts: attempt,
          },
        });
        throw error;
      }

      // Calculate backoff with jitter
      const multiplier = BACKOFF_MULTIPLIERS[errorType];
      const delay = Math.min(Math.pow(multiplier, attempt) * baseDelay + Math.random() * 1000, maxDelay);

      logger.debug(`Backing off for ${Math.round(delay)}ms (attempt ${attempt}/${effectiveMaxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Retry operation until a condition is met
 */
export async function retryWithCondition<T>(
  operation: () => Promise<T>,
  condition: (result: T) => boolean,
  options: RetryOptions & { warningMessage: string } = { warningMessage: 'Operation failed condition check' },
): Promise<T> {
  const { maxRetries, logger, baseDelay, warningMessage } = { ...defaultOptions, ...options };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await operation();
    if (condition(result)) return result;

    if (attempt === maxRetries - 1) {
      logger.warn(`${warningMessage} after ${maxRetries} attempts`);
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt + 1) * baseDelay));
  }
}
