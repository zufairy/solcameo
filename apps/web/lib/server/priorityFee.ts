import { getHeliusRpcUrl } from "@/lib/solana/network";

const DEFAULT_MICRO_LAMPORTS = 100_000;
const MIN_MICRO_LAMPORTS = 20_000;
const MAX_MICRO_LAMPORTS = 3_000_000;
/** Never let one swap pay more than this in priority fees (lamports), whatever the network asks for. */
export const MAX_PRIORITY_LAMPORTS = 5_000_000;
const TTL_MS = 4000;
const cache = new Map<string, { at: number; value: number }>();

/** Clamp a price so `units` of compute can never cost more than the lamport ceiling. */
export function boundedPrice(microLamports: number, units: number): number {
  const ceiling = Math.floor((MAX_PRIORITY_LAMPORTS * 1_000_000) / Math.max(1, units));
  return Math.max(MIN_MICRO_LAMPORTS, Math.min(MAX_MICRO_LAMPORTS, ceiling, Math.round(microLamports)));
}

/**
 * Market-rate priority fee for the accounts a swap touches, from Helius's estimator (mainnet only). A busy launch
 * should not leave a trader's exit stuck behind a fixed fee; any failure falls back to the old fixed price.
 */
export async function priorityFeeMicroLamports(network: "mainnet" | "devnet", accountKeys: string[]): Promise<number> {
  if (network !== "mainnet") return DEFAULT_MICRO_LAMPORTS;
  const url = getHeliusRpcUrl("mainnet-beta");
  if (!url) return DEFAULT_MICRO_LAMPORTS;
  const key = accountKeys.slice(0, 8).join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(2000),
      body: JSON.stringify({ jsonrpc: "2.0", id: "fee", method: "getPriorityFeeEstimate", params: [{ accountKeys: accountKeys.slice(0, 8), options: { priorityLevel: "High" } }] }),
    });
    const json = (await res.json()) as { result?: { priorityFeeEstimate?: number } };
    const est = json.result?.priorityFeeEstimate;
    const value = typeof est === "number" && Number.isFinite(est) && est > 0 ? Math.round(est) : DEFAULT_MICRO_LAMPORTS;
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch { return DEFAULT_MICRO_LAMPORTS; }
}
