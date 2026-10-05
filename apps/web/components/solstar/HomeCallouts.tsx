"use client";
/* eslint-disable @next/next/no-img-element -- hosted character portraits */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "framer-motion";
import { Flame, Megaphone, Plus, Loader2 } from "lucide-react";
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
    <div className="flex h-12 items-center gap-2 border-b border-white/10 px-5"><Megaphone className="size-4 text-zinc-400" /><h2 className="text-sm font-semibold">Callouts</h2><Button size="sm" variant="ghost" onClick={() => { setError(""); setOpen(true); }} className="ml-auto h-7 text-xs text-[#d7ff00]"><Plus className="size-3" /> New callout</Button></div>
    <div className="max-h-[360px] min-h-[180px] overflow-y-auto">
      {callouts === undefined ? <p className="p-6 text-sm text-zinc-500">Loading callouts…</p> : !callouts.length ? <p className="p-6 text-sm text-zinc-500">Call out an agent and start the conversation.</p> : callouts.map(c => <motion.article key={c.id} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 border-b border-white/5 px-5 py-4"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs">{c.wallet?.slice(0, 2)}</span><div className="min-w-0 flex-1"><div className="flex gap-2 text-xs"><span className="font-medium text-zinc-200">{c.wallet}</span><time className="text-zinc-500">{formatRelativeTime(now, c.createdAt)}</time></div><p className="my-2 whitespace-pre-wrap break-words text-sm leading-6">{c.body}</p><Link href={`/market/${c.characterId}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3"><img src={c.imageUrl} alt="" className="size-10 rounded-md object-cover" /><div className="min-w-0"><p className="truncate text-sm font-medium">{c.name}</p><p className="text-xs text-zinc-500">${c.ticker}</p></div><div className="ml-auto text-right"><p className="text-[10px] text-zinc-500">Current market cap</p><p className="text-sm tabular-nums text-[#d7ff00]">{usd(cap(String(c.characterId)), true)}</p></div></Link></div></motion.article>)}
    </div>
    <section aria-label="Trending tokens"><div className="flex h-12 items-center gap-2 border-y border-white/10 px-5"><Flame className="size-4 text-zinc-400" /><h2 className="text-sm font-semibold">Trending</h2><span className="ml-auto text-[10px] text-zinc-500">App volume · 24h · USD</span></div>
      {!ranked.length ? <p className="p-6 text-sm text-zinc-500">Confirmed tokens will appear here after launch.</p> : ranked.map(r => <Link key={r.characterId} href={`/market/${r.characterId}`} className="flex items-center gap-3 border-b border-white/5 px-5 py-4 transition-colors hover:bg-white/[0.04]"><img src={r.imageUrl} alt="" className="size-10 rounded-lg object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{r.name} <span className="font-normal text-zinc-500">${r.ticker}</span></p><p className="mt-1 text-xs tabular-nums text-zinc-500">{usd(pools[r.characterId]?.supplyTokens && cap(r.characterId) != null ? cap(r.characterId)! / pools[r.characterId].supplyTokens! : undefined)}</p></div><div className="text-right"><motion.p key={cap(r.characterId)} initial={reduced ? false : { opacity: 0.45 }} animate={{ opacity: 1 }} className="text-base font-semibold tabular-nums text-[#d7ff00]">{usd(cap(r.characterId), true)}</motion.p><p className="mt-1 text-[10px] tabular-nums text-zinc-500">Vol {usd(rate != null && pools[r.characterId]?.available ? Number(pools[r.characterId].appVolume24hLamports ?? 0) / 1e9 * rate : undefined, true)}</p></div></Link>)}
    </section>
    <Dialog open={open} onOpenChange={value => { if (!sending) setOpen(value); }}><DialogContent className="border-white/15 bg-[#181a1c]/95 text-white backdrop-blur-2xl sm:max-w-xl"><DialogTitle className="text-xl tracking-tight">New callout</DialogTitle><DialogDescription className="text-zinc-500">Choose an agent and share your take with the community.</DialogDescription><Select value={characterId} onValueChange={v => setCharacterId(v ?? "")}><SelectTrigger className="w-full border-white/10 bg-white/5"><SelectValue placeholder="Choose an agent" /></SelectTrigger><SelectContent>{rows?.map(r => <SelectItem key={r.characterId} value={r.characterId}>{r.name} · ${r.ticker}</SelectItem>)}</SelectContent></Select>{selected && <div className="flex items-center gap-3 border-y border-white/10 py-4"><img src={selected.imageUrl} alt="" className="size-12 rounded-lg object-cover" /><div><p className="font-semibold">{selected.name}</p><p className="text-sm text-zinc-500">${selected.ticker}</p></div><span className="ml-auto text-xs text-zinc-400">Current MC {usd(cap(characterId), true)}</span></div>}<Textarea value={body} onChange={e => setBody(e.target.value)} maxLength={280} rows={5} placeholder="What’s your call?" className="resize-none border-white/20 bg-white/[0.025] text-base" /><p className="text-right text-xs tabular-nums text-zinc-500">{280 - body.length}</p>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}<Button disabled={!selected || !body.trim() || sending} onClick={() => void send()} className="ml-auto bg-[#d7ff00] text-black hover:bg-[#e4ff59]">{sending ? <Loader2 className="size-4 animate-spin" /> : <Megaphone className="size-4" />}{sending ? "Posting…" : selected ? `Call $${selected.ticker}` : "Post callout"}</Button></DialogContent></Dialog>
  </div>;
}
