"use client";

// ─── UsageDetailModal — in-depth, read-only usage drill-down ──────────────────
//
// The Earnings panel on Home shows headline numbers (balance / spent / runway).
// This modal is the "open the books" view the operator reaches for when they
// want to reason about runway: burn rate, runway-by-cadence (mirrors the
// ClipperBudgetPanel table), a per-skill USDC breakdown (each installed paid
// clip skill + its per-run price), the agent's ACTUAL lifetime metered spend
// (settled to treasury + still-pending), and the daily-cap headroom.
//
// Read-only. It owns no mutations — it only reads usage via Convex queries and
// the static price catalog. When a query is unavailable (loading / no mint /
// no grouped-by-skill query exists) it degrades to "—" instead of guessing.
//
// Prop signature (so Home can open it):
//   <UsageDetailModal
//     open={boolean}
//     onClose={() => void}
//     mintAddress={string | null}        // null/empty → actual-spend rows show "—"
//     balanceUsdc={number}               // live wallet balance for runway math
//     burnRatePerDay={number}            // $/day burn (Home's dailyTokenCost / skill burn)
//     installedSkillIds={string[]}       // installed clip-skill ids
//   />

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  X, ExternalLink, ArrowDownLeft, ArrowUpRight, TrendingUp, Coins, Landmark, SlidersHorizontal, Gift,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CLIP_SKILL_BY_ID } from "@/lib/builder/clipSkillsCatalog";
import { clipSkillRunCostWithOverrides, effectiveUnitPrice } from "@/lib/economy/servicePrices";
import { formatSignedUsdc6 } from "@/lib/economy/format";
import { getTxExplorerUrl } from "@/lib/solana/network";
import {
  type TxHistoryRow,
  type TxHistoryKind,
  type OnchainUsdcTransfer,
  buildTransactionHistory,
  onchainTransfersToDepositRows,
} from "@/lib/economy/transactionHistory";

export interface UsageDetailModalProps {
  open: boolean;
  onClose: () => void;
  /** Agent mint. null/empty when unminted → actual-spend rows degrade to "—". */
  mintAddress: string | null;
  /** Agent's on-chain wallet (base58). Used to merge on-chain USDC deposits into
   *  the transaction history. Absent/undefined → history shows internal rows only. */
  agentWallet?: string | null;
  /** Live wallet balance (USDC) used for the runway math. */
  balanceUsdc: number;
  /** Operator's current burn rate in USDC per day. */
  burnRatePerDay: number;
  /** Installed clip-skill ids (the same list the budget / canvas use). */
  installedSkillIds: string[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Compact relative time ("just now" / "5m ago" / date). */
function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

const KIND_ICON: Record<TxHistoryKind, LucideIcon> = {
  deposit: ArrowDownLeft,
  revenue: TrendingUp,
  reward: Gift,
  adjustment: SlidersHorizontal,
  spend: Coins,
  sweep: ArrowUpRight,
  withdraw: ArrowUpRight,
  mint_fee: Landmark,
};

/** A settled-terminal status needs no badge; anything else (pending / failed) does. */
function statusBadge(status?: string): string | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "paid" || s === "minted") return null;
  return s;
}

// ─── Transaction history — the money-event ledger for the Earnings card ────────
// Unions the per-agent Convex tables (spend / sweep / withdraw / revenue /
// campaign reward / mint fee / adjustment) via api.agentAccount.transactionHistory, then merges in raw
// on-chain USDC deposits (which have NO Convex row) from the shared
// /api/solana/usdc-transfers route — deduped by signature so a swept/withdrawn tx
// isn't double-listed. Degrades gracefully: if that route 404s/errors (not yet
// deployed), the internal ledger still renders.
function TransactionHistorySection({
  open,
  mintAddress,
  agentWallet,
}: {
  open: boolean;
  mintAddress: string | null;
  agentWallet?: string | null;
}) {
  const internal = useQuery(
    api.agentAccount.transactionHistory,
    open && mintAddress ? { mintAddress } : "skip",
  ) as TxHistoryRow[] | undefined;

  const [onchainRows, setOnchainRows] = useState<TxHistoryRow[]>([]);
  useEffect(() => {
    if (!open || !agentWallet) {
      setOnchainRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/solana/usdc-transfers?wallet=${encodeURIComponent(agentWallet)}`);
        if (!res.ok) {
          if (!cancelled) setOnchainRows([]);
          return;
        }
        const data: unknown = await res.json();
        const transfers = (data as { transfers?: OnchainUsdcTransfer[] } | null)?.transfers;
        if (!cancelled) {
          setOnchainRows(
            Array.isArray(transfers) ? onchainTransfersToDepositRows(transfers, agentWallet) : [],
          );
        }
      } catch {
        // Route not deployed / network error → internal ledger only, no crash.
        if (!cancelled) setOnchainRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, agentWallet]);

  const merged = useMemo(
    () =>
      // Hide "Swept to treasury" (kind: "sweep") rows: the per-post fee already
      // shows as its own "Spent · …" row, so the redundant settlement of that
      // SAME charge would double-count it (one $0.05 post reading as −$0.10).
      buildTransactionHistory(internal ?? [], onchainRows, 100).filter((r) => r.kind !== "sweep"),
    [internal, onchainRows],
  );

  return (
    <section className="rounded-xl border-2 border-zinc-900/15 bg-white p-4 shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-serif text-[15px] font-bold text-zinc-900">Transaction history</h3>
        <span className="text-[11px] text-zinc-500">Spend · withdrawals · rewards · deposits</span>
      </div>
      {!mintAddress ? (
        <p className="py-3 text-[12px] text-zinc-400">Mint the agent to start recording transactions.</p>
      ) : internal === undefined ? (
        <p className="py-3 text-[12px] text-zinc-400">Loading transaction history…</p>
      ) : merged.length === 0 ? (
        <p className="py-3 text-[12px] text-zinc-400">No transactions yet.</p>
      ) : (
        <div className="max-h-[300px] overflow-y-auto -mx-1 px-1">
          {merged.map((r) => {
            const Icon = KIND_ICON[r.kind] ?? Coins;
            const credit = r.amountUsdc >= 0;
            const badge = statusBadge(r.status);
            return (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 border-b border-zinc-200/50 py-2.5 last:border-0"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${
                      credit
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-zinc-200 bg-zinc-50 text-zinc-500"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-zinc-800" title={r.label}>
                        {r.label}
                      </span>
                      {badge ? (
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${
                            badge === "failed"
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                        >
                          {badge}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] text-zinc-400">{relTime(r.ts)}</span>
                      {/* Reward rows carry the resolved IG/TikTok link so the
                          operator can open the exact post the reward paid on. */}
                      {r.postUrl ? (
                        <a
                          href={r.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View the post this reward paid out on"
                          className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-zinc-500 transition-colors hover:text-zinc-800"
                        >
                          view post
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`font-mono text-[13px] font-bold tabular-nums ${
                      credit ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {formatSignedUsdc6(r.amountUsdc)}
                  </span>
                  {r.txSignature ? (
                    <a
                      href={getTxExplorerUrl(r.txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View transaction on explorer"
                      className="text-zinc-400 transition-colors hover:text-zinc-700"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[11px] text-zinc-500">
        Newest first. Green is money in (deposits, revenue, campaign rewards); red is money out
        (spend, withdrawals, mint fee). On-chain items link to the explorer.
      </p>
    </section>
  );
}

/** Runway in whole days; null = infinite (no burn). */
function runwayDays(balance: number, perDay: number): number | null {
  if (!(perDay > 0)) return null;
  return Math.floor(balance / perDay);
}

/** Render a day count, mirroring ClipperBudgetPanel's ∞ / Nd convention. */
function fmtRunway(days: number | null): string {
  if (days === null) return "∞";
  if (days > 365) return "∞";
  return `${days}d`;
}

export default function UsageDetailModal({
  open,
  onClose,
  mintAddress,
  agentWallet,
  balanceUsdc,
  burnRatePerDay,
  installedSkillIds,
}: UsageDetailModalProps) {
  // Close on Escape — only while open so we don't fight other handlers.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ACTUAL spend (lifetime, aggregate). serviceSpendQuery sums every metered
  // usageLedger row (clips + tasks) and splits it into settled-to-treasury vs
  // still-pending. There is NO per-skill grouped query, so per-skill ACTUAL
  // spend below shows "—"; these aggregates are the real settled+pending tab.
  const serviceSpend = useQuery(
    api.usage.serviceSpendQuery,
    open && mintAddress ? { mintAddress } : "skip",
  );
  // Today's spend + the active daily cap (per-agent override, else env default).
  const today = useQuery(
    api.usage.todaysSpendQuery,
    open && mintAddress ? { mintAddress } : "skip",
  );
  // Admin price overrides (effective = override ?? static) so this breakdown
  // matches what the run actually charges. Hook runs before the early return.
  const priceOverrides = (useQuery(api.adminPricing.effectiveSkillPrices, open ? {} : "skip") as
    | { overrides: Record<string, number> } | undefined)?.overrides ?? {};

  if (!open) return null;

  const effPrice = (id: string) => effectiveUnitPrice(id, priceOverrides[id]) ?? 0;

  // ── Cost model (mirrors ClipperBudgetPanel) ───────────────────────────────
  const installed = [...new Set(installedSkillIds)];
  const pricedIds = installed.filter((id) => effPrice(id) > 0);
  const costPerRun = clipSkillRunCostWithOverrides(installed, priceOverrides);
  const runsPerDay = [1, 2, 3, 5, 10];

  const burn = Math.max(0, burnRatePerDay);
  const overallRunway = runwayDays(balanceUsdc, burn);

  // ── Actual spend aggregates (—-aware) ─────────────────────────────────────
  const haveSpend = serviceSpend != null;
  const settled = serviceSpend?.settledToTreasuryUsdc ?? 0;
  const pending = (serviceSpend?.pendingSettlementUsdc ?? 0) + (serviceSpend?.unsettledTabUsdc ?? 0);
  const totalSpent = serviceSpend?.totalSpentUsdc ?? 0;

  // ── Daily-cap status ──────────────────────────────────────────────────────
  const haveCap = today != null;
  const spentToday = today?.spentTodayUsdc ?? 0;
  const capUsdc = today?.capUsdc ?? 0;
  const capUncapped = haveCap && !(capUsdc > 0); // 0 / unset → no limit
  const capRemaining = capUncapped ? Infinity : Math.max(0, capUsdc - spentToday);
  const capPct = capUncapped || !(capUsdc > 0) ? 0 : Math.min(100, (spentToday / capUsdc) * 100);
  const capNearLimit = haveCap && !capUncapped && capRemaining < costPerRun;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Usage detail"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close usage detail"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-[1px]"
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-[560px] max-h-[88vh] overflow-y-auto rounded-xl border-2 border-zinc-900 bg-[#fffdf7] shadow-[6px_6px_0_0_#1c1c1f]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b-2 border-zinc-900 bg-[#fffdf7] px-5 py-4">
          <div>
            <h2 className="font-serif text-[20px] font-bold leading-none tracking-tight text-zinc-900">
              Usage detail
            </h2>
            <p className="mt-1 text-[11.5px] text-zinc-500">
              Read-only. Burn, runway, per-skill cost &amp; actual spend.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-2 border-zinc-900 bg-white text-zinc-900 shadow-[0_2px_0_0_rgba(0,0,0,0.06)] transition-transform hover:-translate-y-px active:translate-y-px"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* ── Burn + runway headline ─────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border-2 border-zinc-900/15 bg-white p-3 shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
              <div className="text-[10.5px] uppercase tracking-wide text-zinc-400">Balance</div>
              <div className="mt-1 font-mono text-[18px] font-bold tabular-nums text-zinc-900">
                {usd(balanceUsdc)}
              </div>
            </div>
            <div className="rounded-xl border-2 border-zinc-900/15 bg-white p-3 shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
              <div className="text-[10.5px] uppercase tracking-wide text-zinc-400">Burn / day</div>
              <div className="mt-1 font-mono text-[18px] font-bold tabular-nums text-zinc-900">
                {burn > 0 ? usd(burn) : "$0.00"}
              </div>
            </div>
            <div className="rounded-xl border-2 border-zinc-900/15 bg-white p-3 shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
              <div className="text-[10.5px] uppercase tracking-wide text-zinc-400">Runway</div>
              <div
                className={`mt-1 font-mono text-[18px] font-bold tabular-nums ${
                  overallRunway !== null && overallRunway < 3 ? "text-rose-700" : "text-zinc-900"
                }`}
              >
                {fmtRunway(overallRunway)}
              </div>
            </div>
          </div>

          {/* ── Runway by cadence (mirrors ClipperBudgetPanel) ──────────── */}
          <section className="rounded-xl border-2 border-zinc-900/15 bg-white p-4 shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-serif text-[15px] font-bold text-zinc-900">Runway by cadence</h3>
              <span className="text-[11px] text-zinc-500">
                {usd(costPerRun)} / run · wallet {usd(balanceUsdc)}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-zinc-200/70 py-1.5 text-[10.5px] uppercase tracking-wide text-zinc-400">
              <span className="w-20">Runs / day</span>
              <span>$ / day</span>
              <span>Runway</span>
            </div>
            {runsPerDay.map((rpd) => {
              const perDay = +(costPerRun * rpd).toFixed(2);
              const days = runwayDays(balanceUsdc, perDay);
              return (
                <div
                  key={rpd}
                  className="flex items-center justify-between border-b border-zinc-200/40 py-2 text-[13px] last:border-0"
                >
                  <span className="w-20 tabular-nums text-zinc-700">{rpd}</span>
                  <span className="font-mono tabular-nums text-zinc-700">{usd(perDay)}</span>
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      days !== null && days < 3 ? "text-rose-700" : "text-zinc-900"
                    }`}
                  >
                    {fmtRunway(days)}
                  </span>
                </div>
              );
            })}
            <p className="mt-3 text-[11px] text-zinc-500">
              Each run is charged once for the paid skills wired into the pipeline (install is
              free; render + transcription compute is included).
            </p>
          </section>

          {/* ── Per-skill USDC breakdown ───────────────────────────────── */}
          <section className="rounded-xl border-2 border-zinc-900/15 bg-white p-4 shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
            <div className="mb-1 flex items-baseline justify-between">
              <h3 className="font-serif text-[15px] font-bold text-zinc-900">Per-skill cost</h3>
              <span className="font-mono text-[13px] font-bold tabular-nums text-emerald-700">
                {usd(costPerRun)} / run
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-zinc-200/70 py-1.5 text-[10.5px] uppercase tracking-wide text-zinc-400">
              <span>Skill</span>
              <div className="flex items-center gap-6">
                <span className="w-16 text-right">$ / run</span>
                <span className="w-16 text-right">Actual</span>
              </div>
            </div>
            {installed.length === 0 ? (
              <p className="py-3 text-[12px] text-zinc-400">
                No skills installed. Add skills in the Marketplace to power up clips.
              </p>
            ) : pricedIds.length === 0 ? (
              <p className="py-3 text-[12px] text-zinc-400">
                No paid skills installed, runs are free.
              </p>
            ) : (
              pricedIds.map((id) => {
                const skill = CLIP_SKILL_BY_ID[id];
                const price = effPrice(id);
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between border-b border-zinc-200/40 py-2 text-[13px] last:border-0"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-zinc-700">
                      {skill?.icon ? <span aria-hidden>{skill.icon}</span> : null}
                      <span className="truncate">{skill?.name ?? id}</span>
                    </span>
                    <div className="flex items-center gap-6">
                      <span className="w-16 text-right font-mono tabular-nums text-zinc-700">
                        {usd(price)}
                      </span>
                      {/* No grouped-by-skill usage query exists → ACTUAL per-skill
                          spend is unavailable; degrade to "-" rather than fake it. */}
                      <span className="w-16 text-right font-mono tabular-nums text-zinc-300">-</span>
                    </div>
                  </div>
                );
              })
            )}
            <p className="mt-3 text-[11px] text-zinc-500">
              Per-skill price is the per-run fee. Actual settled/pending spend is tracked in
              aggregate below (not yet broken out per skill).
            </p>
          </section>

          {/* ── Actual lifetime spend (aggregate, from usageLedger) ──────── */}
          <section className="rounded-xl border-2 border-zinc-900/15 bg-white p-4 shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
            <h3 className="mb-2 font-serif text-[15px] font-bold text-zinc-900">Actual spend</h3>
            <div className="space-y-2 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Settled to treasury</span>
                <span className="font-mono tabular-nums text-zinc-900">
                  {haveSpend ? usd(settled) : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Pending (booked, not swept)</span>
                <span className="font-mono tabular-nums text-zinc-900">
                  {haveSpend ? usd(pending) : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-zinc-200/70 pt-2">
                <span className="font-semibold text-zinc-900">Lifetime total</span>
                <span className="font-mono font-bold tabular-nums text-zinc-900">
                  {haveSpend ? usd(totalSpent) : "-"}
                </span>
              </div>
            </div>
            {!mintAddress ? (
              <p className="mt-3 text-[11px] text-zinc-500">
                Mint the agent to start tracking actual spend.
              </p>
            ) : !haveSpend ? (
              <p className="mt-3 text-[11px] text-zinc-400">Loading actual spend…</p>
            ) : null}
          </section>

          {/* ── Transaction history (spend / sweep / withdraw / revenue /
                 mint fee / adjustment + on-chain deposits) ──────────────── */}
          <TransactionHistorySection open={open} mintAddress={mintAddress} agentWallet={agentWallet} />

          {/* ── Daily cap status ──────────────────────────────────────── */}
          <section className="rounded-xl border-2 border-zinc-900/15 bg-white p-4 shadow-[0_2px_0_0_rgba(0,0,0,0.06)]">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-serif text-[15px] font-bold text-zinc-900">Daily cap</h3>
              {haveCap ? (
                <span
                  className={`font-mono text-[12px] tabular-nums ${
                    capNearLimit ? "text-rose-700" : "text-zinc-600"
                  }`}
                >
                  {capUncapped
                    ? `${usd(spentToday)} today · no limit`
                    : `${usd(spentToday)} / ${usd(capUsdc)} today`}
                </span>
              ) : (
                <span className="font-mono text-[12px] text-zinc-300">-</span>
              )}
            </div>
            {haveCap && !capUncapped ? (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full border border-zinc-900/15 bg-zinc-100">
                  <div
                    className={`h-full rounded-full ${capNearLimit ? "bg-rose-500" : "bg-emerald-500"}`}
                    style={{ width: `${capPct}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">
                  {capNearLimit
                    ? `${usd(capRemaining)} left today, below one run (${usd(costPerRun)}); runs will be rate-capped until UTC midnight.`
                    : `${usd(capRemaining)} of today's cap remaining (resets at UTC midnight).`}
                </p>
              </>
            ) : haveCap ? (
              <p className="text-[11px] text-zinc-500">
                No daily spend limit set, runs are bounded only by wallet balance.
              </p>
            ) : (
              <p className="text-[11px] text-zinc-400">
                {mintAddress ? "Loading daily cap…" : "Mint the agent to set a daily cap."}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
