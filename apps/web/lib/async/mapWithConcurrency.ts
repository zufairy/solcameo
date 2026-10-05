/**
 * Bounded-concurrency async map.
 *
 * Runs `fn` over `items` in small waves of at most `limit` in flight at once,
 * with an optional `interWaveDelayMs` pause between waves. Results are returned
 * in the SAME order as `items` (regardless of completion order).
 *
 * Why waves (not a continuous worker pool): the caller wants to throttle bursts
 * against a rate-limited RPC, and the inter-wave delay gives the free tier a
 * moment to breathe between batches — a natural fit for the wave model.
 *
 * Error semantics: this runner has the same "fail fast" contract as
 * `Promise.all` — if `fn` rejects for any item, the whole run rejects. To
 * TOLERATE individual failures, have `fn` catch its own error and return a
 * settled sentinel (e.g. `{ ok: false }`) instead of throwing.
 *
 * Dependency-free (no timers imported, no web3, no fetch) so it is unit-testable
 * in isolation.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  interWaveDelayMs = 0,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const size = Math.max(1, Math.floor(limit));
  for (let start = 0; start < items.length; start += size) {
    const wave = items.slice(start, start + size);
    const settled = await Promise.all(wave.map((item, j) => fn(item, start + j)));
    for (let j = 0; j < settled.length; j++) results[start + j] = settled[j];
    const hasMore = start + size < items.length;
    if (interWaveDelayMs > 0 && hasMore) {
      await new Promise<void>((resolve) => setTimeout(resolve, interWaveDelayMs));
    }
  }
  return results;
}
