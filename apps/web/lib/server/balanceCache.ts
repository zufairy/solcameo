export type BalanceEntry = { usdc: number; sol: number; at: number };

/**
 * Split requested wallets into the ones whose cached balance is still FRESH
 * (within ttlMs) and the STALE/uncached ones the caller must re-fetch. Lets the
 * agent-wallet-balances route collapse repeated polls of the same agent set into
 * ~one RPC round-trip per TTL — the fix for free-tier Helius 429s.
 */
export function splitByFreshness(
  wallets: string[],
  cache: Map<string, BalanceEntry>,
  now: number,
  ttlMs: number,
): { fresh: Record<string, { usdc: number; sol: number }>; stale: string[] } {
  const fresh: Record<string, { usdc: number; sol: number }> = {};
  const stale: string[] = [];
  for (const w of wallets) {
    const e = cache.get(w);
    if (e && now - e.at < ttlMs) fresh[w] = { usdc: e.usdc, sol: e.sol };
    else stale.push(w);
  }
  return { fresh, stale };
}
