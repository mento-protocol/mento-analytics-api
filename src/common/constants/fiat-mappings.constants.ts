/**
 * Extracts the fiat ticker from a Mento stable token symbol.
 * All Mento stable tokens follow the format [FIAT_TICKER]m (e.g., USDm -> USD)
 */
export function getFiatTickerFromSymbol(symbol: string): string {
  return symbol.slice(0, -1);
}
