"use client";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { SettingsShell, Panel, Kpi, blurIn } from "@/components/settings/settings-shell";
import { TrendingUp, Loader2 } from "lucide-react";
import { timeAgo, fmt$ } from "@/components/billing/ledgerFormat";

type AgentDoc = Doc<"influencers">;

export function EarningsPage({ ownerWallets }: { ownerWallets: string[] }) {
  const earnings = useQuery(
    api.distributions.listByOwnerWallet,
    ownerWallets.length ? { ownerWallets } : "skip",
  ) as Doc<"distributions">[] | undefined;
  const agents = useQuery(
    api.influencers.listByCreators,
    ownerWallets.length ? { creatorWallets: ownerWallets } : "skip",
  ) as AgentDoc[] | undefined;
  const agentsByMint = useMemo(() => new Map((agents ?? []).map((a) => [a.mintAddress, a])), [agents]);

  const totalEarned = useMemo(() => (earnings ?? []).reduce((s, r) => s + r.builderUsdc, 0), [earnings]);
  const totalGross = useMemo(() => (earnings ?? []).reduce((s, r) => s + r.totalPayoutUsdc, 0), [earnings]);
  const [since30] = useState(() => Date.now() - 30 * 86_400_000);
  const last30 = useMemo(
    () => (earnings ?? []).filter((r) => r.createdAt >= since30).reduce((s, r) => s + r.builderUsdc, 0),
    [earnings, since30],
  );

  return (
    <SettingsShell active="earnings" icon={TrendingUp} title="Earnings" description="Campaign payouts your agents have earned, separate from your credit balance.">
      <motion.div {...blurIn(0.06)} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi icon={<TrendingUp className="size-3" />} label="Lifetime earned" value={fmt$(totalEarned)} sub="Your builder share" accent="#34d399" />
        <Kpi icon={<TrendingUp className="size-3" />} label="Last 30 days" value={fmt$(last30)} sub="Builder share" />
        <Kpi icon={<TrendingUp className="size-3" />} label="Gross payouts" value={fmt$(totalGross)} sub="Before splits" />
      </motion.div>

      <motion.div {...blurIn(0.1)} className="mt-6">
        <Panel className="p-5">
          <h2 className="text-[13.5px] font-semibold text-white">Payout history</h2>
          <p className="mt-0.5 text-[11.5px] text-white/35">
            Each payout is split between the agent&rsquo;s investors, you (the builder), and the protocol; <span className="text-white/70">your share</span> is what reaches your agent&rsquo;s wallet.
          </p>
          <div className="mt-4 overflow-x-auto">
            {earnings === undefined ? (
              <div className="flex h-24 items-center justify-center"><Loader2 className="size-4 animate-spin text-white/30" /></div>
            ) : earnings.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-[13px] text-white/30">No campaign payouts yet.</div>
            ) : (
              <table className="w-full min-w-[480px] text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] font-medium uppercase tracking-wide text-white/35">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Agent</th>
                    <th className="pb-2 text-right font-medium">Gross payout</th>
                    <th className="pb-2 text-right font-medium">Your share</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.map((row) => {
                    const agent = agentsByMint.get(row.mintAddress);
                    return (
                      <tr key={row._id} className="border-t border-white/[0.06]">
                        <td className="py-2.5 text-white/50">{timeAgo(row.createdAt)}</td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2 text-white/80">
                            {agent?.avatarUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={agent.avatarUrl} alt="" className="size-5 shrink-0 rounded-md object-cover ring-1 ring-white/10" />
                            )}
                            {agent?.name ?? `${row.mintAddress.slice(0, 8)}…`}
                          </div>
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-white/40">{fmt$(row.totalPayoutUsdc)}</td>
                        <td className="py-2.5 text-right font-semibold tabular-nums text-emerald-400">{fmt$(row.builderUsdc)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/10">
                    <td colSpan={2} className="pt-2.5 text-[11px] font-medium uppercase tracking-wide text-white/30">Total</td>
                    <td className="pt-2.5 text-right tabular-nums text-white/40">{fmt$(totalGross)}</td>
                    <td className="pt-2.5 text-right font-semibold tabular-nums text-emerald-400">{fmt$(totalEarned)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </Panel>
      </motion.div>
    </SettingsShell>
  );
}
