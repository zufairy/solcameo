import { Connection, type Commitment } from "@solana/web3.js";
import { getNetwork } from "./network";
import { rpcCandidates } from "./rpc";

/**
 * A `Connection` that survives one bad endpoint. Every JSON-RPC request is tried on the primary (QuickNode) first and, if that
 * endpoint times out, drops the connection, rate-limits (429), rejects the key (401/403) or errors (5xx), the SAME request is
 * sent to the next endpoint (Helius, then the public cluster). JSON-RPC over HTTP is stateless, so this is safe for reads and
 * for sending a signed transaction (the same bytes carry the same signature, so it can only execute once).
 *
 * This is what makes "all RPC goes through the new provider" true without any single point of failure: code that built a
 * `new Connection(oneUrl)` failed a whole generation payment whenever that one endpoint had a bad second.
 */
const RETRYABLE = new Set([401, 403, 408, 425, 429, 500, 502, 503, 504]);

export function failoverFetch(urls: string[], timeoutMs = 6000, base: typeof fetch = fetch): typeof fetch {
  return async (_input, init) => {
    let last: Response | undefined;
    let lastError: unknown;
    for (const url of urls) {
      try {
        const res = await base(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (!RETRYABLE.has(res.status)) return res;
        last = res; // keep it: if every endpoint fails, the caller still sees a real HTTP error rather than nothing
      } catch (e) {
        lastError = e;
      }
    }
    if (last) return last;
    throw lastError instanceof Error ? lastError : new Error("All RPC endpoints failed");
  };
}

export function failoverConnection(opts: { network?: ReturnType<typeof getNetwork>; commitment?: Commitment; timeoutMs?: number } = {}): Connection {
  const urls = rpcCandidates(opts.network);
  return new Connection(urls[0], { commitment: opts.commitment ?? "confirmed", fetch: failoverFetch(urls, opts.timeoutMs), disableRetryOnRateLimit: true });
}
