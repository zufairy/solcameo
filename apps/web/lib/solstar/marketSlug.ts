/**
 * Coin URLs use the ticker: /market/buttons for $BUTTONS. Lowercase, `$` dropped and anything that is not a letter or
 * digit squeezed out, so a name with spaces runs together ("Hook Pad" is "hookpad").
 */
export function marketSlug(ticker: string): string {
  return ticker.replace(/^\$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Path for a coin: its ticker slug when it has one, otherwise the id (which redirects to the slug once it resolves). */
export function marketPath(coin: { characterId: string; ticker?: string | null }): string {
  const slug = coin.ticker ? marketSlug(coin.ticker) : "";
  return `/market/${slug.length >= 2 ? slug : coin.characterId}`;
}

/** The ticker a URL segment names, or null when it cannot be a ticker (the real tickers are 2 to 10 capitals or digits). */
export function tickerFromSegment(segment: string): string | null {
  return /^[a-z0-9]{2,10}$/i.test(segment) ? segment.toUpperCase() : null;
}
