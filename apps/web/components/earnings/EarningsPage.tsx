"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { SettingsShell, Panel, Kpi, blurIn } from "@/components/settings/settings-shell";
import { ArrowUpRight, Coins, Crown, Layers, Loader2, TrendingUp } from "lucide-react";
import { timeAgo, fmt$ } from "@/components/billing/ledgerFormat";

type AgentDoc = Doc<"influencers">;
const DAY = 86_400_000;

export function EarningsPage({ ownerWallets }: { ownerWallets: string[] }) {
  const earnings = useQuery(api.distributions.listByOwnerWallet, ownerWallets.length ? { ownerWallets } : "skip") as Doc<"distributions">[] | undefined;
  const agents = useQuery(api.influencers.listByCreators, ownerWallets.length ? { creatorWallets: ownerWallets } : "skip") as AgentDoc[] | undefined;
  const agentsByMint = useMemo(() => new Map((agents ?? []).map((a) => [a.mintAddress, a])), [agents]);
  const [now] = useState(() => Date.now());

  const rows = useMemo(() => earnings ?? [], [earnings]);
  const totalEarned = useMemo(() => rows.reduce((s, r) => s + r.builderUsdc, 0), [rows]);
  const totalGross = useMemo(() => rows.reduce((s, r) => s + r.totalPayoutUsdc, 0), [rows]);
  const last30 = useMemo(() => rows.filter((r) => r.createdAt >= now - 30 * DAY).reduce((s, r) => s + r.builderUsdc, 0), [rows, now]);

  // Builder share per day for the last 30 days, oldest first.
  const daily = useMemo(() => {
    const buckets = Array.from({ length: 30 }, (_, i) => ({ day: new Date(now - (29 - i) * DAY), value: 0 }));
    for (const r of rows) {
      const idx = 29 - Math.floor((now - r.createdAt) / DAY);
      if (idx >= 0 && idx < 30) buckets[idx].value += r.builderUsdc;
    }
    return buckets;
  }, [rows, now]);
  const maxDay = Math.max(0.0001, ...daily.map((d) => d.value));

  const byAgent = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.mintAddress, (m.get(r.mintAddress) ?? 0) + r.builderUsdc);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [rows]);
  const top = byAgent[0];
  const topAgent = top ? agentsByMint.get(top[0]) : undefined;
  const loading = earnings === undefined;

  return (
    <SettingsShell active="earnings" icon={TrendingUp} title="Earnings" description="Campaign payouts your agents have earned, separate from your credit balance.">
      <motion.div {...blurIn(0.06)} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<TrendingUp className="size-3" />} label="Lifetime earned" value={fmt$(totalEarned)} sub="Your builder share" accent="#34d399" />
        <Kpi icon={<TrendingUp className="size-3" />} label="Last 30 days" value={fmt$(last30)} sub="Builder share" />
        <Kpi icon={<Layers className="size-3" />} label="Payouts" value={String(rows.length)} sub={`${fmt$(totalGross)} gross`} />
        <Kpi icon={<Crown className="size-3" />} label="Top agent" value={topAgent?.name ?? "None yet"} sub={top ? `${fmt$(top[1])} earned` : "Earns after a payout"} />
      </motion.div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <motion.div {...blurIn(0.1)} className="lg:col-span-3">
          <Panel className="h-full p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[13.5px] font-semibold text-white">Last 30 days</h2>
                <p className="mt-0.5 text-[11.5px] text-white/40">Your builder share, per day</p>
              </div>
              <p className="text-[20px] font-semibold tabular-nums text-emerald-400">{fmt$(last30)}</p>
            </div>
            <div className="mt-6 flex h-40 items-end gap-1" role="img" aria-label="Daily earnings for the last 30 days">
              {daily.map((d, i) => (
                <div key={i} title={`${d.day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${fmt$(d.value)}`} className="group flex h-full min-w-0 flex-1 flex-col justify-end">
                  <div className={`w-full rounded-t-[3px] transition-colors ${d.value > 0 ? "bg-emerald-400/80 group-hover:bg-emerald-300" : "bg-white/[0.06]"}`} style={{ height: `${d.value > 0 ? Math.max(6, (d.value / maxDay) * 100) : 4}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10.5px] text-white/30"><span>{daily[0].day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span>Today</span></div>
          </Panel>
        </motion.div>

        <motion.div {...blurIn(0.14)} className="lg:col-span-2">
          <Panel className="h-full p-5">
            <h2 className="text-[13.5px] font-semibold text-white">Earnings by agent</h2>
            <p className="mt-0.5 text-[11.5px] text-white/40">Lifetime builder share</p>
            <div className="mt-4 space-y-3">
              {loading ? <div className="flex h-24 items-center justify-center"><Loader2 className="size-4 animate-spin text-white/30" /></div>
                : byAgent.length === 0 ? <p className="py-8 text-center text-[13px] text-white/30">No agent has earned yet.</p>
                : byAgent.map(([mint, value]) => {
                  const a = agentsByMint.get(mint);
                  return (
                    <div key={mint}>
                      <div className="flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="flex min-w-0 items-center gap-2 text-white/85">
                          {a?.avatarUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={a.avatarUrl} alt="" className="size-6 shrink-0 rounded-md object-cover ring-1 ring-white/10" />}
                          <span className="truncate font-semibold">{a?.name ?? `${mint.slice(0, 8)}…`}</span>
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-emerald-400">{fmt$(value)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${Math.max(4, (value / (byAgent[0]?.[1] || 1)) * 100)}%` }} /></div>
                    </div>
                  );
                })}
            </div>
          </Panel>
        </motion.div>
      </div>

      <motion.div {...blurIn(0.18)} className="mt-6 flex flex-1 flex-col">
        <Panel className="flex flex-1 flex-col p-5">
          <h2 className="text-[13.5px] font-semibold text-white">Payout history</h2>
          <p className="mt-0.5 text-[11.5px] text-white/40">
            Each payout is split between the agent&rsquo;s investors, you (the builder), and the protocol; <span className="text-white/70">your share</span> is what reaches your agent&rsquo;s wallet.
          </p>
          <div className="mt-4 flex flex-1 flex-col overflow-x-auto">
            {loading ? (
              <div className="flex flex-1 items-center justify-center"><Loader2 className="size-4 animate-spin text-white/30" /></div>
            ) : rows.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
                <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]"><Coins className="size-5 text-white/40" /></span>
                <p className="text-[13px] text-white/50">No campaign payouts yet.</p>
                <Link href="/agents" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#d7ff00] hover:underline">Browse campaigns <ArrowUpRight className="size-3.5" /></Link>
              </div>
            ) : (
              <table className="w-full min-w-[480px] text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] font-medium uppercase tracking-wide text-white/35">
                    <th className="pb-2 font-medium">Date</th><th className="pb-2 font-medium">Agent</th>
                    <th className="pb-2 text-right font-medium">Gross payout</th><th className="pb-2 text-right font-medium">Your share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const agent = agentsByMint.get(row.mintAddress);
                    return (
                      <tr key={row._id} className="border-t border-white/[0.06]">
                        <td className="py-2.5 text-white/50">{timeAgo(row.createdAt)}</td>
                        <td className="py-2.5"><div className="flex items-center gap-2 text-white/80">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {agent?.avatarUrl && <img src={agent.avatarUrl} alt="" className="size-5 shrink-0 rounded-md object-cover ring-1 ring-white/10" />}
                          {agent?.name ?? `${row.mintAddress.slice(0, 8)}…`}
                        </div></td>
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
