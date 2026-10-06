"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { SettingsShell, Panel, Kpi, blurIn } from "@/components/settings/settings-shell";
import {
  Zap, Plus, Wallet, Gem, Clapperboard, ArrowUpFromLine, Loader2, Receipt,
} from "lucide-react";
import WalletReceiveModal from "@/components/wallet/WalletReceiveModal";
import WithdrawModal from "@/components/builder/WithdrawModal";
import { computeSafeWithdrawable } from "@/lib/economy/safeWithdrawable";
import { investEnabled } from "@/lib/flags";
import { fmt$ } from "./ledgerFormat";

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
  const [depositOpen, setDepositOpen] = useState(false);

  const agents = useQuery(
    api.influencers.listByCreators,
    ownerWallets.length ? { creatorWallets: ownerWallets } : "skip",
  ) as AgentDoc[] | undefined;

  const agentWallets = useMemo(() => (agents ?? []).map((a) => a.agentWallet).filter((w): w is string => !!w), [agents]);
  const onChainBalances = useAgentWalletBalances(agentWallets);
  // The owner's own wallet, read live from chain: this is what Add funds tops up.
  const ownerBalances = useAgentWalletBalances(useMemo(() => (ownerWallet ? [ownerWallet] : []), [ownerWallet]));
  const ownerUsdc = ownerBalances.get(ownerWallet)?.usdc;

  const loadingAgents = ownerWallets.length > 0 && agents === undefined;
  const totalAgentBalance = useMemo(() => {
    if (agentWallets.length === 0) return 0;
    let sum = 0;
    for (const w of agentWallets) sum += onChainBalances.get(w)?.usdc ?? 0;
    return sum;
  }, [agentWallets, onChainBalances]);
  const balancesLoaded = agentWallets.length === 0 || agentWallets.every((w) => onChainBalances.has(w));
  const totalEarned = useMemo(() => (agents ?? []).reduce((n, a) => n + (a.lifetimeEarningsUsdc ?? 0), 0), [agents]);

  return (
    <SettingsShell
      active="billing"
      icon={Zap}
      title="Billing"
      description="Fund your wallet and manage the USDC your agents run on."
      actions={
        <button
          type="button"
          onClick={() => setDepositOpen(true)}
          className="flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white px-4 text-[13px] font-semibold text-black transition-colors hover:bg-white/90"
        >
          <Plus className="size-3.5" /> Add funds
        </button>
      }
    >
      {/* ── KPIs ── */}
      <motion.div {...blurIn(0.06)} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi icon={<Wallet className="size-3" />} label="Wallet balance" value={ownerUsdc != null ? fmt$(ownerUsdc) : "···"} sub="Your wallet, on-chain USDC" />
        <Kpi
          icon={<Gem className="size-3" />}
          label="Agents' balance"
          value={balancesLoaded ? fmt$(totalAgentBalance) : "…"}
          sub={`On-chain, across ${agents?.length ?? 0} agent${agents?.length === 1 ? "" : "s"}`}
        />
        <Kpi icon={<Receipt className="size-3" />} label="Total earned" value={agents ? fmt$(totalEarned) : "···"} sub="Agent earnings, all-time" />
      </motion.div>

      {/* ── Agent balances ── */}
      <motion.div {...blurIn(0.1)} className="mt-6">
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
        Withdrawals send on-chain USDC directly to the wallet that owns each agent.
      </p>

      <WalletReceiveModal open={depositOpen} address={ownerWallet} onClose={() => setDepositOpen(false)} />
    </SettingsShell>
  );
}
