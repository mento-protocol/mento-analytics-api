/**
 * Detects the type of provider error and generates appropriate messages
 * @param error - The error object from a provider call
 * @param context - Context information for error messages (e.g., token address)
 * @returns Object with error type flags and formatted messages
 */
export function handleFetchError(
  error: any,
  context: {
    tokenAddressOrSymbol: string;
    accountAddress: string;
    chain: string;
  },
) {
  const { tokenAddressOrSymbol, accountAddress, chain } = context;

  const isDnsError = error?.code === 'EAI_AGAIN' && !!error?.message?.includes('getaddrinfo');
  const isRateLimit = error?.code === 'BAD_DATA' && error?.value?.[0]?.code === -32005;
  const isPaymentRequired = error?.code === 'SERVER_ERROR' && error?.info?.responseStatus === '402 Payment Required';

  const dnsErrorMessage = `DNS resolution error while fetching balance of ${tokenAddressOrSymbol} for ${accountAddress} on ${chain}`;
  const rateLimitMessage = `Rate limit exceeded while fetching balance of ${tokenAddressOrSymbol} for ${accountAddress} on ${chain}`;
  const paymentRequiredMessage = `Payment required error while fetching balance of ${tokenAddressOrSymbol} for ${accountAddress} on ${chain} - daily limit reached`;

  let message;
  if (isDnsError) {
    message = dnsErrorMessage;
  } else if (isRateLimit) {
    message = rateLimitMessage;
  } else if (isPaymentRequired) {
    message = paymentRequiredMessage;
  }

  return {
    isDnsError,
    isRateLimit,
    isPaymentRequired,
    message,
  };
}
