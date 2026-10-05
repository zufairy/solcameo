"use client";
/* eslint-disable @next/next/no-img-element -- hosted character portraits */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { Globe, Megaphone, Loader2 } from "lucide-react";
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

type Observation = { available: boolean; capSol?: number; supplyTokens?: number; changeSinceLaunchPct?: number; appVolume24hLamports?: string };
const APPLE = { fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", var(--font-inter), system-ui, sans-serif' } as const;
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
  const [open, setOpen] = useState(false), [characterId, setCharacterId] = useState(""), [body, setBody] = useState(""), [sending, setSending] = useState(false), [error, setError] = useState("");
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
      setOpen(false); setBody("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not post callout."); } finally { setSending(false); }
  }
  const ranked = [...(rows ?? []).slice(0, 20)].sort((a, b) => Number(pools[b.characterId]?.appVolume24hLamports ?? 0) - Number(pools[a.characterId]?.appVolume24hLamports ?? 0));
  return <div className="min-w-0 text-zinc-200">
    <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5" style={APPLE}><span className="text-[18px] leading-none" aria-hidden="true">📣</span><h2 className="text-[19px] font-semibold tracking-[-0.022em] text-white">Callouts</h2><Button onClick={() => { setError(""); setOpen(true); }} className="ml-auto flex h-8 items-center gap-2 rounded-md border border-white/15 bg-[#d7ff00] px-4 text-xs font-semibold text-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] transition-colors hover:bg-[#e3ff5c]"><Megaphone className="size-4" />New callout</Button></div>
    <div className="max-h-[360px] min-h-[180px] overflow-y-auto">
      {callouts === undefined ? <p className="p-6 text-sm text-zinc-500">Loading callouts…</p> : !callouts.length ? <p className="p-6 text-sm text-zinc-500">Call out an agent and start the conversation.</p> : callouts.map(c => <motion.article key={c.id} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 border-b border-white/5 px-5 py-4"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs">{c.wallet?.slice(0, 2)}</span><div className="min-w-0 flex-1"><div className="flex gap-2 text-xs"><span className="font-medium text-zinc-200">{c.wallet}</span><time className="text-zinc-500">{formatRelativeTime(now, c.createdAt)}</time></div><p className="my-2 whitespace-pre-wrap break-words text-sm leading-6">{c.body}</p><Link href={`/market/${c.characterId}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3"><img src={c.imageUrl} alt="" className="size-10 rounded-md object-cover" /><div className="min-w-0"><p className="truncate text-sm font-medium">{c.name}</p><p className="text-xs text-zinc-500">${c.ticker}</p></div><div className="ml-auto text-right"><p className="text-[10px] text-zinc-500">Current market cap</p><p className="text-sm tabular-nums text-[#d7ff00]">{usd(cap(String(c.characterId)), true)}</p></div></Link></div></motion.article>)}
    </div>
    <section aria-label="Trending tokens"><div className="flex h-14 items-center gap-3 border-y border-white/10 px-5" style={APPLE}><span className="text-[18px] leading-none" aria-hidden="true">🔥</span><h2 className="text-[19px] font-semibold tracking-[-0.022em] text-white">Trending</h2><span className="ml-auto text-[11px] text-zinc-500">Ranked by 24h volume · change since launch</span></div>
      {!ranked.length ? <p className="p-6 text-sm text-zinc-500">Confirmed tokens will appear here after launch.</p> : ranked.map((r, i) => {
        const obs = pools[r.characterId], c = cap(r.characterId), ch = obs?.available ? obs.changeSinceLaunchPct : null;
        const up = ch == null || ch >= 0, vol = Number(obs?.appVolume24hLamports ?? 0);
        const price = obs?.supplyTokens && c != null ? c / obs.supplyTokens : undefined;
        const tint = ch == null ? "rgba(255,255,255,0.03)" : up ? "rgba(52,211,153,0.17)" : "rgba(248,113,113,0.17)";
        return <motion.div key={r.characterId} initial={reduced ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }} style={{ ...APPLE, backgroundImage: `linear-gradient(90deg, transparent 35%, ${tint})` }} className="group relative flex items-center gap-4 border-b border-white/[0.05] px-5 py-4 transition-colors hover:bg-white/[0.03]">
          <Link href={`/market/${r.characterId}`} className="flex min-w-0 flex-1 items-center gap-4"><img src={r.imageUrl} alt="" className="size-14 shrink-0 rounded-[10px] object-cover ring-1 ring-white/10" /><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-[19px] font-semibold tracking-[-0.02em] text-zinc-100">{r.name}</p>{i < 3 && vol > 0 && <span className="shrink-0 rounded-[5px] bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-400">Hot</span>}</div><p className="mt-0.5 truncate text-[15px] tabular-nums text-zinc-400">{price != null ? usd(price) : <span className="font-mono text-[13px]">${r.ticker}</span>}</p></div></Link>
          <div className="flex shrink-0 items-center gap-3"><a href={`https://x.com/search?q=${encodeURIComponent(`$${r.ticker}`)}&f=live`} target="_blank" rel="noopener noreferrer" aria-label={`Search $${r.ticker} on X`} className="grid size-8 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"><svg viewBox="0 0 24 24" className="size-[17px] fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg></a><Link href={`/market/${r.characterId}`} aria-label={`Open ${r.name} market`} className="grid size-8 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"><Globe className="size-[17px]" /></Link></div>
          <div className="w-[104px] shrink-0 text-right"><motion.p key={c} initial={reduced ? false : { opacity: 0.45 }} animate={{ opacity: 1 }} className={`text-[21px] font-bold tabular-nums tracking-[-0.02em] ${ch == null ? "text-zinc-200" : up ? "text-emerald-300" : "text-rose-300"}`}>{usd(c, true)}</motion.p><p className={`mt-0.5 text-[14px] font-semibold tabular-nums ${ch == null ? "text-zinc-500" : up ? "text-emerald-400" : "text-rose-400"}`}>{ch == null ? "—" : <>{up ? "↑" : "↓"} {pct(ch)}</>}</p></div>
        </motion.div>;
      })}
    </section>
    <Dialog open={open} onOpenChange={value => { if (!sending) setOpen(value); }}><DialogContent className="border-white/15 bg-[#181a1c]/95 text-white backdrop-blur-2xl sm:max-w-xl"><DialogTitle className="text-xl tracking-tight">New callout</DialogTitle><DialogDescription className="text-zinc-500">Choose an agent and share your take with the community.</DialogDescription><Select value={characterId} onValueChange={v => setCharacterId(v ?? "")}><SelectTrigger className="w-full border-white/10 bg-white/5"><SelectValue placeholder="Choose an agent" /></SelectTrigger><SelectContent>{rows?.map(r => <SelectItem key={r.characterId} value={r.characterId}>{r.name} · ${r.ticker}</SelectItem>)}</SelectContent></Select>{selected && <div className="flex items-center gap-3 border-y border-white/10 py-4"><img src={selected.imageUrl} alt="" className="size-12 rounded-lg object-cover" /><div><p className="font-semibold">{selected.name}</p><p className="text-sm text-zinc-500">${selected.ticker}</p></div><span className="ml-auto text-xs text-zinc-400">Current MC {usd(cap(characterId), true)}</span></div>}<Textarea value={body} onChange={e => setBody(e.target.value)} maxLength={280} rows={5} placeholder="What’s your call?" className="resize-none border-white/20 bg-white/[0.025] text-base" /><p className="text-right text-xs tabular-nums text-zinc-500">{280 - body.length}</p>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}<Button disabled={!selected || !body.trim() || sending} onClick={() => void send()} className="ml-auto bg-[#d7ff00] text-black hover:bg-[#e4ff59]">{sending ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}{sending ? "Posting…" : selected ? `Call $${selected.ticker}` : "Post callout"}</Button></DialogContent></Dialog>
  </div>;
}
