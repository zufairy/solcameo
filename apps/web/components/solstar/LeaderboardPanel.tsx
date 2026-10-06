"use client";
/* eslint-disable @next/next/no-img-element -- hosted token portraits */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getAccountExplorerUrl } from "@/lib/solana/network";
import { ArrowUpRight, Trophy } from "lucide-react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { compact } from "@/lib/client/calloutCard";
import { LEADERBOARD_PERIODS, type LeaderboardPeriod, type LeaderboardResponse } from "@/lib/solstar/leaderboard";
const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
const sol = (value: number | null, signed = false) => value == null ? "—" : `${signed && value >= 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL`;
// Stable logo compositions keep unconfigured profiles distinct across refreshes.
const avatarTreatments = [
  { background: "radial-gradient(circle at 30% 20%, #5a7835, #1a2820)", transform: "rotate(-12deg)" },
  { background: "radial-gradient(circle at 70% 20%, #4b446d, #202033)", transform: "rotate(10deg)" },
  { background: "radial-gradient(circle at 30% 70%, #265d63, #152c32)", transform: "rotate(-5deg)" },
  { background: "radial-gradient(circle at 70% 70%, #79632d, #30251a)", transform: "rotate(15deg)" },
];
function ProfileAvatar({ wallet, image }: { wallet: string; image?: string }) {
  const [failedImage, setFailedImage] = useState<string>();
  const variant = avatarTreatments[Array.from(wallet).reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) >>> 0, 0) % avatarTreatments.length];
  const custom = image && image !== failedImage;
  return <span className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-full border border-white/15" style={{ background: variant.background }}>
    <img src={custom ? image : "/brand/solcameo-mark.png"} alt="" onError={custom ? () => setFailedImage(image) : undefined} className={custom ? "size-full object-cover" : "size-[22px] object-contain"} style={custom ? undefined : { transform: variant.transform }} />
  </span>;
}
export function LeaderboardPanel({ standalone = false }: { standalone?: boolean } = {}) {
  const [metric, setMetric] = useState<"traders" | "views" | "earners">("traders");
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  const [snapshots, setSnapshots] = useState<Record<string, LeaderboardResponse>>({});
  const [error, setError] = useState("");
  const { publicKey } = useUnifiedSolanaWallet();
  const wallet = publicKey?.toBase58();
  const viewsOnly = metric === "views";
  const snapshotKey = `${period}:${viewsOnly}`;
  const data = snapshots[snapshotKey] ?? null;
  useEffect(() => {
    let active = true, busy = false;
    const refresh = async (event?: Event) => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const res = await fetch(`/api/solstar/leaderboard?period=${period}&metric=${viewsOnly ? "views" : "traders"}${event?.type === "solcameo:trade-confirmed" ? "&refresh=1" : ""}`, { cache: "no-store" });
        if (!res.ok) throw new Error("RPC rankings are temporarily unavailable.");
        const next: LeaderboardResponse = await res.json();
        if (active) { setSnapshots(previous => ({ ...previous, [snapshotKey]: next })); setError(""); }
      } catch { if (active) setError("RPC rankings are temporarily unavailable. Retrying…"); }
      finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("solcameo:trade-confirmed", refresh); window.removeEventListener("focus", refresh); };
  }, [viewsOnly, period, snapshotKey]);
  const views = data?.views?.slice(0, 12);
  const loading = data === null && !error;
  return <section aria-label="Leaderboard" className="min-h-0 min-w-0 @3xl:overflow-y-auto @3xl:overscroll-contain">
    <div className="sticky top-0 z-10 flex items-center gap-3 border-y border-white/10 feed-glass-header px-4 @3xl:border-t-0"><span className="grid size-7 place-items-center rounded-[9px] border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_14px_-4px_rgba(0,0,0,0.6)] backdrop-blur-xl" aria-hidden="true"><Trophy className="size-4" /></span><h2 className="text-sm font-semibold tracking-tight text-white">Leaderboard</h2>{standalone ? <span className="ml-auto text-[11px] text-zinc-500">{metric === "views" ? "Tracked views" : `${data?.network ?? ""} · RPC`}</span> : <Link href="/leaderboard" aria-label="Open leaderboard" title="Open leaderboard" className="ml-auto grid size-7 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"><ArrowUpRight className="size-4" /></Link>}</div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
      <div role="group" aria-label="Leaderboard ranking" className="inline-flex rounded-lg border border-white/10 bg-white/[0.025] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        {([["traders", "Traders"], ["views", "Views"], ["earners", "Earners"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)} className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${metric === value ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200"}`}>{label}</button>)}
      </div>
      <Select value={period} onValueChange={v => { if (v && Object.hasOwn(LEADERBOARD_PERIODS, v)) setPeriod(v as LeaderboardPeriod); }}>
        <SelectTrigger aria-label="Leaderboard period" className="h-8 w-[102px] gap-1 rounded-lg border-white/15 bg-white/[0.055] px-2 text-[10px] text-zinc-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl"><SelectValue>{LEADERBOARD_PERIODS[period]}</SelectValue></SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="rounded-xl border-white/15 bg-[#202326]/85 p-1 text-zinc-200 shadow-xl backdrop-blur-2xl">{Object.entries(LEADERBOARD_PERIODS).map(([value, label]) => <SelectItem key={value} value={value} className="rounded-lg py-2 text-xs">{label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {metric !== "traders" || period !== "all" ? <p className="border-b border-white/5 px-4 py-2 text-[9px] leading-4 text-zinc-500">{metric === "traders" ? "Period sales + open buys · original cost basis and fees included" : metric === "earners" ? "Creator trading fees · claimed + claimable" : "Views on tracked videos published in the selected period"}</p> : null}
    {error && <p role="status" className="px-4 py-3 text-xs text-amber-300/80">{error}</p>}
    {loading ? <p role="status" className="p-4 text-xs text-zinc-500">{metric === "views" ? "Loading views…" : "Reading RPC trades and creator fees…"}</p> : metric === "traders" ? <ol className="py-1">{data?.traders.slice(0, 12).map((t, i) => <li key={t.wallet} className="flex min-h-11 items-center gap-2 px-3 py-1.5 hover:bg-white/[0.025]"><span className="w-4 text-right text-[11px] tabular-nums text-zinc-500">{i + 1}</span><ProfileAvatar wallet={t.wallet} image={t.profileImage} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-zinc-100">{t.profileName || short(t.wallet)}{t.wallet === wallet && <span className="ml-1 rounded bg-white px-1 py-0.5 text-[8px] text-black">You</span>}</p><p className="text-[9px] text-zinc-500">{t.trades} {t.trades === 1 ? "trade" : "trades"}{!t.complete && " · incomplete history"}</p></div><span className={`shrink-0 text-[11px] font-medium tabular-nums ${(t.pnlSol ?? 0) < 0 ? "text-rose-400" : "text-emerald-400"}`}>{sol(t.pnlSol, true)}</span></li>)}{data && !data.traders.length && <li className="p-4 text-xs text-zinc-500">No confirmed swaps found for this period.</li>}</ol> : metric === "earners" ? <ol className="py-1">{data?.earners.slice(0, 12).map((r, i) => <li key={r.characterId} className="flex min-h-11 items-center gap-2 px-3 py-1.5 hover:bg-white/[0.035]">
      <span className="w-4 text-right text-[11px] tabular-nums text-zinc-500">{i + 1}</span>
      <ProfileAvatar wallet={r.wallet} image={r.creatorImage} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] leading-4"><Link href={r.marketUrl ?? `/market/${r.characterId}`} className="font-semibold text-zinc-100 hover:text-white">${r.ticker.replace(/^\$/, "")}</Link><span className="mx-1 text-zinc-600">by</span><a href={getAccountExplorerUrl(r.wallet, data?.network === "mainnet" ? "mainnet-beta" : "devnet")} target="_blank" rel="noopener noreferrer" title="View creator wallet, holdings and transactions on Solscan" className="text-zinc-400 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white">{r.creatorName || short(r.wallet)}</a></p>
        <p className="text-[9px] leading-3 text-zinc-600">{sol(r.claimableSol)} claimable</p>
      </div><span className="shrink-0 text-[11px] font-medium tabular-nums text-emerald-400">{sol(r.feesSol)}</span>
    </li>)}{data && !data.earners.length && <li className="p-4 text-xs text-zinc-500">Creator fees appear after confirmed market trades.</li>}</ol> : <ol className="py-1">{views?.map((r, i) => <li key={r.mint}><Link href={r.marketUrl ?? `/market/${r.mint}`} className="flex min-h-11 items-center gap-2 px-3 py-1.5 hover:bg-white/[0.035]"><span className="w-4 text-right text-[11px] text-zinc-500">{i + 1}</span><img src={r.imageUrl} alt="" className="size-7 shrink-0 rounded-full object-cover" /><span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-100">{r.name}<span className="ml-1 rounded bg-white px-1 py-0.5 text-[8px] text-black">${r.ticker}</span></span><span className="text-[13px] font-medium tabular-nums text-emerald-400">{compact(r.views)}</span></Link></li>)}{views?.length === 0 && <li className="p-4 text-xs text-zinc-500">No tracked agents yet.</li>}</ol>}
    {metric !== "views" && data && (!data.complete || data.errors.length > 0) && <p role="status" className="px-4 py-2 text-[9px] leading-4 text-amber-300/70">{data.errors.join(" · ") || "History scan capped at 1,000 transactions per pool. P&L is unavailable until cost basis is complete."}</p>}
  </section>;
}
