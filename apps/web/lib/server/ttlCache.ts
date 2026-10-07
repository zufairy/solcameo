/**
 * Tiny per-process TTL cache with in-flight de-duplication: many callers asking for the same key inside the window
 * share one load. A failed load serves the last good value (stale-if-error) instead of failing every caller.
 */
export class TtlCache<V> {
  private store = new Map<string, { v: V; t: number }>();
  private inflight = new Map<string, Promise<V>>();
  constructor(private ttlMs: number, private maxEntries = 500) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.store.get(key);
    if (hit && Date.now() - hit.t < this.ttlMs) return hit.v;
    let p = this.inflight.get(key);
    if (!p) {
      p = load().then(
        (v) => {
          if (this.store.size >= this.maxEntries) this.store.delete(this.store.keys().next().value as string);
          this.store.set(key, { v, t: Date.now() });
          return v;
        },
      ).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    try { return await p; } catch (e) { if (hit) return hit.v; throw e; }
  }
  /** Last stored value regardless of age. */
  peek(key: string): V | undefined { return this.store.get(key)?.v; }
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}
