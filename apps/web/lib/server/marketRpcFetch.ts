/** Pace market indexing across coins, and retry Helius throttling without a public-RPC fallback. */
let nextStart = 0;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export const marketRpcFetch: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    const start = Math.max(Date.now(), nextStart);
    nextStart = start + 125;
    if (start > Date.now()) await pause(start - Date.now());
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
    let throttled = response.status === 429;
    if (response.ok) {
      const payload = await response.clone().json().catch(() => null);
      throttled = payload?.error?.code === 429;
    }
    if (!throttled || attempt >= 2) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    await pause(Math.min(5000, Math.max(1000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)));
  }
};
