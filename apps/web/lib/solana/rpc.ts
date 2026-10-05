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
): Promise<T> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await fn(new Connection(url, "confirmed"));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Candidates for the active network. */
export function rpcCandidates(network?: ReturnType<typeof getNetwork>): string[] {
  return getRpcCandidates(network);
}
