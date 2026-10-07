"use client";
import { LIVE_NETWORK } from "@/lib/solstar/liveNetwork";
import { getTxExplorerUrl } from "@/lib/solana/network";
import { useCalloutTrades } from "./useCalloutTrades";
import { formatTradeSol, tradeCallText, type CalloutTrade } from "@/lib/solstar/calloutTrade";
/* eslint-disable @next/next/no-img-element -- hosted character portraits */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { Download, Flame, Globe, Megaphone, Loader2 } from "lucide-react";
import { calloutCardBlob, type CalloutCardData } from "@/lib/client/calloutCard";
import { CalloutAttachments } from "./CalloutAttachments";
import type { CalloutAttachment } from "@/lib/solstar/calloutMedia";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { CalloutFeedCard } from "./CalloutFeedCard";
import { CalloutRow, CalloutThreadDialog, useReplyCounts } from "./CalloutThread";
import { CALLOUT_THEMES, type CalloutMetric, type CalloutTheme } from "@/lib/solstar/callout";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ensureSiwsViaRegistered, getCurrentSiwsToken } from "@/lib/client/siwsIdentity";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { useNow } from "./feedShared";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import type { MarketRow } from "./MarketTable";
import { marketPath } from "@/lib/solstar/marketSlug";


type Observation = { available: boolean; capSol?: number; supplyTokens?: number; changeSinceLaunchPct?: number; appVolume24hLamports?: string };
type ViewStats = { views: number; videos: number; bars: number[]; thumbs: string[] };
function pct(n: number) { return `${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function usd(value: number | undefined, compact = false) { return value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 2 : value < 1 ? 7 : 2 }).format(value); }
function usePools(rows: MarketRow[] | undefined) {
  const [pools, setPools] = useState<Record<string, Observation>>({});
  const ids = (rows ?? []).filter(r => r.dbcPool).slice(0, 20).map(r => r.characterId).join(",");
  useEffect(() => {
    let active = true, busy = false;
    const refresh = async () => {
      if (busy || document.hidden || !ids) return;
      busy = true;
      try {
        const results = await Promise.all(ids.split(",").map(async id => {
          try { const res = await fetch(`/api/meteora/pool?characterId=${encodeURIComponent(id)}`, { cache: "no-store" }); return res.ok ? [id, await res.json()] as const : null; } catch { return null; }
        }));
        if (active) setPools(prev => ({ ...prev, ...Object.fromEntries(results.filter(r => r !== null)) }));
      } finally { busy = false; }
    };
    void refresh(); const timer = setInterval(refresh, 5000);
    window.addEventListener("solcameo:trade-confirmed", refresh); window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("solcameo:trade-confirmed", refresh); window.removeEventListener("focus", refresh); };
  }, [ids]);
  return pools;
}
function AgentOption({ r }: { r: MarketRow }) {
  return <span className="flex min-w-0 items-center gap-3">
    <img src={r.imageUrl} alt="" className="size-9 shrink-0 rounded-[6px] object-cover ring-1 ring-white/10" />
    <span className="truncate text-sm font-bold uppercase tracking-wide text-white">{r.name}</span>
    <span className="shrink-0 rounded-[5px] bg-white px-1.5 py-0.5 text-[10px] font-bold leading-none text-black">${r.ticker.toUpperCase()}</span>
  </span>;
}
/** Views per influencer, rolled up from every posted video (same source as the agents page), keyed by coin ticker. */
function useViewStats() {
  const agents = useQuery(api.influencers.listSearchable, {});
  const feed = useQuery(api.clipJobs.globalVideoFeed, { limit: 120 });
  return useMemo(() => {
    const byTicker = new Map<string, ViewStats>();
    if (!agents || !feed || Array.isArray(feed)) return byTicker;
    const byMint = new Map<string, Array<{ views: number; poster: string | null }>>();
    for (const v of feed.items) byMint.set(v.mint, [...(byMint.get(v.mint) ?? []), { views: Math.max(0, Math.floor(v.viewCount ?? 0)), poster: v.posterUrl ?? null }]);
    for (const a of agents) {
      if (!a.ticker) continue;
      const list = byMint.get(a.mintAddress) ?? [];
      const top = [...list].sort((x, y) => y.views - x.views);
      byTicker.set(a.ticker.toUpperCase(), { views: list.reduce((n, x) => n + x.views, 0), videos: list.length, bars: top.slice(0, 8).map((x) => x.views), thumbs: top.map((x) => x.poster).filter((u): u is string => !!u).slice(0, 6) });
    }
    return byTicker;
  }, [agents, feed]);
}
export function HomeCallouts() {
  const { publicKey } = useUnifiedSolanaWallet();
  const wallet = publicKey?.toBase58();
  const profiles = useQuery(api.users.leaderboardProfiles, wallet ? { wallets: [wallet] } : "skip");
  const profile = profiles?.[0];
  const [target, setTarget] = useState<"agent" | "trader">("agent");
  const trader = target === "trader";
  const traderName = profile?.name || (wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "Your profile");
  const rows = useQuery(api.solstarMarket.listMarket, { sort: "new", network: LIVE_NETWORK, liveOnly: true });
  const agents = useQuery(api.influencers.listSearchable, {});
  const earnings = useQuery(api.submissions.earningsByAgent, {});
  const callouts = useQuery(api.solstarFeed.listCallouts, { network: "mainnet" });
  const pools = usePools(rows); const viewStats = useViewStats(); const rate = useSolUsd(); const now = useNow(30000); const reduced = useReducedMotion();
  const [open, setOpen] = useState(false), [characterId, setCharacterId] = useState(""), [body, setBody] = useState(""), [sending, setSending] = useState(false), [error, setError] = useState(""), [posted, setPosted] = useState(false), [note, setNote] = useState("");
  const [metric, setMetric] = useState<CalloutMetric>("earnings");
  const [theme, setTheme] = useState<CalloutTheme>("solana");
  const [attachments, setAttachments] = useState<CalloutAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [tradeMint, setTradeMint] = useState("");
  const [postedTrade, setPostedTrade] = useState<CalloutTrade>();
  const tradeData = useCalloutTrades(wallet, open && trader);
  const selectedTrade = trader ? tradeData.coins.find(t => t.mint === tradeMint) : undefined;
  const validTrade = !!selectedTrade && !tradeData.loading;
  const bodyTrade = posted ? postedTrade : selectedTrade;
  const callBody = body.trim() || (trader && bodyTrade ? tradeCallText(bodyTrade, rate) : "");
  const selected = rows?.find(r => r.characterId === characterId);
  const cap = (id: string) => pools[id]?.available && pools[id]?.capSol != null && rate != null ? pools[id].capSol! * rate : undefined;
  async function send() {
    if ((!trader && !selected) || (!callBody && !attachments.length) || sending || uploading || (metric === "trade" && !validTrade)) return;
    setSending(true); setError("");
    try {
      if (!getCurrentSiwsToken()) await ensureSiwsViaRegistered();
      const res = await fetch("/api/solstar/feed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: body.trim(), ...(attachments.length ? { attachments } : {}), ...(!trader ? { characterId } : {}), theme, calloutMetric: metric, ...(metric === "trade" ? { tradeMint } : {}), ...(!trader && pools[characterId]?.available && pools[characterId]?.capSol ? { callCapSol: pools[characterId].capSol } : {}) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error === "rate_limited" ? "Please wait before posting another callout." : data.error === "duplicate_message" ? "You already posted that message." : data.error || "Could not post this callout.");
      if (data.onchainTrade) setPostedTrade(data.onchainTrade);
      setPosted(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not post callout."); } finally { setSending(false); }
  }
  /** Everything the share card shows, from live pool data. `callCapSol` turns the headline into the gain since the call. */
  function buildCard(id: string, text: string, who: { name: string; ticker: string; imageUrl?: string }, callCapSol?: number, caller?: string, options?: { metric?: CalloutMetric; theme?: string; tradePnlUsd?: number; onchainTrade?: CalloutTrade }): CalloutCardData {
    const o = pools[id];
    const capNow = o?.available ? o.capSol : undefined;
    const sinceCall = callCapSol && capNow ? (capNow / callCapSol - 1) * 100 : null;
    const agent = agents?.find(a => a.ticker?.toUpperCase() === who.ticker.toUpperCase());
    const earned = agent && earnings ? earnings[agent.mintAddress] : undefined;
    return {
      metric: options?.metric ?? "earnings", theme: options?.theme ?? "solana", tradePnlUsd: options?.tradePnlUsd ?? (options?.onchainTrade && rate != null ? options.onchainTrade.pnlSol * rate : undefined), onchainTrade: options?.onchainTrade,
      earningsUsd: agent ? Math.max(agent.lifetimeEarningsUsdc ?? 0, earned?.lifetime ?? 0) : undefined,
      monthlyEarningsUsd: agent ? earned?.monthly ?? agent.monthlyEarnings : undefined,
      name: who.name, ticker: who.ticker, imageUrl: who.imageUrl, body: text, cap: usd(cap(id), true),
      changePct: sinceCall ?? (o?.available ? o.changeSinceLaunchPct ?? null : null),
      label: sinceCall != null ? "SINCE CALL" : "SINCE LAUNCH",
      views: viewStats.get(who.ticker.toUpperCase())?.views,
      videos: viewStats.get(who.ticker.toUpperCase())?.videos,
      thumbs: viewStats.get(who.ticker.toUpperCase())?.thumbs,
      caller,
    };
  }
  const cardTrade = posted ? postedTrade : selectedTrade;
  const cardData: CalloutCardData = { ...buildCard(characterId, callBody, { name: selected?.name ?? "Your agent", ticker: selected?.ticker ?? "TICKER", imageUrl: selected?.imageUrl ?? "/brand/solcameo-mark.png" }, undefined, undefined, { metric, theme }), unselectedPreview: trader ? !selectedTrade : !selected, ...(trader ? { trader: true, name: traderName, ticker: cardTrade?.ticker || "", imageUrl: cardTrade?.imageUrl || profile?.image || "/brand/solcameo-mark.png", caller: wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : undefined, onchainTrade: cardTrade } : {}) };
  const shareUrl = typeof window !== "undefined" && !trader && selected ? `${window.location.origin}/market/${selected.characterId}` : "https://solcameo.com";
  const shareText = `I just ${trader ? "shared my trade P&L" : `called out $${selected?.ticker ?? ""}`} on Solcameo: "${callBody.slice(0, 180)}"`;
  async function shareToX() {
    setNote("");
    const blob = await calloutCardBlob(cardData);
    const file = blob ? new File([blob], `solcameo-${selected?.ticker ?? "callout"}.png`, { type: "image/png" }) : null;
    try { if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: shareText, url: shareUrl }); return; } } catch { /* fall through to the X composer */ }
    let copied = false;
    try { if (blob && navigator.clipboard && "ClipboardItem" in window) { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); copied = true; } } catch { /* clipboard blocked */ }
    setNote(copied ? "Card copied. Paste it into your post." : "Tap Save card to attach the image.");
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, "_blank", "noopener,noreferrer");
  }
  async function saveCard() {
    const blob = await calloutCardBlob(cardData);
    if (!blob) { setNote("Could not render the card image."); return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `solcameo-${selected?.ticker ?? "callout"}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function closeDialog() { setOpen(false); setPosted(false); setNote(""); if (posted) { setBody(""); setTradeMint(""); setPostedTrade(undefined); setAttachments([]); } }
  const [threadId, setThreadId] = useState<string | null>(null);
  const replyCounts = useReplyCounts((callouts ?? []).map(c => c.id));
  const cardFor = (c: NonNullable<typeof callouts>[number]): CalloutCardData => ({ ...buildCard(String(c.characterId), c.body, { name: c.name, ticker: c.ticker, imageUrl: c.imageUrl }, c.callCapSol, c.wallet, { metric: c.calloutMetric ?? "earnings", theme: c.theme, tradePnlUsd: c.tradePnlUsd, onchainTrade: c.onchainTrade }), trader: c.trader });
  const threadCall = callouts?.find(c => c.id === threadId) ?? null;
  const ranked = [...(rows ?? []).slice(0, 20)].sort((a, b) => Number(pools[b.characterId]?.appVolume24hLamports ?? 0) - Number(pools[a.characterId]?.appVolume24hLamports ?? 0));
  return <div className="@container min-w-0 font-apple text-zinc-200 antialiased">
    <div className="grid @3xl:h-[100cqh] @3xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] @3xl:divide-x @3xl:divide-white/10">
    <section aria-label="Callouts" className="flex min-h-0 min-w-0 flex-col @3xl:overflow-y-auto @3xl:overscroll-contain">
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 feed-glass-header px-4"><span className="grid size-7 place-items-center rounded-[9px] border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_14px_-4px_rgba(0,0,0,0.6)] backdrop-blur-xl" aria-hidden="true"><Megaphone className="size-4" /></span><h2 className="text-sm font-semibold tracking-tight text-white">Callouts</h2><Button onClick={() => { setError(""); setPosted(false); setNote(""); setOpen(true); }} className="ml-auto flex h-7 items-center gap-1.5 rounded-[3px] bg-[#d7ff00] px-2.5 text-xs font-semibold text-black transition-colors hover:bg-[#e4ff59] active:scale-[0.98]"><Megaphone className="size-3.5" />New callout</Button></div>
    <div className="max-h-[360px] min-h-[180px] overflow-y-auto @3xl:max-h-none @3xl:flex-1 @3xl:overflow-visible">
      {callouts === undefined ? <p className="p-6 text-sm text-zinc-500">Loading callouts…</p> : !callouts.length ? <p className="p-6 text-sm text-zinc-500">Share your trade or call out an agent.</p> : callouts.map((c, i) => <CalloutRow key={c.id} c={c} card={cardFor(c)} now={now} replies={replyCounts[c.id] ?? 0} index={i} onOpen={() => setThreadId(c.id)} />)}
    </div>
    </section>
    <LeaderboardPanel />
    <section aria-label="Trending tokens" className="min-h-0 min-w-0 @3xl:overflow-y-auto @3xl:overscroll-contain"><div className="sticky top-0 z-10 flex items-center gap-3 border-y border-white/10 feed-glass-header px-4 @3xl:border-t-0"><span className="grid size-7 place-items-center rounded-[9px] border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_14px_-4px_rgba(0,0,0,0.6)] backdrop-blur-xl" aria-hidden="true"><Flame className="size-4" /></span><h2 className="text-sm font-semibold tracking-tight text-white">Trending</h2><span className="ml-auto text-[11px] text-zinc-500">Ranked by 24h volume</span></div>
      {!ranked.length ? <p className="p-6 text-sm text-zinc-500">Confirmed tokens will appear here after launch.</p> : ranked.map((r, i) => {
        const obs = pools[r.characterId], c = cap(r.characterId), ch = obs?.available ? obs.changeSinceLaunchPct : null;
        const up = ch == null || ch >= 0, vol = Number(obs?.appVolume24hLamports ?? 0);
        const safe = (u?: string) => (u && u.startsWith("https://") ? u : undefined), xHref = safe(r.xUrl), webHref = safe(r.websiteUrl);
        const price = obs?.supplyTokens && c != null ? c / obs.supplyTokens : undefined;
        const tint = ch == null ? "rgba(255,255,255,0.03)" : up ? "rgba(52,211,153,0.17)" : "rgba(248,113,113,0.17)";
        return <motion.div key={r.characterId} initial={reduced ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }} style={{ backgroundImage: `linear-gradient(90deg, transparent 35%, ${tint})` }} className="group relative flex items-center gap-3 border-b border-white/[0.05] px-5 py-2.5 transition-colors hover:bg-white/[0.03]">
          <div className="flex min-w-0 flex-1 items-center gap-3"><Link href={marketPath(r)} className="shrink-0"><img src={r.imageUrl} alt="" className="size-11 rounded-[8px] object-cover ring-1 ring-white/10" /></Link><div className="min-w-0"><div className="flex items-center gap-2"><Link href={marketPath(r)} className="truncate text-[16px] font-extrabold uppercase leading-tight tracking-[0.01em] text-zinc-50 hover:text-white">{r.name}</Link>{i < 3 && vol > 0 && <span className="shrink-0 rounded-[6px] bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-400">Hot</span>}</div><div className="mt-0.5 flex items-center gap-2"><p className="truncate text-[12px] tabular-nums text-zinc-400">{price != null ? usd(price) : <span className="font-mono">${r.ticker}</span>}</p>{(xHref || webHref) && <span className="flex items-center gap-0.5">{xHref && <a href={xHref} target="_blank" rel="noopener noreferrer" aria-label={`${r.name} on X`} className="grid size-6 place-items-center rounded-full text-zinc-500 transition duration-200 hover:scale-110 hover:bg-white/10 hover:text-white"><svg viewBox="0 0 24 24" className="size-[13px] fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg></a>}{webHref && <a href={webHref} target="_blank" rel="noopener noreferrer" aria-label={`${r.name} website`} className="grid size-6 place-items-center rounded-full text-zinc-500 transition duration-200 hover:scale-110 hover:bg-white/10 hover:text-white"><Globe className="size-[13px]" /></a>}</span>}</div></div></div>
          <div className="w-[84px] shrink-0 text-right"><motion.p key={c} initial={reduced ? false : { opacity: 0.45 }} animate={{ opacity: 1 }} className={`text-[14px] font-semibold tabular-nums ${ch == null ? "text-zinc-200" : up ? "text-emerald-300" : "text-rose-300"}`}>{usd(c, true)}</motion.p><p className={`mt-0.5 text-[11px] font-semibold tabular-nums ${ch == null ? "text-zinc-500" : up ? "text-emerald-400" : "text-rose-400"}`}>{ch == null ? "—" : <>{up ? "↑" : "↓"} {pct(ch)}</>}</p></div>
        </motion.div>;
      })}
    </section>
    </div>
    <CalloutThreadDialog c={threadCall} card={threadCall ? cardFor(threadCall) : null} onClose={() => setThreadId(null)} />
    <Dialog open={open} onOpenChange={value => { if (sending || uploading) return; if (!value) closeDialog(); else setOpen(true); }}><DialogContent className="max-h-[94dvh] overflow-y-auto border-white/15 bg-[#14161a]/95 p-5 text-white backdrop-blur-2xl sm:max-w-4xl">
      <div className="grid gap-5 md:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[520px] space-y-4 md:max-w-none"><CalloutFeedCard size="large" data={cardData} /><div><p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Feed preview</p><CalloutFeedCard data={cardData} /></div></div>
        <div className="flex min-w-0 flex-col gap-4 [&>*]:shrink-0 md:max-h-[calc(94dvh-40px)] md:overflow-y-auto md:overscroll-contain md:py-1 md:pr-1">
          <div><DialogTitle className="text-xl tracking-tight">{posted ? "Callout posted" : "New callout"}</DialogTitle><DialogDescription className="mt-1 text-zinc-500">{posted ? "Share your call and the card with your followers." : "Share your own trade P&L, or call out an agent. Choose a theme and make your call."}</DialogDescription></div>
          {!posted ? <>
            <div role="group" aria-label="Callout type" className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.025] p-1">{(["agent", "trader"] as const).map(value => <button key={value} type="button" aria-pressed={target === value} disabled={sending} onClick={() => { setTarget(value); setMetric(value === "trader" ? "trade" : "earnings"); setError(""); }} className={`flex-1 rounded-md px-3 py-2 text-xs font-medium ${target === value ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}>{value === "trader" ? "My trade" : "Agent"}</button>)}</div>
            {trader ? <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3"><img src={profile?.image || "/brand/solcameo-mark.png"} alt="" className="size-9 rounded-md object-contain" /><div><p className="text-sm font-medium">{traderName}</p><p className="text-xs text-zinc-500">{wallet ? "Posts with your signed wallet · no agent needed" : "Connect and sign in when you post · no agent needed"}</p></div></div> : <div><p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Agent</p>
              <Select value={characterId} onValueChange={v => setCharacterId(v ?? "")}>
                <SelectTrigger className="h-12 w-full gap-3 rounded-[8px] border-white/10 bg-white/5 px-3">
                  <SelectValue placeholder="Choose an agent">{(v: string | null) => { const r = rows?.find(x => x.characterId === v); return r ? <AgentOption r={r} /> : <span className="text-zinc-500">Choose an agent</span>; }}</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} sideOffset={6} className="max-h-[22rem] rounded-[8px] border border-white/10 bg-[#17191b] p-1">
                  {rows?.map(r => <SelectItem key={r.characterId} value={r.characterId} className="rounded-[6px] py-2 pl-2"><AgentOption r={r} /></SelectItem>)}
                </SelectContent>
              </Select></div>}
            {!trader && <fieldset><legend className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Callout metric</legend><div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.025] p-1">{([["earnings", "Earnings"], ["views", "Views"]] as const).map(([value, label]) => <button key={value} type="button" disabled={sending} aria-pressed={metric === value} onClick={() => setMetric(value)} className={`flex-1 rounded-md px-2 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${metric === value ? "bg-white text-black" : "text-zinc-400 hover:text-white"}`}>{label}</button>)}</div></fieldset>}
            {trader && <div className="space-y-2">
              <div className="flex items-center justify-between"><p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Your traded coin</p>{wallet && <button type="button" disabled={tradeData.loading || sending} onClick={tradeData.refresh} className="text-[10px] text-zinc-400 hover:text-white">Refresh</button>}</div>
              {!wallet ? <Button variant="outline" onClick={() => void ensureSiwsViaRegistered().catch(e => setError(e instanceof Error ? e.message : "Connect your wallet."))} className="w-full border-white/15 bg-white/5">Connect wallet to find trades</Button> : tradeData.loading ? <p role="status" className="flex items-center gap-2 py-3 text-xs text-zinc-400"><Loader2 className="size-3.5 animate-spin" />Reading confirmed trades…</p> : <Select value={tradeMint} onValueChange={v => setTradeMint(v || "")}><SelectTrigger className="h-11 w-full rounded-lg border-white/10 bg-white/5"><SelectValue placeholder="Choose a coin you traded">{(value: string | null) => { const coin = tradeData.coins.find(t => t.mint === value); return coin ? <span className="flex min-w-0 items-center gap-2"><img src={coin.imageUrl} alt="" className="size-6 shrink-0 rounded object-cover" /><span className="truncate text-sm">{coin.name}</span><span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold leading-none text-black">${coin.ticker}</span></span> : <span className="text-zinc-500">Choose a coin you traded</span>; }}</SelectValue></SelectTrigger><SelectContent className="border-white/10 bg-[#17191b]">{tradeData.coins.map(t => <SelectItem key={t.mint} value={t.mint}><span className="flex items-center gap-2"><img src={t.imageUrl} alt="" className="size-6 rounded object-cover" /><span>{t.name}</span><span className="rounded bg-white px-1 text-[10px] font-semibold text-black">${t.ticker}</span></span></SelectItem>)}</SelectContent></Select>}
              {wallet && !tradeData.loading && !tradeData.coins.length && <p className="text-xs text-zinc-500">No verified Solcameo trades found on this network yet.</p>}
              {tradeData.error && <p className="text-xs text-amber-300/70">{tradeData.error}</p>}
              {selectedTrade && <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3"><div className="flex items-center justify-between gap-2"><span className="text-[11px] text-zinc-400">Position P&L · {selectedTrade.network}</span><span className={`text-sm font-medium tabular-nums ${selectedTrade.pnlSol < 0 ? "text-rose-400" : "text-emerald-400"}`}>{formatTradeSol(selectedTrade.pnlSol, rate)}</span></div><p className="mt-1 text-xs text-zinc-300">Latest trade: {selectedTrade.side === "buy" ? "Bought" : "Sold"} ${selectedTrade.ticker} · {rate ? `$${(selectedTrade.amountSol * rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${selectedTrade.amountSol.toLocaleString("en-US", { maximumFractionDigits: 5 })} SOL`}</p><p className="mt-1 text-[10px] text-zinc-500">Confirmed on-chain · realised + open position · fees included</p><a href={getTxExplorerUrl(selectedTrade.signature, selectedTrade.network === "mainnet" ? "mainnet-beta" : "devnet")} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[10px] text-zinc-400 hover:text-white">View transaction ↗</a></div>}
            </div>}
            <fieldset><legend className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Card theme</legend><div className="grid grid-cols-5 gap-1.5">{Object.entries(CALLOUT_THEMES).map(([key, option]) => <button key={key} type="button" disabled={sending} aria-pressed={theme === key} onClick={() => setTheme(key as CalloutTheme)} className={`flex items-center justify-center gap-1.5 rounded-md border px-1 py-2 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${theme === key ? "border-white/50 bg-white/10 text-white" : "border-white/10 text-zinc-400"}`}><span className="size-1.5 shrink-0 rounded-full" style={{ background: option.accent }} />{option.name}</button>)}</div></fieldset>
            <div><label htmlFor="callout-prompt" className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-zinc-500">Your call</label>
              <CalloutAttachments value={attachments} onChange={setAttachments} onBusy={setUploading} disabled={sending}>
                <Textarea id="callout-prompt" value={body} onChange={e => setBody(e.target.value)} maxLength={280} rows={3} placeholder={selectedTrade ? tradeCallText(selectedTrade, rate) : "What’s your call?"} className="resize-none rounded-none border-0 bg-transparent px-3 pt-3 text-sm shadow-none focus-visible:ring-0" />
                <p className="px-3 pb-2 text-right text-[10px] tabular-nums text-zinc-600">{280 - body.length}</p>
              </CalloutAttachments>
            </div>
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
            <Button disabled={(!trader && !selected) || (!callBody && !attachments.length) || sending || uploading || (metric === "trade" && !validTrade)} onClick={() => void send()} className="mt-auto h-11 w-full bg-[#d7ff00] text-black hover:bg-[#e4ff59]">{sending ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}{sending ? "Posting…" : trader ? "Post latest trade" : selected ? `Call $${selected.ticker}` : "Post callout"}</Button>
          </> : <>
            <div className="mt-auto flex flex-wrap items-center gap-2">
              <Button onClick={() => void shareToX()} className="bg-white text-black hover:bg-zinc-200"><svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>Share on X</Button>
              <Button variant="outline" onClick={() => void saveCard()} className="border-white/15 bg-white/5"><Download className="size-4" />Save card</Button>
              <Button variant="ghost" onClick={closeDialog} className="ml-auto text-zinc-400">Done</Button>
            </div>
            {note && <p role="status" className="text-xs text-zinc-400">{note}</p>}
          </>}
        </div>
      </div>
    </DialogContent></Dialog>
  </div>;
}
