/**
 * RPC failover helpers.
 *
 * One devnet Helius key dying (HTTP 403 "subscription suspended") broke EVERYTHING
 * that constructed a single Connection from it — balance reads returned $0, funding
 * transfers failed before broadcast, deposits never landed. These helpers run an
 * operation against an ordered list of RPC endpoints (public first on devnet, Helius
 * first on mainnet) and retry on the next candidate whenever the current one throws
 * a network / rate-limit / suspension error. Safe for the signing path too: all
 * endpoints are the same cluster, so blockhashes stay valid across candidates.
 */
import { Connection } from "@solana/web3.js";
import { getRpcCandidates, getNetwork } from "./network";

/** Try `fn` against each candidate RPC until one succeeds; throw the last error. */
export async function rpcTry<T>(
  urls: string[],
  fn: (conn: Connection) => Promise<T>,
  /** Per-endpoint deadline. A hung RPC used to freeze the caller forever; now it fails over after this long. */
  timeoutMs = 8000,
): Promise<T> {
  let lastError: unknown;
  for (const url of urls) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(new Connection(url, "confirmed")),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("RPC timeout")), timeoutMs); }),
      ]);
    } catch (e) {
      lastError = e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Candidates for the active network. */
export function rpcCandidates(network?: ReturnType<typeof getNetwork>): string[] {
  const n = network ?? getNetwork();
  // The browser path keeps the shared public endpoint as a last resort behind the dedicated one, so a hiccup (or a
  // rate limit on the public Helius key) can't stop a transfer from landing.
  const publicUrl = n === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : n === "testnet" ? "https://api.testnet.solana.com" : "https://api.devnet.solana.com";
  return [...new Set([...getRpcCandidates(n), publicUrl])];
}

/** Race independent RPC reads. A stale/null response must not win when a
 * caller needs positive evidence (for example a confirmed payment). */
export async function rpcRace<T>(
  urls: string[], fn: (conn: Connection) => Promise<T>,
  accept: (value: T) => boolean = () => true, timeoutMs = 2000,
): Promise<T> {
  return Promise.any([...new Set(urls)].map(async (url) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        fn(new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true })),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("RPC timeout")), timeoutMs); }),
      ]);
      if (!accept(value)) throw new Error("RPC has no matching evidence yet");
      return value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }));
}
