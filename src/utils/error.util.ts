/**
 * Detects the type of provider error and generates appropriate messages
 * @param error - The error object from a provider call
 * @param context - Context information for error messages (e.g., token address)
 * @returns Object with error type flags and formatted messages
 */
export function handleFetchError(
  error: any,
  context: {
    tokenAddress: string;
    accountAddress: string;
  },
) {
  const { tokenAddress, accountAddress } = context;
  const isRateLimit = error?.code === 'BAD_DATA' && error?.value?.[0]?.code === -32005;
  const isPaymentRequired = error?.code === 'SERVER_ERROR' && error?.info?.responseStatus === '402 Payment Required';

  // Generate appropriate messages based on error type and context
  const rateLimitMessage = `Rate limit exceeded while fetching balance for ${tokenAddress} for ${accountAddress}`;
  const paymentRequiredMessage = `Payment required error while fetching balance for ${tokenAddress} for ${accountAddress} - daily limit reached`;

  const message = isPaymentRequired ? paymentRequiredMessage : isRateLimit ? rateLimitMessage : null;

  return {
    isRateLimit,
    isPaymentRequired,
    message,
  };
}
