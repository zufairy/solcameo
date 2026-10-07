/**
 * The USDC balance read a moment ago for a wallet. A payment starts by reading the agent's balance and, a few milliseconds
 * later, reconciles against it again; the chain cannot have moved in between (nothing was sent), so the second read is
 * skipped. Entries expire fast so nothing stale is ever trusted across a real transfer.
 */
const TTL_MS = 3000;
const memo = new Map<string, { usdc: number; t: number }>();

export function rememberBalance(wallet: string, usdc: number): void {
  if (memo.size > 500) memo.clear();
  memo.set(wallet, { usdc, t: Date.now() });
}

/** The balance read within the last few seconds, or null. Single use: reading it clears it, so a later payment re-reads. */
export function takeRecentBalance(wallet: string): number | null {
  const hit = memo.get(wallet);
  memo.delete(wallet);
  return hit && Date.now() - hit.t < TTL_MS ? hit.usdc : null;
}
