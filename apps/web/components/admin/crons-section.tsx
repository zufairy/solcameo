"use client";

import { useMemo, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Loader2, Zap, Power } from "lucide-react";
import { cronLabel, dueLabel, timeAgo, CRON_OPTIONS } from "./util";

type AgentDoc = {
  mintAddress: string; name: string; handle: string; avatarUrl: string; agentType?: string;
  heartbeatEnabled?: boolean; heartbeatCron?: string; heartbeatLastFiredAt?: number;
};

export function CronsSection() {
  const { accessToken } = useSupabaseAuth();
  const docs = (useQuery(api.influencers.listAll, {}) ?? []) as unknown as AgentDoc[];
  const setHeartbeat = useAction(api.admin.setAgentHeartbeat);
  const fireNow = useAction(api.admin.fireHeartbeatNow);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      docs
        .map((a) => ({
          mintAddress: a.mintAddress,
          name: a.name,
          handle: a.handle,
          avatarUrl: a.avatarUrl,
          enabled: a.heartbeatEnabled === true,
          cron: a.heartbeatCron ?? "manual",
          lastFiredAt: a.heartbeatLastFiredAt ?? null,
        }))
        .sort((x, y) => Number(y.enabled) - Number(x.enabled)),
    [docs],
  );

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(null); }
  }

  const enabledCount = rows.filter((r) => r.enabled).length;

  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#18181c] flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-white">Cron heartbeats</h2>
          <p className="text-[11.5px] text-zinc-600 mt-0.5">
            {enabledCount} of {rows.length} agents enabled · scheduler polls every minute
          </p>
        </div>
        {err && <span className="text-[11px] text-amber-400">{err}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
              <th className="py-3 px-4 text-left font-medium">Agent</th>
              <th className="py-3 px-4 text-left font-medium">Interval</th>
              <th className="py-3 px-4 text-left font-medium">Last fired</th>
              <th className="py-3 px-4 text-left font-medium">Next</th>
              <th className="py-3 px-4 text-left font-medium">State</th>
              <th className="py-3 px-4 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.mintAddress} className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.015]">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5">
                    <div className="size-7 rounded-lg overflow-hidden border border-[#27272a] shrink-0 bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="w-full h-full object-cover" /> : null}
                    </div>
                    <div>
                      <p className="font-semibold text-white leading-tight">{r.name}</p>
                      <p className="text-[10.5px] text-zinc-600 font-mono">@{r.handle}</p>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <select
                    value={r.cron}
                    disabled={!accessToken}
                    onChange={(e) => run(`cron-${r.mintAddress}`, () => setHeartbeat({ accessToken: accessToken!, mintAddress: r.mintAddress, cron: e.target.value }))}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[11.5px] text-zinc-300 focus:outline-none focus:border-zinc-600"
                  >
                    {CRON_OPTIONS.map((c) => <option key={c} value={c}>{cronLabel(c)}</option>)}
                  </select>
                </td>
                <td className="py-3 px-4 text-zinc-500">{timeAgo(r.lastFiredAt)}</td>
                <td className="py-3 px-4 text-zinc-400">{dueLabel(r.cron, r.enabled, r.lastFiredAt)}</td>
                <td className="py-3 px-4">
                  <span className={`inline-flex items-center text-[10px] font-semibold rounded-md px-2 py-0.5 border ${
                    r.enabled ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-zinc-500 bg-zinc-500/10 border-zinc-700"
                  }`}>{r.enabled ? "enabled" : "paused"}</span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      title={r.enabled ? "Pause" : "Enable"}
                      disabled={busy === `toggle-${r.mintAddress}` || !accessToken}
                      onClick={() => run(`toggle-${r.mintAddress}`, () => setHeartbeat({ accessToken: accessToken!, mintAddress: r.mintAddress, enabled: !r.enabled }))}
                      className="p-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-white transition-colors"
                    >
                      {busy === `toggle-${r.mintAddress}` ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                    </button>
                    <button
                      title="Fire on next tick"
                      disabled={busy === `fire-${r.mintAddress}` || !accessToken}
                      onClick={() => run(`fire-${r.mintAddress}`, () => fireNow({ accessToken: accessToken!, mintAddress: r.mintAddress }))}
                      className="p-1.5 rounded-lg border border-emerald-800/60 hover:border-emerald-600 text-emerald-400 transition-colors"
                    >
                      {busy === `fire-${r.mintAddress}` ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-12 text-center text-zinc-700">No agents yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
