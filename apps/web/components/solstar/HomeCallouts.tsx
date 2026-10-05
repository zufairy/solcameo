"use client";
/* eslint-disable @next/next/no-img-element -- hosted character portraits */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { Download, Flame, Globe, Megaphone, Loader2 } from "lucide-react";
import { calloutCardBlob, type CalloutCardData } from "@/lib/client/calloutCard";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ensureSiwsViaRegistered, getCurrentSiwsToken } from "@/lib/client/siwsIdentity";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { formatRelativeTime } from "@/lib/solstar/relativeTime";
import { useNow } from "./feedShared";
import type { MarketRow } from "./MarketTable";

const CalloutCard3D = dynamic(() => import("./CalloutCard3D"), { ssr: false, loading: () => <div className="h-[250px] w-full animate-pulse rounded-[6px] bg-white/[0.04]" /> });

type Observation = { available: boolean; capSol?: number; supplyTokens?: number; changeSinceLaunchPct?: number; appVolume24hLamports?: string };
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
export function HomeCallouts() {
  const rows = useQuery(api.solstarMarket.listMarket, { sort: "new", network: "devnet", liveOnly: true });
  const callouts = useQuery(api.solstarFeed.listCallouts, {});
  const pools = usePools(rows); const rate = useSolUsd(); const now = useNow(30000); const reduced = useReducedMotion();
  const [open, setOpen] = useState(false), [characterId, setCharacterId] = useState(""), [body, setBody] = useState(""), [sending, setSending] = useState(false), [error, setError] = useState(""), [posted, setPosted] = useState(false), [note, setNote] = useState("");
  const selected = rows?.find(r => r.characterId === characterId);
  const cap = (id: string) => pools[id]?.available && pools[id]?.capSol != null && rate != null ? pools[id].capSol! * rate : undefined;
  async function send() {
    if (!selected || !body.trim() || sending) return;
    setSending(true); setError("");
    try {
      if (!getCurrentSiwsToken()) await ensureSiwsViaRegistered();
      const res = await fetch("/api/solstar/feed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: body.trim(), characterId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error === "rate_limited" ? "Please wait before posting another callout." : data.error === "duplicate_message" ? "You already posted that message." : "Connect your wallet and sign in to post a callout.");
      setPosted(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not post callout."); } finally { setSending(false); }
  }
  const cardData: CalloutCardData = { name: selected?.name ?? "Your agent", ticker: selected?.ticker ?? "TICKER", imageUrl: selected?.imageUrl, body: body.trim(), cap: usd(cap(characterId), true) };
  const shareUrl = typeof window !== "undefined" && selected ? `${window.location.origin}/market/${selected.characterId}` : "https://solcameo.com";
  const shareText = `I just called out $${selected?.ticker ?? ""} on Solcameo: "${body.trim().slice(0, 180)}"`;
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
  function closeDialog() { setOpen(false); setPosted(false); setNote(""); if (posted) { setBody(""); } }
  const ranked = [...(rows ?? []).slice(0, 20)].sort((a, b) => Number(pools[b.characterId]?.appVolume24hLamports ?? 0) - Number(pools[a.characterId]?.appVolume24hLamports ?? 0));
  return <div className="@container min-w-0 text-zinc-200">
    <div className="grid @3xl:h-[calc(100dvh-136px)] @3xl:grid-cols-2 @3xl:divide-x @3xl:divide-white/10">
    <section aria-label="Callouts" className="flex min-h-0 min-w-0 flex-col @3xl:overflow-y-auto @3xl:overscroll-contain">
    <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#17191b]/90 px-5 backdrop-blur-xl"><span className="grid size-8 place-items-center rounded-[9px] border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_14px_-4px_rgba(0,0,0,0.6)] backdrop-blur-xl" aria-hidden="true"><Megaphone className="size-4" /></span><h2 className="text-[15px] font-semibold text-white">Callouts</h2><Button onClick={() => { setError(""); setPosted(false); setNote(""); setOpen(true); }} className="ml-auto flex h-8 items-center gap-2 rounded-md border border-white/15 bg-[#d7ff00] px-4 text-xs font-semibold text-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] transition-colors hover:bg-[#e3ff5c]"><Megaphone className="size-4" />New callout</Button></div>
    <div className="max-h-[360px] min-h-[180px] overflow-y-auto @3xl:max-h-none @3xl:flex-1 @3xl:overflow-visible">
      {callouts === undefined ? <p className="p-6 text-sm text-zinc-500">Loading callouts…</p> : !callouts.length ? <p className="p-6 text-sm text-zinc-500">Call out an agent and start the conversation.</p> : callouts.map(c => <motion.article key={c.id} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 border-b border-white/5 px-5 py-4"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs">{c.wallet?.slice(0, 2)}</span><div className="min-w-0 flex-1"><div className="flex gap-2 text-xs"><span className="font-medium text-zinc-200">{c.wallet}</span><time className="text-zinc-500">{formatRelativeTime(now, c.createdAt)}</time></div><p className="my-2 whitespace-pre-wrap break-words text-sm leading-6">{c.body}</p><Link href={`/market/${c.characterId}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3"><img src={c.imageUrl} alt="" className="size-10 rounded-md object-cover" /><div className="min-w-0"><p className="truncate text-sm font-medium">{c.name}</p><p className="text-xs text-zinc-500">${c.ticker}</p></div><div className="ml-auto text-right"><p className="text-[10px] text-zinc-500">Current market cap</p><p className="text-sm tabular-nums text-[#d7ff00]">{usd(cap(String(c.characterId)), true)}</p></div></Link></div></motion.article>)}
    </div>
    </section>
    <section aria-label="Trending tokens" className="min-h-0 min-w-0 @3xl:overflow-y-auto @3xl:overscroll-contain"><div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-y border-white/10 bg-[#17191b]/90 px-5 backdrop-blur-xl @3xl:border-t-0"><span className="grid size-8 place-items-center rounded-[9px] border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.04] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_14px_-4px_rgba(0,0,0,0.6)] backdrop-blur-xl" aria-hidden="true"><Flame className="size-4" /></span><h2 className="text-[15px] font-semibold text-white">Trending</h2><span className="ml-auto text-[11px] text-zinc-500">Ranked by 24h volume · change since launch</span></div>
      {!ranked.length ? <p className="p-6 text-sm text-zinc-500">Confirmed tokens will appear here after launch.</p> : ranked.map((r, i) => {
        const obs = pools[r.characterId], c = cap(r.characterId), ch = obs?.available ? obs.changeSinceLaunchPct : null;
        const up = ch == null || ch >= 0, vol = Number(obs?.appVolume24hLamports ?? 0);
        const safe = (u?: string) => (u && u.startsWith("https://") ? u : undefined), xHref = safe(r.xUrl), webHref = safe(r.websiteUrl);
        const price = obs?.supplyTokens && c != null ? c / obs.supplyTokens : undefined;
        const tint = ch == null ? "rgba(255,255,255,0.03)" : up ? "rgba(52,211,153,0.17)" : "rgba(248,113,113,0.17)";
        return <motion.div key={r.characterId} initial={reduced ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }} style={{ backgroundImage: `linear-gradient(90deg, transparent 35%, ${tint})` }} className="group relative flex items-center gap-3 border-b border-white/[0.05] px-5 py-2.5 transition-colors hover:bg-white/[0.03]">
          <div className="flex min-w-0 flex-1 items-center gap-3"><Link href={`/market/${r.characterId}`} className="shrink-0"><img src={r.imageUrl} alt="" className="size-11 rounded-[8px] object-cover ring-1 ring-white/10" /></Link><div className="min-w-0"><div className="flex items-center gap-2"><Link href={`/market/${r.characterId}`} className="truncate text-[16px] font-extrabold uppercase leading-tight tracking-[0.01em] text-zinc-50 hover:text-white">{r.name}</Link>{i < 3 && vol > 0 && <span className="shrink-0 rounded-[6px] bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-400">Hot</span>}</div><div className="mt-0.5 flex items-center gap-2"><p className="truncate text-[12px] tabular-nums text-zinc-400">{price != null ? usd(price) : <span className="font-mono">${r.ticker}</span>}</p>{(xHref || webHref) && <span className="flex items-center gap-0.5">{xHref && <a href={xHref} target="_blank" rel="noopener noreferrer" aria-label={`${r.name} on X`} className="grid size-6 place-items-center rounded-full text-zinc-500 transition duration-200 hover:scale-110 hover:bg-white/10 hover:text-white"><svg viewBox="0 0 24 24" className="size-[13px] fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg></a>}{webHref && <a href={webHref} target="_blank" rel="noopener noreferrer" aria-label={`${r.name} website`} className="grid size-6 place-items-center rounded-full text-zinc-500 transition duration-200 hover:scale-110 hover:bg-white/10 hover:text-white"><Globe className="size-[13px]" /></a>}</span>}</div></div></div>
          <div className="w-[84px] shrink-0 text-right"><motion.p key={c} initial={reduced ? false : { opacity: 0.45 }} animate={{ opacity: 1 }} className={`text-[14px] font-semibold tabular-nums ${ch == null ? "text-zinc-200" : up ? "text-emerald-300" : "text-rose-300"}`}>{usd(c, true)}</motion.p><p className={`mt-0.5 text-[11px] font-semibold tabular-nums ${ch == null ? "text-zinc-500" : up ? "text-emerald-400" : "text-rose-400"}`}>{ch == null ? "—" : <>{up ? "↑" : "↓"} {pct(ch)}</>}</p></div>
        </motion.div>;
      })}
    </section>
    </div>
    <Dialog open={open} onOpenChange={value => { if (sending) return; if (!value) closeDialog(); else setOpen(true); }}><DialogContent className="border-white/15 bg-[#181a1c]/95 text-white backdrop-blur-2xl sm:max-w-xl"><DialogTitle className="text-xl tracking-tight">{posted ? "Callout posted" : "New callout"}</DialogTitle><DialogDescription className="text-zinc-500">{posted ? "Share your call and the card with your followers." : "Choose an agent and share your take with the community."}</DialogDescription>
      <CalloutCard3D data={cardData} burst={posted} />
      {!posted ? <>
        <Select value={characterId} onValueChange={v => setCharacterId(v ?? "")}><SelectTrigger className="w-full border-white/10 bg-white/5"><SelectValue placeholder="Choose an agent" /></SelectTrigger><SelectContent>{rows?.map(r => <SelectItem key={r.characterId} value={r.characterId}>{r.name} · ${r.ticker}</SelectItem>)}</SelectContent></Select>
        <Textarea value={body} onChange={e => setBody(e.target.value)} maxLength={280} rows={3} placeholder="What’s your call?" className="resize-none border-white/20 bg-white/[0.025] text-base" /><p className="text-right text-xs tabular-nums text-zinc-500">{280 - body.length}</p>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <Button disabled={!selected || !body.trim() || sending} onClick={() => void send()} className="ml-auto bg-[#d7ff00] text-black hover:bg-[#e4ff59]">{sending ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}{sending ? "Posting…" : selected ? `Call $${selected.ticker}` : "Post callout"}</Button>
      </> : <>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void shareToX()} className="bg-white text-black hover:bg-zinc-200"><svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>Share on X</Button>
          <Button variant="outline" onClick={() => void saveCard()} className="border-white/15 bg-white/5"><Download className="size-4" />Save card</Button>
          <Button variant="ghost" onClick={closeDialog} className="ml-auto text-zinc-400">Done</Button>
        </div>
        {note && <p role="status" className="text-xs text-zinc-400">{note}</p>}
      </>}
    </DialogContent></Dialog>
  </div>;
}
