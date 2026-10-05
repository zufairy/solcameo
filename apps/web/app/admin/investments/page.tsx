"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Loader2, RefreshCw, Coins, Users, Bot } from "lucide-react";
import { fmtUsd, shortAddr, timeAgo } from "@/components/admin/util";
import type { AdminInvestmentsResult } from "@/convex/adminEconomy";

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] px-5 py-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-zinc-600 text-[10px] uppercase tracking-widest">{icon}<span>{label}</span></div>
      <p className="text-[22px] font-mono font-black tabular-nums tracking-tight leading-none text-white">{value}</p>
    </div>
  );
}

export default function AdminInvestmentsPage() {
  const { accessToken } = useSupabaseAuth();
  const listInvestments = useAction(api.adminEconomy.listInvestments);
  const [data, setData] = useState<AdminInvestmentsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try { setErr(null); setData(await listInvestments({ accessToken })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to load"); }
  }, [accessToken, listInvestments]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  if (data === null) {
    if (err) {
      return (
        <div className="py-20 text-center text-[13px] text-zinc-600">
          Failed to load: <span className="text-amber-400">{err}</span>
          <div className="mt-3">
            <button onClick={() => void refresh()} className="text-emerald-400 hover:underline">Retry</button>
          </div>
        </div>
      );
    }
    return <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Kpi icon={<Coins className="size-3" />} label="Total invested" value={fmtUsd(data.summary.totalUsdc)} />
        <Kpi icon={<Users className="size-3" />} label="Unique investors" value={data.summary.uniqueInvestors.toString()} />
        <Kpi icon={<Bot className="size-3" />} label="Agents funded" value={data.summary.agentsFunded.toString()} />
      </div>

      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#18181c] flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-bold text-white">Investments</h2>
            <p className="text-[11.5px] text-zinc-600 mt-0.5">Latest 300 share purchases · click an agent for full history</p>
          </div>
          <div className="flex items-center gap-3">
            {err && <span className="text-[11px] text-amber-400">{err}</span>}
            <button onClick={() => void refresh()} className="text-zinc-600 hover:text-zinc-300 p-1.5 rounded-lg hover:bg-white/5"><RefreshCw className="size-3.5" /></button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
                <th className="py-3 px-4 text-left font-medium">Agent</th>
                <th className="py-3 px-4 text-left font-medium">Investor</th>
                <th className="py-3 px-4 text-right font-medium">Shares</th>
                <th className="py-3 px-4 text-right font-medium">USDC</th>
                <th className="py-3 px-4 text-right font-medium">Price</th>
                <th className="py-3 px-4 text-left font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={`${r.mintAddress}-${i}`} className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.015]">
                  <td className="py-3 px-4">
                    <Link href={`/admin/investments/${encodeURIComponent(r.mintAddress)}`} className="flex items-center gap-2.5 group">
                      <div className="size-7 rounded-full overflow-hidden bg-zinc-800 border border-[#27272a] shrink-0">
                        {r.agentAvatarUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={r.agentAvatarUrl} alt="" className="w-full h-full object-cover" />
                          : null}
                      </div>
                      <span className="font-semibold text-white group-hover:text-emerald-400 transition-colors">
                        {r.agentName ?? shortAddr(r.mintAddress)}
                      </span>
                    </Link>
                  </td>
                  <td className="py-3 px-4 font-mono text-zinc-500 text-[11px]">{shortAddr(r.investorWallet)}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{r.sharesBought.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{fmtUsd(r.usdcAmount)}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-500">${r.sharePrice.toFixed(4)}</td>
                  <td className="py-3 px-4 text-zinc-500">{timeAgo(r.investedAt)}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-zinc-700">No investments yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
