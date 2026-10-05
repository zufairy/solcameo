"use client";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { SettingsShell, Panel, blurIn } from "@/components/settings/settings-shell";
import { Receipt, Loader2 } from "lucide-react";
import { LEDGER_KIND, LEDGER_ICON_FALLBACK, timeAgo, nf } from "./ledgerFormat";

type AgentDoc = Doc<"influencers">;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "purchase", label: "Purchases" },
  { id: "spend", label: "Spend" },
  { id: "refund", label: "Refunds" },
  { id: "signup_grant", label: "Bonuses" },
] as const;

export function BillingHistory({ ownerWallet, ownerWallets }: { ownerWallet: string; ownerWallets: string[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const ledger = useQuery(api.userCredits.listLedger, { ownerWallet, limit: 200 }) as Doc<"creditLedger">[] | undefined;
  const agents = useQuery(
    api.influencers.listByCreators,
    ownerWallets.length ? { creatorWallets: ownerWallets } : "skip",
  ) as AgentDoc[] | undefined;
  const agentsByMint = useMemo(() => new Map((agents ?? []).map((a) => [a.mintAddress, a])), [agents]);

  const visible = useMemo(() => {
    if (!ledger) return undefined;
    if (filter === "all") return ledger;
    if (filter === "spend") return ledger.filter((r) => r.kind === "spend");
    if (filter === "purchase") return ledger.filter((r) => r.kind === "purchase" || r.kind === "subscription_grant" || r.kind === "crypto_deposit");
    return ledger.filter((r) => r.kind === filter);
  }, [ledger, filter]);

  return (
    <SettingsShell active="history" icon={Receipt} title="History" description="Every credit transaction on this account: purchases, spend, refunds, and bonuses.">
      {/* Kind filter pills */}
      <motion.div {...blurIn(0.04)} className="flex w-fit items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${filter === f.id ? "bg-white text-black" : "text-white/50 hover:text-white/80"}`}
          >
            {f.label}
          </button>
        ))}
      </motion.div>

      <motion.div {...blurIn(0.08)} className="mt-4">
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            {visible === undefined ? (
              <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-white/30" /></div>
            ) : visible.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-[13px] text-white/30">No transactions in this filter yet.</div>
            ) : (
              <table className="w-full min-w-[560px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.02] text-left text-[10.5px] font-medium uppercase tracking-wide text-white/35">
                    <th className="px-5 py-3 font-medium">Activity</th>
                    <th className="px-5 py-3 font-medium">Agent</th>
                    <th className="px-5 py-3 text-right font-medium">Credits</th>
                    <th className="px-5 py-3 text-right font-medium">Balance after</th>
                    <th className="px-5 py-3 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const meta = LEDGER_KIND[row.kind] ?? { icon: LEDGER_ICON_FALLBACK, label: row.kind, tone: "neutral" as const };
                    const Icon = meta.icon;
                    const agent = row.relatedMintAddress ? agentsByMint.get(row.relatedMintAddress) : undefined;
                    return (
                      <tr key={row._id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015]">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className={`grid size-7 shrink-0 place-items-center rounded-lg border ${
                              meta.tone === "up" ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300" : "border-white/15 bg-white/[0.05] text-white/50"
                            }`}>
                              <Icon className="size-3.5" />
                            </span>
                            <span className="text-white/85">{meta.label}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-white/50">{agent?.name ?? "None"}</td>
                        <td className={`px-5 py-3 text-right font-semibold tabular-nums ${row.deltaCredits < 0 ? "text-white/60" : "text-emerald-400"}`}>
                          {row.deltaCredits > 0 ? "+" : ""}{nf(row.deltaCredits)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-white/40">{nf(row.balanceAfter)}</td>
                        <td className="px-5 py-3 text-right text-white/35 whitespace-nowrap">{timeAgo(row.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
      </motion.div>
    </SettingsShell>
  );
}
