"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { SettingsShell, Panel, Kpi, blurIn } from "@/components/settings/settings-shell";
import {
  Zap, Plus, Wallet, Gem, Clapperboard, ArrowUpFromLine, ArrowRight, Loader2, Receipt,
  CalendarClock, CheckCircle2, XCircle,
} from "lucide-react";
import { TopUpModal } from "./TopUpModal";
import WithdrawModal from "@/components/builder/WithdrawModal";
import { computeSafeWithdrawable } from "@/lib/economy/safeWithdrawable";
import { investEnabled } from "@/lib/flags";
import { SUBSCRIPTION_TIERS } from "@/lib/shared/creditPricing";
import { LEDGER_KIND, timeAgo, nf, fmt$ } from "./ledgerFormat";

const TIER_LABEL: Record<keyof typeof SUBSCRIPTION_TIERS, string> = { starter: "Starter", creator: "Creator", growth: "Growth" };

type SubscriptionInfo = {
  id: string;
  status: string;
  tier: keyof typeof SUBSCRIPTION_TIERS | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  amount: number | null;
  currency: string | null;
} | null;

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Current plan card — the piece a "proper" billing page needs that a bare
 *  credits ledger doesn't have: what plan you're on, when it renews, and a
 *  real Cancel (and Resume, if you change your mind before the period ends)
 *  action against the caller's own Stripe subscription (looked up by
 *  ownerWallet — see /api/billing/subscription, no local subscription table). */
function SubscriptionPanel() {
  const [sub, setSub] = useState<SubscriptionInfo | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = () => {
    fetch("/api/billing/subscription")
      .then((r) => r.json())
      .then((d) => setSub(d.subscription ?? null))
      .catch(() => setSub(null));
  };
  useEffect(load, []);

  async function toggleCancel(resume: boolean) {
    if (!sub) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: sub.id, resume }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setSub({ ...sub, cancelAtPeriodEnd: j.cancelAtPeriodEnd });
      setConfirmCancel(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13.5px] font-semibold text-white">Subscription</h2>
        {sub && (
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            sub.cancelAtPeriodEnd ? "bg-amber-400/10 text-amber-300" : "bg-emerald-400/10 text-emerald-300"
          }`}>
            {sub.cancelAtPeriodEnd ? <XCircle className="size-3" /> : <CheckCircle2 className="size-3" />}
            {sub.cancelAtPeriodEnd ? "Cancels at period end" : "Active"}
          </span>
        )}
      </div>

      {sub === undefined ? (
        <div className="mt-4 flex h-16 items-center"><Loader2 className="size-4 animate-spin text-white/30" /></div>
      ) : sub === null ? (
        <div className="mt-3">
          <p className="text-[12.5px] text-white/40">No active subscription. Subscribe to a plan for a bigger monthly credit grant.</p>
          <Link href="/pricing" className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-[12.5px] font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white">
            View plans <ArrowRight className="size-3.5" />
          </Link>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <p className="text-[22px] font-bold tracking-tight text-white">{sub.tier ? TIER_LABEL[sub.tier] : "Plan"}</p>
            {sub.amount != null && (
              <p className="text-[13px] text-white/45">
                ${(sub.amount / 100).toFixed(0)} / month
              </p>
            )}
          </div>
          {sub.currentPeriodEnd && (
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-white/40">
              <CalendarClock className="size-3.5 shrink-0" />
              {sub.cancelAtPeriodEnd ? "Access ends" : "Renews"} {fmtDate(sub.currentPeriodEnd)}
            </p>
          )}

          {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}

          {confirmCancel ? (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3.5">
              <p className="text-[12.5px] text-white/80">Cancel your subscription? You&apos;ll keep access until {sub.currentPeriodEnd ? fmtDate(sub.currentPeriodEnd) : "the end of this period"}, then it won&apos;t renew.</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleCancel(false)}
                  disabled={busy}
                  className="flex h-8 items-center gap-1.5 rounded-full bg-red-500/90 px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Confirm cancel
                </button>
                <button type="button" onClick={() => setConfirmCancel(false)} className="flex h-8 items-center rounded-full border border-white/10 px-3.5 text-[12.5px] font-medium text-white/60 hover:bg-white/[0.06]">
                  Keep plan
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              {sub.cancelAtPeriodEnd ? (
                <button
                  type="button"
                  onClick={() => void toggleCancel(true)}
                  disabled={busy}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] text-[12.5px] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Resume subscription
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmCancel(true)}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 text-[12.5px] font-medium text-white/50 transition-colors hover:border-red-500/30 hover:bg-red-500/[0.06] hover:text-red-300"
                >
                  Cancel subscription
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

type AgentDoc = Doc<"influencers">;
type OnChainBal = { usdc: number; sol: number } | null;

/** Live on-chain balance for a set of agent wallets, fetched once and shared
 *  across the KPI total and each agent row — avoids N duplicate fetches for
 *  the same wallet across the page. */
function useAgentWalletBalances(wallets: string[]): Map<string, OnChainBal> {
  const [balances, setBalances] = useState<Map<string, OnChainBal>>(new Map());
  const key = wallets.join(",");
  useEffect(() => {
    if (wallets.length === 0) return;
    let alive = true;
    Promise.all(
      wallets.map(async (w) => {
        try {
          const res = await fetch(`/api/agent-wallet-balance?wallet=${encodeURIComponent(w)}`);
          const d = (await res.json()) as { ok?: boolean; usdc?: number; sol?: number };
          return [w, d.ok ? { usdc: d.usdc ?? 0, sol: d.sol ?? 0 } : null] as const;
        } catch {
          return [w, null] as const;
        }
      }),
    ).then((entries) => { if (alive) setBalances(new Map(entries)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the stable identity for `wallets`
  }, [key]);
  return balances;
}

function AgentBalanceRow({ agent, onChain }: { agent: AgentDoc; onChain: OnChainBal | undefined }) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const isClipper = agent.agentType === "clipping";

  const ledger = useQuery(api.agentTasks.walletLedger, { mintAddress: agent.mintAddress }) as { reserved: number } | undefined;
  const serviceSpend = useQuery(api.usage.serviceSpendQuery, { mintAddress: agent.mintAddress }) as
    | { unsettledTabUsdc?: number; pendingSettlementUsdc?: number } | undefined;
  const accountNav = useQuery(api.agentAccount.getWithNav, { mintAddress: agent.mintAddress }) as
    | { sharesOutstanding?: number; navPerShare?: number } | null | undefined;

  const onChainBalance = onChain?.usdc ?? 0;
  const loadingBalance = onChain === undefined;
  const reserved = ledger?.reserved ?? 0;
  const unsettledTab = serviceSpend?.unsettledTabUsdc ?? 0;
  const pendingSettlement = serviceSpend?.pendingSettlementUsdc ?? 0;
  const sharesOutstanding = accountNav?.sharesOutstanding ?? 0;
  const navPerShareVal = accountNav?.navPerShare ?? 0;

  const safeWithdrawable = useMemo(
    () => computeSafeWithdrawable({
      real: onChainBalance, unsettledTab, pendingSettlement, reserved,
      sharesOutstanding, navPerShare: navPerShareVal, investEnabled: investEnabled(),
    }) ?? 0,
    [onChainBalance, unsettledTab, pendingSettlement, reserved, sharesOutstanding, navPerShareVal],
  );

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-xl transition-colors hover:bg-white/[0.06]">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={agent.avatarUrl} alt={agent.name} className="size-11 shrink-0 rounded-xl object-cover ring-1 ring-white/10" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13.5px] font-medium text-white">{agent.name}</p>
            <span title={isClipper ? "AI Clipper" : "AI Influencer"} className="grid size-5 shrink-0 place-items-center rounded-md border border-white/15 bg-white/[0.06] text-white/60">
              {isClipper ? <Clapperboard className="size-2.5" /> : <Gem className="size-2.5" />}
            </span>
          </div>
          <p className="truncate text-[11px] text-white/35">@{agent.handle}</p>
        </div>
      </div>

      <div className="flex items-center gap-4 border-t border-white/[0.06] pt-3">
        <div className="flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/30">On-chain</p>
          {loadingBalance ? <Loader2 className="mt-0.5 size-3.5 animate-spin text-white/25" /> : <p className="text-[14px] font-semibold tabular-nums text-white">{fmt$(onChainBalance)}</p>}
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/30">Withdrawable</p>
          <p className="text-[14px] font-semibold tabular-nums text-emerald-400">{fmt$(safeWithdrawable)}</p>
        </div>
        <button
          type="button"
          onClick={() => setWithdrawOpen(true)}
          disabled={loadingBalance || safeWithdrawable <= 0}
          title={safeWithdrawable <= 0 ? "Nothing available to withdraw yet" : "Withdraw to your wallet"}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ArrowUpFromLine className="size-3.5" /> Withdraw
        </button>
      </div>

      <WithdrawModal
        open={withdrawOpen}
        agentName={agent.name}
        agentWallet={agent.agentWallet ?? ""}
        ownerWallet={agent.creatorWallet}
        mintAddress={agent.mintAddress}
        safeWithdrawable={safeWithdrawable}
        onClose={() => setWithdrawOpen(false)}
      />
    </div>
  );
}

export function BillingOverview({ ownerWallet, ownerWallets }: { ownerWallet: string; ownerWallets: string[] }) {
  const [topUpOpen, setTopUpOpen] = useState(false);

  const balance = useQuery(api.userCredits.getBalance, { ownerWallet });
  const ledger = useQuery(api.userCredits.listLedger, { ownerWallet, limit: 6 }) as Doc<"creditLedger">[] | undefined;
  const agents = useQuery(
    api.influencers.listByCreators,
    ownerWallets.length ? { creatorWallets: ownerWallets } : "skip",
  ) as AgentDoc[] | undefined;

  const agentWallets = useMemo(() => (agents ?? []).map((a) => a.agentWallet).filter((w): w is string => !!w), [agents]);
  const onChainBalances = useAgentWalletBalances(agentWallets);

  const loadingAgents = ownerWallets.length > 0 && agents === undefined;
  const totalAgentBalance = useMemo(() => {
    if (agentWallets.length === 0) return 0;
    let sum = 0;
    for (const w of agentWallets) sum += onChainBalances.get(w)?.usdc ?? 0;
    return sum;
  }, [agentWallets, onChainBalances]);
  const balancesLoaded = agentWallets.length === 0 || agentWallets.every((w) => onChainBalances.has(w));

  return (
    <SettingsShell
      active="billing"
      icon={Zap}
      title="Billing"
      description="Your plan, prepaid credits, and agent wallets, all in one place."
      actions={
        <button
          type="button"
          onClick={() => setTopUpOpen(true)}
          className="flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white px-4 text-[13px] font-semibold text-black transition-colors hover:bg-white/90"
        >
          <Plus className="size-3.5" /> Add funds
        </button>
      }
    >
      {/* ── KPIs ── */}
      <motion.div {...blurIn(0.06)} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi icon={<Zap className="size-3" />} label="Credit balance" value={balance ? nf(balance.balanceCredits) : balance === null ? "0" : "···"} sub="For generations" />
        <Kpi
          icon={<Wallet className="size-3" />}
          label="Agents' balance"
          value={balancesLoaded ? fmt$(totalAgentBalance) : "…"}
          sub={`On-chain, across ${agents?.length ?? 0} agent${agents?.length === 1 ? "" : "s"}`}
        />
        <Kpi icon={<Receipt className="size-3" />} label="Lifetime purchased" value={balance ? nf(balance.totalPurchasedCredits) : balance === null ? "0" : "···"} sub="Credits, all-time" />
      </motion.div>

      {/* ── Subscription ── */}
      <motion.div {...blurIn(0.08)} className="mt-6">
        <SubscriptionPanel />
      </motion.div>

      {/* ── Credits ── */}
      <motion.div {...blurIn(0.1)} className="mt-6">
        <Panel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[13.5px] font-semibold text-white">Credits</h2>
              <p className="mt-0.5 text-[11.5px] text-white/35">Spent on generations, top up any time with one-time packs or a monthly plan.</p>
            </div>
            <div className="text-right">
              <p className="text-[26px] font-black tabular-nums leading-none text-white">{balance ? nf(balance.balanceCredits) : balance === null ? "0" : "···"}</p>
              <p className="text-[10.5px] text-white/35">credits</p>
            </div>
          </div>

          <div className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {ledger === undefined ? (
              <div className="flex h-16 items-center justify-center"><Loader2 className="size-4 animate-spin text-white/30" /></div>
            ) : ledger.length === 0 ? (
              <div className="flex h-16 items-center justify-center text-[13px] text-white/30">No credit activity yet.</div>
            ) : (
              ledger.map((row) => {
                const meta = LEDGER_KIND[row.kind] ?? { icon: Receipt, label: row.kind, tone: "neutral" as const };
                const Icon = meta.icon;
                return (
                  <div key={row._id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className={`grid size-6 shrink-0 place-items-center rounded-lg border ${
                        meta.tone === "up" ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300" : "border-white/15 bg-white/[0.05] text-white/50"
                      }`}>
                        <Icon className="size-3" />
                      </span>
                      <div>
                        <p className="text-[12.5px] text-white/85">{meta.label}</p>
                        <p className="text-[10.5px] text-white/30">{timeAgo(row.createdAt)}</p>
                      </div>
                    </div>
                    <p className={`text-[12.5px] font-semibold tabular-nums ${row.deltaCredits < 0 ? "text-white/60" : "text-emerald-400"}`}>
                      {row.deltaCredits > 0 ? "+" : ""}{nf(row.deltaCredits)}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          <Link href="/billing/history" className="mt-4 flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-[12.5px] font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white">
            View full history <ArrowRight className="size-3.5" />
          </Link>
        </Panel>
      </motion.div>

      {/* ── Agent balances ── */}
      <motion.div {...blurIn(0.14)} className="mt-6">
        <Panel className="p-5">
          <h2 className="text-[13.5px] font-semibold text-white">Agent balances</h2>
          <p className="mt-0.5 text-[11.5px] text-white/35">Live on-chain USDC per agent wallet. Withdrawable excludes the unsettled service tab, pending fees, and any investor-backed float.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {loadingAgents ? (
              <div className="col-span-full flex h-24 items-center justify-center"><Loader2 className="size-4 animate-spin text-white/30" /></div>
            ) : (agents?.length ?? 0) === 0 ? (
              <div className="col-span-full flex h-24 items-center justify-center text-[13px] text-white/30">No agents yet.</div>
            ) : (
              (agents ?? []).map((a) => (
                <AgentBalanceRow key={a._id} agent={a} onChain={a.agentWallet ? onChainBalances.get(a.agentWallet) : null} />
              ))
            )}
          </div>
        </Panel>
      </motion.div>

      <p className="mt-4 flex items-center gap-1.5 text-[10.5px] text-white/25">
        Withdrawals send on-chain USDC directly to the wallet that owns each agent. Funds never route through credits.
      </p>

      <TopUpModal open={topUpOpen} onClose={() => setTopUpOpen(false)} />
    </SettingsShell>
  );
}
