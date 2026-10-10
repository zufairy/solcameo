"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Check, Loader2, RefreshCw, Zap } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { timeAgo } from "@/components/admin/util";
import type { RpcProvider } from "@/lib/solana/rpcProvider";
import { usePoll } from "@/components/pulse/usePoll";

type Probe = { provider: RpcProvider; configured: boolean; ok: boolean; latencyMs: number | null; slot: number | null; error?: string };
type Health = { network: string; active: RpcProvider; providers: Probe[]; checkedAt: number };

const META: Record<RpcProvider, { name: string; note: string }> = {
  solami: { name: "Solami", note: "RPC, Blur decoded market data and Beam transaction landing" },
  quicknode: { name: "QuickNode", note: "Previous primary provider" },
};

/**
 * Admin "RPC" tab: pick which provider leads every Solana call in the app (relay, deposits, swaps, launches, reads). The other
 * provider stays on as automatic failover. The choice is stored in Convex and picked up by the server within seconds.
 */
export function RpcSection() {
  const { accessToken } = useSupabaseAuth();
  const setProvider = useAction(api.rpcSettings.setProvider);
  const saved = useQuery(api.rpcSettings.getProvider, {});
  const [nonce, setNonce] = useState(0);
  const { data: health, error: healthError } = usePoll<Health>(`/api/rpc-health?n=${nonce}`, 15_000);
  const [busy, setBusy] = useState<RpcProvider | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const check = () => setNonce((n) => n + 1);

  const choose = async (provider: RpcProvider) => {
    if (!accessToken) return;
    setBusy(provider); setErr(null);
    try { await setProvider({ accessToken, provider }); check(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not switch provider."); }
    finally { setBusy(null); }
  };

  const active = saved?.provider ?? health?.active ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">RPC provider</h1>
          <p className="mt-1 text-[13px] text-white/55">Every Solana call in the app goes through the provider you pick. The other one is the automatic failover.</p>
        </div>
        <button type="button" onClick={check} className="inline-flex items-center gap-2 rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/5">
          <RefreshCw className="size-3.5" /> Check now
        </button>
      </div>

      {(err || healthError) && <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">{err ?? "Could not reach the health check."}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {(health?.providers ?? [{ provider: "solami", configured: true, ok: false, latencyMs: null, slot: null }, { provider: "quicknode", configured: true, ok: false, latencyMs: null, slot: null }] as Probe[]).map((p) => {
          const isActive = active === p.provider;
          return (
            <div key={p.provider} className="rounded-2xl border p-4" style={{ borderColor: isActive ? "#d7ff00" : "rgba(255,255,255,0.12)", background: isActive ? "rgba(215,255,0,0.06)" : undefined }}>
              <div className="flex items-center justify-between">
                <p className="text-[16px] font-semibold">{META[p.provider].name}</p>
                {isActive && <span className="inline-flex items-center gap-1 rounded-full bg-[#d7ff00] px-2 py-0.5 text-[11px] font-semibold text-[#10140a]"><Zap className="size-3" />Active</span>}
              </div>
              <p className="mt-1 text-[12px] text-white/50">{META[p.provider].note}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
                <div><dt className="text-white/45">Status</dt><dd className={p.ok ? "text-emerald-300" : "text-white/60"}>{!p.configured ? "Not set up" : p.ok ? "Healthy" : health ? "Down" : "Checking"}</dd></div>
                <div><dt className="text-white/45">Latency</dt><dd className="tabular-nums">{p.latencyMs != null ? `${p.latencyMs} ms` : "–"}</dd></div>
                <div><dt className="text-white/45">Slot</dt><dd className="tabular-nums">{p.slot != null ? p.slot.toLocaleString() : "–"}</dd></div>
              </dl>
              {p.error && <p className="mt-2 text-[11px] text-red-300/80">{p.error}</p>}
              <button type="button" disabled={!p.configured || isActive || busy !== null} onClick={() => choose(p.provider)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[13px] font-semibold transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40">
                {busy === p.provider ? <Loader2 className="size-4 animate-spin" /> : isActive ? <Check className="size-4" /> : null}
                {isActive ? "In use" : `Use ${META[p.provider].name}`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[12px] text-white/40">
        {saved?.updatedAt ? `Last changed ${timeAgo(saved.updatedAt)}${saved.updatedByEmail ? ` by ${saved.updatedByEmail}` : ""}. ` : "No admin choice yet; the server default applies. "}
        Changes take effect within about 10 seconds.
      </p>
    </div>
  );
}
