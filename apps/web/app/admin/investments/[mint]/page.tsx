"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ArrowLeft, Loader2, SlidersHorizontal } from "lucide-react";
import { fmtUsd, shortAddr, timeAgo } from "@/components/admin/util";
import { AdjustEscrowDialog } from "@/components/admin/adjust-escrow-dialog";
import type { AgentInvestmentDetail } from "@/convex/adminEconomy";

function Stat({ label, value, accent = "text-white" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[#1e1e24] bg-[#0a0a0d] px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-zinc-700">{label}</p>
      <p className={`mt-1 text-[16px] font-mono font-bold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

const LEDGER_STYLE: Record<string, string> = {
  buy: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  redeem: "text-red-400 bg-red-500/10 border-red-500/20",
  founder: "text-violet-400 bg-violet-500/10 border-violet-500/20",
};

export default function AdminAgentInvestmentPage() {
  const { mint } = useParams<{ mint: string }>();
  const mintAddress = decodeURIComponent(mint ?? "");
  const { accessToken } = useSupabaseAuth();
  const getDetail = useAction(api.adminEconomy.agentInvestmentDetail);
  const [detail, setDetail] = useState<AgentInvestmentDetail | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken || !mintAddress) return;
    try { setErr(null); setDetail(await getDetail({ accessToken, mintAddress })); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed to load"); }
  }, [accessToken, getDetail, mintAddress]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  if (detail === null) {
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

  const { agent, account, investors, ledger, adjustments } = detail;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/admin/investments" className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-300">
          <ArrowLeft className="size-3.5" /> Investments
        </Link>
        {err && <span className="text-[11px] text-amber-400">{err}</span>}
      </div>

      {/* Agent + account header */}
      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl overflow-hidden bg-zinc-800 border border-[#27272a]">
              {agent?.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={agent.avatarUrl} alt="" className="w-full h-full object-cover" />
                : null}
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-white">{agent?.name ?? shortAddr(mintAddress)}</h2>
              <p className="text-[11px] text-zinc-600 font-mono">{mintAddress}</p>
            </div>
          </div>
          <button
            onClick={() => setShowAdjust(true)}
            disabled={!account}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl border border-[#1e1e24] hover:border-zinc-600 text-[12.5px] font-semibold text-zinc-300 hover:text-white transition-colors disabled:opacity-40"
          >
            <SlidersHorizontal className="size-3.5" /> Adjust escrow
          </button>
        </div>
        {account ? (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Stat label="Escrow" value={fmtUsd(account.escrowUsdc)} accent="text-emerald-400" />
            <Stat label="Liquid" value={fmtUsd(account.liquidUsdc)} />
            <Stat label="Unsettled tab" value={fmtUsd(account.unsettledTabUsdc)} accent="text-amber-400" />
            <Stat label="Shares" value={account.sharesOutstanding.toLocaleString()} />
            <Stat label="NAV / share" value={`$${account.navPerShare.toFixed(4)}`} accent="text-sky-400" />
            <Stat label="Status" value={account.status} accent={account.status === "active" ? "text-emerald-400" : "text-amber-400"} />
          </div>
        ) : (
          <p className="mt-4 text-[12px] text-zinc-600">No economic account yet — this agent predates auto-genesis and has no funds.</p>
        )}
        {account && account.adminAdjustmentUsdc !== 0 && (
          <p className="mt-2 text-[11px] text-zinc-600">
            Includes a cumulative admin adjustment of {account.adminAdjustmentUsdc > 0 ? "+" : ""}{fmtUsd(account.adminAdjustmentUsdc)} (survives on-chain reconciliation).
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* Investors */}
        <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#18181c]">
            <h3 className="text-[13px] font-bold text-white">Investors ({investors.length})</h3>
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {investors.map((inv) => (
                <tr key={inv.investorWallet} className="border-b border-[#16161a] last:border-0">
                  <td className="py-2.5 px-5 font-mono text-zinc-400 text-[11px]">{shortAddr(inv.investorWallet)}</td>
                  <td className="py-2.5 px-5 text-right font-mono text-zinc-300">{inv.sharesBought.toLocaleString()} sh</td>
                  <td className="py-2.5 px-5 text-right font-mono text-zinc-300">{fmtUsd(inv.usdcAmount)}</td>
                  <td className="py-2.5 px-5 text-right text-zinc-600">{timeAgo(inv.investedAt)}</td>
                </tr>
              ))}
              {investors.length === 0 && (
                <tr><td colSpan={4} className="py-8 px-5 text-center text-zinc-700">No investors yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Admin adjustments */}
        <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#18181c]">
            <h3 className="text-[13px] font-bold text-white">Admin adjustments ({adjustments.length})</h3>
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {adjustments.map((a, i) => (
                <tr key={i} className="border-b border-[#16161a] last:border-0">
                  <td className={`py-2.5 px-5 text-right font-mono ${a.deltaUsdc < 0 ? "text-red-400" : "text-emerald-400"}`}>
                    {a.deltaUsdc > 0 ? "+" : ""}{fmtUsd(a.deltaUsdc)}
                  </td>
                  <td className="py-2.5 px-5 text-zinc-400 max-w-[220px] truncate" title={a.reason}>{a.reason}</td>
                  <td className="py-2.5 px-5 text-zinc-600 text-[11px]">{a.adminEmail}</td>
                  <td className="py-2.5 px-5 text-right text-zinc-600">{timeAgo(a.at)}</td>
                </tr>
              ))}
              {adjustments.length === 0 && (
                <tr><td colSpan={4} className="py-8 px-5 text-center text-zinc-700">No adjustments.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Share ledger */}
      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#18181c]">
          <h3 className="text-[13px] font-bold text-white">Share ledger ({ledger.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
                <th className="py-2.5 px-5 text-left font-medium">Kind</th>
                <th className="py-2.5 px-5 text-left font-medium">Wallet</th>
                <th className="py-2.5 px-5 text-right font-medium">Shares</th>
                <th className="py-2.5 px-5 text-right font-medium">NAV</th>
                <th className="py-2.5 px-5 text-right font-medium">USDC</th>
                <th className="py-2.5 px-5 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l, i) => (
                <tr key={i} className="border-b border-[#16161a] last:border-0">
                  <td className="py-2.5 px-5">
                    <span className={`inline-flex items-center text-[10px] font-semibold rounded-md px-2 py-0.5 border ${LEDGER_STYLE[l.kind] ?? "text-zinc-400 bg-white/5 border-zinc-700"}`}>
                      {l.kind}
                    </span>
                  </td>
                  <td className="py-2.5 px-5 font-mono text-zinc-400 text-[11px]">{shortAddr(l.wallet)}</td>
                  <td className={`py-2.5 px-5 text-right font-mono ${l.shares < 0 ? "text-red-400" : "text-zinc-300"}`}>
                    {l.shares > 0 ? "+" : ""}{l.shares.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-5 text-right font-mono text-zinc-500">${l.navPerShare.toFixed(4)}</td>
                  <td className="py-2.5 px-5 text-right font-mono text-zinc-300">{fmtUsd(l.usdcAmount)}</td>
                  <td className="py-2.5 px-5 text-right text-zinc-600">{timeAgo(l.at)}</td>
                </tr>
              ))}
              {ledger.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-zinc-700">No share activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdjust && account && (
        <AdjustEscrowDialog
          mintAddress={mintAddress}
          account={account}
          onClose={() => setShowAdjust(false)}
          onDone={() => { setShowAdjust(false); void refresh(); }}
        />
      )}
    </div>
  );
}
