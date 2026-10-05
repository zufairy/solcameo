/**
 * Pure normalization for on-chain USDC transfer history.
 *
 * Two source shapes collapse into the same {@link UsdcTransfer} row:
 *   1. Helius Enhanced Transactions API — pre-parsed `tokenTransfers`
 *      (fromUserAccount / toUserAccount / mint / tokenAmount).
 *   2. web3.js `getParsedTransactions` — diffed pre/post token balances per
 *      owner (a signed USDC delta + its counterparty).
 *
 * Kept dependency-free (no web3.js, no fetch) so the direction / USDC-filter /
 * counterparty logic is unit-testable in isolation. The route
 * (app/api/solana/usdc-transfers) adapts the live payloads into these shapes.
 */

export interface UsdcTransfer {
  signature: string;
  /** Sender wallet (owner), or null when it couldn't be resolved. */
  from: string | null;
  /** Recipient wallet (owner), or null when it couldn't be resolved. */
  to: string | null;
  /** Positive UI amount of USDC moved (decimal-adjusted, 6dp). */
  amountUsdc: number;
  /** Unix seconds, or null when unknown. */
  blockTime: number | null;
  /** Relative to the queried wallet: money IN (received) or OUT (sent). */
  direction: "in" | "out";
}

// ── Helius Enhanced Transactions shape (only the fields we read) ──────────────
export interface HeliusTokenTransfer {
  fromUserAccount?: string | null;
  toUserAccount?: string | null;
  mint?: string | null;
  /** UI amount (already decimal-adjusted by Helius), e.g. 1.5 for 1.5 USDC. */
  tokenAmount?: number | string | null;
}
export interface HeliusEnrichedTx {
  signature?: string | null;
  /** Unix seconds. */
  timestamp?: number | null;
  tokenTransfers?: HeliusTokenTransfer[] | null;
}

// ── web3.js getParsedTransactions shape (adapted, only what we diff) ──────────
export interface TokenBalanceEntry {
  /** The token account's owner wallet. */
  owner: string | null;
  mint: string;
  /** uiTokenAmount.uiAmount (decimal-adjusted), or 0 when null. */
  uiAmount: number;
}
export interface ParsedTxLike {
  signature: string;
  blockTime: number | null;
  preTokenBalances: TokenBalanceEntry[];
  postTokenBalances: TokenBalanceEntry[];
}

function toNum(v: number | string | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Round to USDC's 6 decimals to shed float-diff noise before comparing. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Map Helius enriched txs → USDC transfer rows for `wallet`.
 * Keeps ONLY USDC-mint transfers where `wallet` is the sender or the receiver;
 * `direction` is relative to `wallet` (sender → "out", receiver → "in").
 */
export function normalizeHeliusTransfers(
  txs: HeliusEnrichedTx[],
  wallet: string,
  usdcMint: string,
): UsdcTransfer[] {
  const out: UsdcTransfer[] = [];
  for (const tx of txs) {
    const signature = tx.signature ?? "";
    if (!signature) continue;
    const blockTime = typeof tx.timestamp === "number" ? tx.timestamp : null;
    for (const t of tx.tokenTransfers ?? []) {
      if ((t.mint ?? "") !== usdcMint) continue; // USDC-only
      const from = t.fromUserAccount ?? null;
      const to = t.toUserAccount ?? null;
      const isOut = from === wallet;
      const isIn = to === wallet;
      if (!isOut && !isIn) continue; // wallet is not a party to this transfer
      const amountUsdc = round6(Math.abs(toNum(t.tokenAmount)));
      if (amountUsdc <= 0) continue;
      out.push({ signature, from, to, amountUsdc, blockTime, direction: isOut ? "out" : "in" });
    }
  }
  return out;
}

/**
 * Diff pre/post USDC token balances per owner to recover the signed transfer
 * amount for `wallet` and resolve its counterparty. Skips any tx that didn't
 * change `wallet`'s USDC balance. `direction` is relative to `wallet`.
 */
export function normalizeParsedTransfers(
  txs: ParsedTxLike[],
  wallet: string,
  usdcMint: string,
): UsdcTransfer[] {
  const out: UsdcTransfer[] = [];
  for (const tx of txs) {
    // Net USDC delta per owner across this tx (post − pre).
    const deltas = new Map<string, number>();
    const add = (owner: string | null, amt: number) => {
      if (!owner) return;
      deltas.set(owner, (deltas.get(owner) ?? 0) + amt);
    };
    for (const b of tx.preTokenBalances) if (b.mint === usdcMint) add(b.owner, -b.uiAmount);
    for (const b of tx.postTokenBalances) if (b.mint === usdcMint) add(b.owner, b.uiAmount);

    const myDelta = round6(deltas.get(wallet) ?? 0);
    if (Math.abs(myDelta) < 1e-9) continue; // our USDC balance didn't move
    const amountUsdc = round6(Math.abs(myDelta));
    const direction: "in" | "out" = myDelta > 0 ? "in" : "out";

    // Counterparty = the opposite-sign owner whose |delta| best matches the
    // amount (a token transfer deducts fees in SOL, not USDC, so magnitudes
    // match exactly — but we tolerate the closest match for multi-leg txs).
    let counterparty: string | null = null;
    let bestDiff = Infinity;
    for (const [owner, raw] of deltas) {
      if (owner === wallet) continue;
      const d = round6(raw);
      if (d === 0 || Math.sign(d) === Math.sign(myDelta)) continue; // must be opposite sign
      const diff = Math.abs(Math.abs(d) - amountUsdc);
      if (diff < bestDiff) {
        bestDiff = diff;
        counterparty = owner;
      }
    }

    const from = direction === "in" ? counterparty : wallet;
    const to = direction === "in" ? wallet : counterparty;
    out.push({ signature: tx.signature, from, to, amountUsdc, blockTime: tx.blockTime, direction });
  }
  return out;
}

/**
 * Collapse duplicate rows. The SAME wallet↔wallet transfer surfaces twice when
 * both parties are tracked (once as the sender's "out", once as the receiver's
 * "in") — they share signature + from + to + amount, so that tuple is the key.
 * A single tx with two DISTINCT USDC legs keeps both (different from/to).
 */
export function dedupeTransfers(transfers: UsdcTransfer[]): UsdcTransfer[] {
  const seen = new Set<string>();
  const out: UsdcTransfer[] = [];
  for (const t of transfers) {
    const key = `${t.signature}|${t.from ?? ""}|${t.to ?? ""}|${t.amountUsdc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
