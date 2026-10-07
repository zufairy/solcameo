import { ComputeBudgetProgram, Connection, type TransactionInstruction } from "@solana/web3.js";
import { getHeliusRpcUrl, getNetwork, getRpcUrl } from "./network";
import { rpcTry, rpcRace } from "./rpc";

/**
 * Getting a signed transaction on-chain quickly and cheaply, following the standard Solana landing recipe:
 *   1. a compute-unit limit sized to the transaction and a market-rate priority fee (not a blanket "max"),
 *   2. send once with preflight so real errors surface, then keep re-broadcasting the SAME signed bytes while polling,
 *   3. stop when the blockhash can no longer land, so the user is told "not sent, nothing was deducted" instead of
 *      waiting on a spinner,
 *   4. every network call has a deadline, so one hung RPC can never freeze the flow.
 */
const MIN_MICRO_LAMPORTS = 1_000;
const MAX_PRIORITY_LAMPORTS = 20_000; // never more than ~$0.003 of priority fee, whatever the network asks for

/** Clamp a price (micro-lamports per compute unit) so `units` of compute can never cost more than the ceiling. */
export function boundedPriorityPrice(microLamports: number, units: number): number {
  const ceiling = Math.floor((MAX_PRIORITY_LAMPORTS * 1_000_000) / Math.max(1, units));
  return Math.max(MIN_MICRO_LAMPORTS, Math.min(ceiling, Math.round(microLamports)));
}

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * Priority fee for the accounts a transaction writes. Helius's estimator when available (the "Medium" level lands
 * reliably at the lowest realistic cost), otherwise the median of recent fees on those accounts. Never throws.
 */
export async function estimatePriorityPrice(accountKeys: string[], units: number): Promise<number> {
  if (getNetwork() !== "mainnet-beta") return MIN_MICRO_LAMPORTS;
  try {
    const url = getHeliusRpcUrl("mainnet-beta");
    if (url) {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(2000),
        body: JSON.stringify({ jsonrpc: "2.0", id: "fee", method: "getPriorityFeeEstimate", params: [{ accountKeys: accountKeys.slice(0, 8), options: { priorityLevel: "Medium" } }] }),
      });
      const est = ((await res.json()) as { result?: { priorityFeeEstimate?: number } }).result?.priorityFeeEstimate;
      if (typeof est === "number" && est > 0) return boundedPriorityPrice(est, units);
    }
  } catch { /* fall through to the node's own view */ }
  try {
    const recent = await rpcTry([getRpcUrl("mainnet-beta")], (c) => c.getRecentPrioritizationFees(), 2500);
    return boundedPriorityPrice(median(recent.map((r) => r.prioritizationFee).filter((n) => n > 0)), units);
  } catch { return MIN_MICRO_LAMPORTS; }
}

/** The two compute-budget instructions that go at the front of the transaction. */
export const computeBudgetInstructions = (units: number, microLamports: number): TransactionInstruction[] => [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
];

export type LandResult = "confirmed" | "expired" | "pending";

/**
 * Keep a signed transaction in front of the validators until it confirms or can no longer land. Re-sending the
 * identical signed bytes is safe (same signature, so it can only execute once). Throws if the transaction landed and
 * FAILED. "expired" means the blockhash window passed without it landing, so nothing was deducted.
 */
export async function landTransaction(args: {
  raw: Uint8Array; signature: string; lastValidBlockHeight: number; urls: string[]; maxMs?: number; onTick?: (elapsedMs: number) => void;
}): Promise<LandResult> {
  const { raw, signature, lastValidBlockHeight, urls, maxMs = 75_000, onTick } = args;
  const start = Date.now();
  let lastSend = 0, lastHeight = 0;
  while (Date.now() - start < maxMs) {
    onTick?.(Date.now() - start);
    try {
      const { value } = await rpcRace(urls, (c) => c.getSignatureStatuses([signature], { searchTransactionHistory: true }),
        (result) => Boolean(result.value[0]?.err || result.value[0]?.confirmationStatus === "confirmed" || result.value[0]?.confirmationStatus === "finalized"));
      const status = value[0];
      if (status?.err) throw new Error(`The transaction failed on-chain: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return "confirmed";
    } catch (e) {
      if (e instanceof Error && /failed on-chain/.test(e.message)) throw e;
    }
    if (Date.now() - lastSend > 1500) {
      lastSend = Date.now();
      // Every endpoint gets the bytes, so the transaction reaches more leaders; a duplicate send is harmless.
      for (const url of urls) void rpcTry([url], (c: Connection) => c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }), 4000).catch(() => undefined);
    }
    if (Date.now() - lastHeight > 2500) {
      lastHeight = Date.now();
      try {
        const height = await rpcTry(urls, (c) => c.getBlockHeight("confirmed"), 3000);
        if (height > lastValidBlockHeight) {
          // One last look: it may have landed in the final slots.
          const reads = await Promise.allSettled([...new Set(urls)].map((url) =>
            rpcTry([url], (c) => c.getSignatureStatuses([signature], { searchTransactionHistory: true }), 2000)));
          const statuses = reads.flatMap((read) => read.status === "fulfilled" ? [read.value.value[0]] : []);
          const failed = statuses.find((status) => status?.err);
          if (failed) throw new Error(`The transaction failed on-chain: ${JSON.stringify(failed.err)}`);
          if (statuses.some((status) => status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized")) return "confirmed";
          // Included transactions can confirm after expiry. Unreadable or stale
          // nodes cannot prove the signature absent: keep it for recovery.
          return statuses.some(Boolean) || reads.some((read) => read.status === "rejected") ? "pending" : "expired";
        }
      } catch (e) {
        if (e instanceof Error && /failed on-chain/.test(e.message)) throw e;
        // An unreadable node cannot prove expiration; try again next round.
      }
    }
    await new Promise((r) => setTimeout(r, 450));
  }
  return "pending";
}
