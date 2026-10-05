/**
 * Shared transaction-history normalization for the agent Earnings card.
 *
 * An agent's money moves through several per-agent Convex tables (metered spend,
 * escrow→treasury sweeps, owner withdrawals, revenue distributions, the mint
 * fee, admin adjustments) PLUS raw on-chain USDC deposits that have NO Convex
 * row (the deposit modal does a bare on-chain transfer). This module owns the
 * pure, runtime-free logic shared by both sides:
 *   - the Convex `agentAccount.transactionHistory` query (server) which unions
 *     the ledger tables, and
 *   - the Earnings-card UI (client) which merges in the on-chain deposits.
 *
 * Keep it dependency-free (no Convex, no React, no Node built-ins) so it imports
 * cleanly into both the Convex function runtime and the browser bundle. (The one
 * sibling import — `isPaidSig` — is itself a pure lib/economy module.)
 */

import { isPaidSig } from "./settlementSentinel";
import { agentNetUsdc } from "./format";

/** Machine kind for a normalized money event. */
export type TxHistoryKind =
  | "spend"
  | "sweep"
  | "withdraw"
  | "revenue"
  | "reward"
  | "mint_fee"
  | "adjustment"
  | "deposit";

/** One normalized money event. `amountUsdc` is SIGNED: + credit, − debit. */
export interface TxHistoryRow {
  /** Stable key for React + signature dedupe (a Convex doc id, or `deposit:<sig>`). */
  id: string;
  /** Event time, epoch milliseconds. */
  ts: number;
  kind: TxHistoryKind;
  /** Human label ("Spent · transcription", "Swept to treasury", "Deposit", …). */
  label: string;
  /** SIGNED USDC — positive = money in (credit), negative = money out (debit). */
  amountUsdc: number;
  token: "USDC";
  /** A REAL on-chain signature when the event settled on-chain. Never an
   *  INFLIGHT settlement sentinel — callers strip those before constructing the row. */
  txSignature?: string;
  /** Lifecycle badge for non-terminal events ("pending" | "failed" | "paid" | …). */
  status?: string;
  /** For reward rows: the live URL of the published post the reward paid out on
   *  (the resolved IG/TikTok link) so the UI can deep-link to the exact video. */
  postUrl?: string;
}

/** The subset of a `submissions` row the campaign-reward mapper reads. The
 *  crank's `claim_payout` credits the agent and records the result HERE
 *  (`paidUsdc` + `payoutTxSignature`), NOT in `distributions` — so reward
 *  payouts must be surfaced from this table or they're invisible in the ledger. */
export interface RewardSubmission {
  /** Convex submission id — the stable row key. */
  _id: string;
  /** USDC actually disbursed on-chain by claim_payout (mirror of ClaimRecord.paid).
   *  ≤ 0 / absent = nothing paid yet → no row. */
  paidUsdc?: number;
  /** The claim_payout signature: a real base58 sig when paid, an INFLIGHT
   *  sentinel while a claim is mid-flight, or undefined. Only a real sig surfaces. */
  payoutTxSignature?: string;
  /** Campaign name for the label, when the caller can resolve it cheaply. */
  campaignName?: string;
  /** Live URL of the published post this reward paid out on (IG/TikTok link),
   *  surfaced on the row so the operator can open the exact video. */
  postUrl?: string;
  /** Preferred event time; newest available wins (verified → posted → created). */
  verifiedAt?: number;
  postedAt?: number;
  _creationTime?: number;
}

/** Map a PAID campaign submission to an INCOMING "reward" row, or null when
 *  nothing has been disbursed on-chain yet (`paidUsdc` ≤ 0). `paidUsdc` is the
 *  GROSS accrued; `amountUsdc` is the agent's NET share (`agentNetUsdc`, after
 *  the 10% protocol fee) so the row equals what actually credited the agent
 *  wallet. The payout signature is attached ONLY when it's a real base58 sig
 *  (never an INFLIGHT settlement sentinel) so the row (a) deep-links to the
 *  explorer and (b) dedupes against the SAME payout's incoming on-chain
 *  transfer, which the client merges from /api/solana/usdc-transfers. */
export function submissionToRewardRow(sub: RewardSubmission): TxHistoryRow | null {
  const paid = Number(sub.paidUsdc ?? 0);
  if (!(paid > 0)) return null;
  const ts = sub.verifiedAt ?? sub.postedAt ?? sub._creationTime ?? Date.now();
  const realSig = isPaidSig(sub.payoutTxSignature) ? sub.payoutTxSignature : undefined;
  return {
    id: sub._id,
    ts,
    kind: "reward",
    label: sub.campaignName ? `Campaign reward · ${sub.campaignName}` : "Campaign reward",
    amountUsdc: +agentNetUsdc(paid),
    token: "USDC",
    ...(realSig ? { txSignature: realSig } : {}),
    ...(sub.postUrl ? { postUrl: sub.postUrl } : {}),
    status: "paid",
  };
}

/** The subset of a `/api/solana/usdc-transfers` transfer this module reads.
 *  Contract: `{ transfers: [{ signature, from, to, amountUsdc, blockTime, direction }] }`. */
export interface OnchainUsdcTransfer {
  signature: string;
  from?: string;
  to?: string;
  amountUsdc: number;
  /** Solana convention: seconds since epoch (or ms — auto-detected), null if unconfirmed. */
  blockTime?: number | null;
  direction?: "in" | "out";
}

/** Normalize a possibly-second-based blockTime to epoch ms (null/invalid → now). */
function blockTimeToMs(blockTime: number | null | undefined): number {
  if (typeof blockTime !== "number" || !Number.isFinite(blockTime)) return Date.now();
  // Solana returns seconds; anything past ~2001 in ms is already ms. 1e12 ms ≈ 2001.
  return blockTime > 1e12 ? blockTime : blockTime * 1000;
}

/** Sort newest-first by timestamp. Copies first — Convex query results are
 *  frozen, so an in-place sort would throw. */
export function sortTxHistoryDesc(rows: TxHistoryRow[]): TxHistoryRow[] {
  return rows.slice().sort((a, b) => b.ts - a.ts);
}

/** Drop rows whose on-chain signature was already seen. First occurrence wins,
 *  so callers put the AUTHORITATIVE source (the internal ledger) FIRST and the
 *  derived on-chain rows second — a swept / withdrawn / revenue tx that surfaces
 *  in both is listed once, using the richer internal row. Rows without a
 *  signature (internal-only spend, pending sweeps) are always kept. */
export function dedupeTxBySignature(rows: TxHistoryRow[]): TxHistoryRow[] {
  const seen = new Set<string>();
  const out: TxHistoryRow[] = [];
  for (const r of rows) {
    const sig = r.txSignature;
    if (sig) {
      if (seen.has(sig)) continue;
      seen.add(sig);
    }
    out.push(r);
  }
  return out;
}

/** Map on-chain USDC transfers to INCOMING "Deposit" rows. Outgoing transfers
 *  (sweeps / withdrawals) are dropped — those already have authoritative internal
 *  rows and would only duplicate. `direction` is preferred; when absent it's
 *  inferred from `to === agentWallet`. */
export function onchainTransfersToDepositRows(
  transfers: OnchainUsdcTransfer[],
  agentWallet?: string,
): TxHistoryRow[] {
  const rows: TxHistoryRow[] = [];
  for (const t of transfers) {
    if (!t || !t.signature) continue;
    const incoming = t.direction
      ? t.direction === "in"
      : agentWallet != null && t.to === agentWallet;
    if (!incoming) continue;
    const amt = Number(t.amountUsdc);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    rows.push({
      id: `deposit:${t.signature}`,
      ts: blockTimeToMs(t.blockTime),
      kind: "deposit",
      label: "Deposit",
      amountUsdc: amt,
      token: "USDC",
      txSignature: t.signature,
      status: "paid",
    });
  }
  return rows;
}

/** Merge the internal ledger history with derived on-chain deposit rows into the
 *  final list: internal rows first (they win the signature dedupe), dedupe,
 *  sort newest-first, then cap. The Convex query uses the same pipeline with an
 *  empty on-chain group; the UI passes the fetched deposits. `cap <= 0` = no cap. */
export function buildTransactionHistory(
  internalRows: TxHistoryRow[],
  onchainRows: TxHistoryRow[] = [],
  cap = 100,
): TxHistoryRow[] {
  const merged = dedupeTxBySignature([...internalRows, ...onchainRows]);
  const sorted = sortTxHistoryDesc(merged);
  return cap > 0 ? sorted.slice(0, cap) : sorted;
}
