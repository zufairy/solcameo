"use client";
/* eslint-disable @next/next/no-img-element -- hosted portraits and user media */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, ChevronDown, ChevronUp, CornerDownRight, Loader2, MessageCircle, Minus, Plus, Send, Volume2, VolumeX, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ensureSiwsViaRegistered, getCurrentSiwsToken } from "@/lib/client/siwsIdentity";
import { formatRelativeTime } from "@/lib/solstar/relativeTime";
import { getTxExplorerUrl } from "@/lib/solana/network";
import type { CalloutCardData } from "@/lib/client/calloutCard";
import type { CalloutAttachment } from "@/lib/solstar/calloutMedia";
import { CalloutFeedCard } from "./CalloutFeedCard";
import { DbcTradeTicket } from "./DbcTradeTicket";
import { useNow } from "./feedShared";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

export type CalloutRowData = FunctionReturnType<typeof api.solstarFeed.listCallouts>[number];

const GLASS = "border border-white/[0.12] bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.02)_45%,rgba(255,255,255,0.05))] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_40px_120px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl";
const FEED_CARD_SCALE = 0.55;

/** Media sits directly on the card so GIF/image and P&L read as one object. */
export function CalloutBundle({ card, media, onOpen }: { card: CalloutCardData; media?: CalloutAttachment[]; onOpen?: () => void }) {
  const first = media?.[0];
  const [failed, setFailed] = useState(false);
  const showMedia = !!first && !failed;
  return <div className="w-fit max-w-full overflow-hidden rounded-xl border border-white/10 bg-black/30 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)]">
    {showMedia && <div className="relative max-h-[220px] overflow-hidden bg-white/[0.03]" style={{ width: 500 * FEED_CARD_SCALE * 1.45, maxWidth: "100%" }}>
      <img src={first.url} alt={first.alt} loading="lazy" onError={() => setFailed(true)} onClick={onOpen} className="max-h-[220px] w-full object-cover" />
      {first.type === "gif" && <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-md">GIF</span>}
    </div>}
    <div className="relative overflow-hidden" style={{ width: 500 * FEED_CARD_SCALE, height: 100 * FEED_CARD_SCALE, maxWidth: "100%" }}>
      <div className="origin-top-left" style={{ width: 500, transform: `scale(${FEED_CARD_SCALE})` }}><CalloutFeedCard data={card} bare /></div>
    </div>
  </div>;
}

/** One callout in the feed: author on top, copy, then the joined media + P&L card. Opens the thread. */
export function CalloutRow({ c, card, now, replies, index, onOpen }: { c: CalloutRowData; card: CalloutCardData; now: number; replies: number; index: number; onOpen: () => void }) {
  const reduced = useReducedMotion();
  return <motion.article
    initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.03 }}
    role="button" tabIndex={0} aria-label={`Open thread: ${c.name} ${c.ticker ? `$${c.ticker}` : ""}`}
    onClick={onOpen} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
    className="group flex cursor-pointer gap-3 border-b border-white/5 px-4 py-3.5 outline-none transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.04]">
    <img src={c.authorImage} alt="" className="size-9 shrink-0 rounded-full bg-white/10 object-cover ring-1 ring-white/10" />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5 text-[13px]"><span className="truncate font-semibold text-white">{c.authorName}</span><time className="shrink-0 text-xs text-zinc-500">{formatRelativeTime(now, c.createdAt)}</time></div>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 text-zinc-200">{c.body}</p>
      <div className="mt-2.5"><CalloutBundle card={card} media={c.attachments} onOpen={onOpen} /></div>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5 transition-colors group-hover:text-zinc-300"><MessageCircle className="size-3.5" />{replies > 0 ? replies : "Reply"}</span>
        {c.onchainTrade && <a href={getTxExplorerUrl(c.onchainTrade.signature, c.onchainTrade.network === "mainnet" ? "mainnet-beta" : "devnet")} onClick={e => e.stopPropagation()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:text-zinc-200">Confirmed {c.onchainTrade.side}<ArrowUpRight className="size-3" /></a>}
      </div>
    </div>
  </motion.article>;
}

/** Glass popup: the thread on the left, the influencer's latest videos (TikTok style) with a Buy overlay on the right. */
export function CalloutThreadDialog({ c, card, onClose }: { c: CalloutRowData | null; card: CalloutCardData | null; onClose: () => void }) {
  return <Dialog open={!!c} onOpenChange={v => { if (!v) onClose(); }}>
    <DialogContent showCloseButton={false} className={`${GLASS} h-[min(88dvh,780px)] w-[min(96vw,1100px)] max-w-none gap-0 overflow-hidden rounded-3xl bg-[#0b0d0f]/80 p-0 font-apple text-white antialiased sm:max-w-none`}>
      <DialogTitle className="sr-only">Callout thread</DialogTitle>
      {c && card && <ThreadBody key={c.id} c={c} card={card} onClose={onClose} />}
    </DialogContent>
  </Dialog>;
}

function ThreadBody({ c, card, onClose }: { c: CalloutRowData; card: CalloutCardData; onClose: () => void }) {
  const now = useNow(30000);
  const replies = useQuery(api.solstarFeed.listReplies, { calloutId: c.id as Id<"ssFeed"> });
  const feed = useQuery(api.solstarFeed.creatorFeed, c.trader ? { mint: c.mint ?? undefined } : { characterId: c.characterId as Id<"ssCharacters"> });
  const { authenticated, login } = useSupabaseAuth();
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const count = replies?.length ?? 0;
  const { roots, children } = useMemo(() => {
    const kids = new Map<string, NonNullable<typeof replies>>();
    const top: NonNullable<typeof replies> = [];
    const ids = new Set((replies ?? []).map(r => r.id));
    for (const r of replies ?? []) {
      if (r.parentId && ids.has(r.parentId)) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r]);
      else top.push(r);
    }
    return { roots: top, children: kids };
  }, [replies]);
  /** Posts a reply (top-level when parentId is null). Returns true on success. */
  async function send(body: string, parentId: string | null): Promise<boolean> {
    setError("");
    if (!authenticated) { login(); setError("Sign in to join the thread."); return false; }
    try {
      if (!getCurrentSiwsToken() && !(await ensureSiwsViaRegistered())) throw new Error("Connect your Solana wallet and approve the sign-in message to reply.");
      const res = await fetch("/api/solstar/feed/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ calloutId: c.id, body, ...(parentId ? { parentId } : {}) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "rate_limited") throw new Error("Slow down a little before replying again.");
        if (data.error === "duplicate_message") throw new Error("You already sent that reply.");
        if (data.code === "siws_required" || res.status === 401) throw new Error("Connect your Solana wallet and approve the sign-in message to reply.");
        throw new Error("Could not post your reply right now. Please try again.");
      }
      setReplyTo(null);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send reply."); return false; }
  }
  const toggle = (id: string) => setCollapsed(prev => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });
  const token = feed?.token;
  return <div className="grid h-full min-h-0 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
    <section className="flex min-h-0 min-w-0 flex-col border-white/10 md:border-r" aria-label="Thread">
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-4">
        <img src={c.imageUrl} alt="" className="size-11 rounded-full bg-white/10 object-cover ring-1 ring-white/15" />
        <div className="min-w-0 flex-1"><p className="truncate text-base font-semibold tracking-tight">{c.name}</p><p className="truncate text-xs text-zinc-400">{c.ticker ? `$${c.ticker.toUpperCase()}` : "Trader"}</p></div>
        {!c.trader && <Link href={`/market/${c.characterId}`} className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/[0.06] px-3.5 text-sm font-medium transition-colors hover:bg-white/[0.12]">View coin</Link>}
        <button type="button" onClick={onClose} aria-label="Close thread" className="grid size-9 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white md:hidden"><X className="size-4" /></button>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <ThreadItem image={c.authorImage} name={c.authorName} time={formatRelativeTime(now, c.createdAt)} line={false}>
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-zinc-100">{c.body}</p>
          <div className="mt-3"><CalloutBundle card={card} media={c.attachments} /></div>
          <p className="mt-3 text-xs font-medium text-zinc-500">{count} {count === 1 ? "reply" : "replies"}</p>
        </ThreadItem>
        {replies === undefined ? <p className="py-6 text-center text-xs text-zinc-500">Loading replies…</p> : roots.map(r =>
          <Comment key={r.id} r={r} depth={0} now={now} kidsOf={children} collapsed={collapsed} onToggle={toggle} replyTo={replyTo} onReply={setReplyTo} onSend={send} />)}
        {replies && !replies.length && <p className="pl-[52px] pt-1 text-xs text-zinc-500">No replies yet. Start the thread.</p>}
      </div>
      <div className="shrink-0 border-t border-white/10 bg-black/20 p-3.5">
        {error && <p role="status" className="mb-2 px-1 text-xs text-amber-300/90">{error}</p>}
        <ReplyBox placeholder={`Reply to ${c.authorName}…`} onSend={text => send(text, null)} />
      </div>
    </section>
    <aside className="relative hidden min-h-0 bg-black md:block" aria-label={`Latest from ${c.name}`}>
      <button type="button" onClick={onClose} aria-label="Close thread" className="absolute right-3 top-3 z-30 grid size-9 place-items-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/70"><X className="size-4" /></button>
      <VideoFeed loading={feed === undefined} videos={feed?.videos ?? []} token={token ?? null} fallbackName={c.name} fallbackImage={c.imageUrl} />
    </aside>
  </div>;
}

type ReplyRow = NonNullable<FunctionReturnType<typeof api.solstarFeed.listReplies>>[number];

/** Input + send button used for the post's top-level reply and for inline replies under a comment. */
function ReplyBox({ placeholder, onSend, onCancel, autoFocus }: { placeholder: string; onSend: (text: string) => Promise<boolean>; onCancel?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState(""), [sending, setSending] = useState(false);
  async function submit() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await onSend(body);
    setSending(false);
    if (ok) setText("");
  }
  return <form onSubmit={e => { e.preventDefault(); void submit(); }} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-white/25">
    <input autoFocus={autoFocus} value={text} onChange={e => setText(e.target.value.slice(0, 280))} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500" />
    {onCancel && <button type="button" onClick={onCancel} className="px-2 text-xs font-medium text-zinc-400 hover:text-white">Cancel</button>}
    <button type="submit" disabled={!text.trim() || sending} aria-label="Send reply" className="grid size-9 place-items-center rounded-xl bg-[#d7ff00] text-black transition hover:bg-[#e4ff59] active:scale-95 disabled:opacity-40">{sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</button>
  </form>;
}

/** One Reddit-style comment: collapsible thread line, inline reply box, nested children. */
function Comment({ r, depth, now, kidsOf, collapsed, onToggle, replyTo, onReply, onSend }: {
  r: ReplyRow; depth: number; now: number; kidsOf: Map<string, ReplyRow[]>; collapsed: Set<string>;
  onToggle: (id: string) => void; replyTo: string | null; onReply: (id: string | null) => void; onSend: (text: string, parentId: string | null) => Promise<boolean>;
}) {
  const kids = kidsOf.get(r.id) ?? [];
  const isCollapsed = collapsed.has(r.id);
  const total = (function count(id: string): number { return (kidsOf.get(id) ?? []).reduce((n, k) => n + 1 + count(k.id), 0); })(r.id);
  return <div className="flex gap-2.5 pt-3">
    <div className="flex w-8 shrink-0 flex-col items-center">
      <img src={r.imageUrl} alt="" className="size-7 rounded-full bg-white/10 object-cover ring-1 ring-white/10" />
      {!isCollapsed && (kids.length > 0 || replyTo === r.id) && <button type="button" onClick={() => onToggle(r.id)} aria-label={`Collapse thread from ${r.name}`} className="group mt-1 flex w-4 flex-1 justify-center"><span className="w-0.5 rounded-full bg-white/10 transition-colors group-hover:bg-[#d7ff00]/70" /></button>}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="truncate text-[13px] font-semibold text-white">{r.name}</span>
        <span className="text-zinc-500">{formatRelativeTime(now, r.createdAt)}</span>
        {isCollapsed && <button type="button" onClick={() => onToggle(r.id)} className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-white/15"><Plus className="size-3" />{total + 1} {total ? "replies" : "reply"}</button>}
        {!isCollapsed && kids.length > 0 && <button type="button" onClick={() => onToggle(r.id)} aria-label="Collapse thread" className="ml-auto grid size-5 place-items-center rounded text-zinc-600 hover:bg-white/10 hover:text-white"><Minus className="size-3" /></button>}
      </div>
      {!isCollapsed && <>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{r.body}</p>
        <button type="button" onClick={() => onReply(replyTo === r.id ? null : r.id)} className="mt-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white"><CornerDownRight className="size-3.5" />Reply</button>
        {replyTo === r.id && <div className="mt-1.5"><ReplyBox autoFocus placeholder={`Reply to ${r.name}…`} onCancel={() => onReply(null)} onSend={text => onSend(text, r.id)} /></div>}
        {kids.length > 0 && <div className="mt-0.5">{kids.map(k => <Comment key={k.id} r={k} depth={depth + 1} now={now} kidsOf={kidsOf} collapsed={collapsed} onToggle={onToggle} replyTo={replyTo} onReply={onReply} onSend={onSend} />)}</div>}
      </>}
    </div>
  </div>;
}

function ThreadItem({ image, name, time, line, children }: { image: string; name: string; time: string; line: boolean; children: React.ReactNode }) {
  return <div className="relative flex gap-3 pb-5">
    {line && <span aria-hidden className="absolute bottom-0 left-[18px] top-11 w-px bg-white/10" />}
    <img src={image} alt="" className="relative size-9 shrink-0 rounded-full bg-white/10 object-cover ring-1 ring-white/10" />
    <div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><span className="truncate text-sm font-semibold">{name}</span><span className="text-xs text-zinc-500">{time}</span></div>{children}</div>
  </div>;
}

type FeedToken = NonNullable<FunctionReturnType<typeof api.solstarFeed.creatorFeed>>["token"];
type FeedVideo = NonNullable<FunctionReturnType<typeof api.solstarFeed.creatorFeed>>["videos"][number];

/** Vertical scroll-snap feed. Only the neighbours of the visible clip mount a <video>, and only the visible one plays. */
function VideoFeed({ videos, token, loading, fallbackName, fallbackImage }: { videos: FeedVideo[]; token: FeedToken | null; loading: boolean; fallbackName: string; fallbackImage: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0), [muted, setMuted] = useState(true), [buying, setBuying] = useState(false);
  const goto = (i: number) => { const el = scroller.current; if (el) el.scrollTo({ top: Math.max(0, Math.min(videos.length - 1, i)) * el.clientHeight, behavior: "smooth" }); };
  const buy = token && (token.tradable && token.mint
    ? <button type="button" onClick={() => setBuying(true)} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#d7ff00] px-6 text-sm font-semibold text-black shadow-[0_10px_30px_-8px_rgba(215,255,0,0.55)] transition hover:bg-[#e4ff59] active:scale-95">Buy ${token.ticker.toUpperCase()}</button>
    : <Link href={`/market/${token.characterId}`} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#d7ff00] px-6 text-sm font-semibold text-black transition hover:bg-[#e4ff59] active:scale-95">View ${token.ticker.toUpperCase()}</Link>);
  return <div className="relative h-full overflow-hidden">
    {loading ? <div className="grid h-full place-items-center"><Loader2 className="size-5 animate-spin text-zinc-500" /></div> : !videos.length ? <div className="relative grid h-full place-items-center overflow-hidden px-8 text-center">
      <img src={fallbackImage} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-25 blur-2xl" />
      <div className="relative"><img src={fallbackImage} alt="" className="mx-auto size-24 rounded-2xl object-cover ring-1 ring-white/20" /><p className="mt-4 text-base font-semibold">{fallbackName}</p><p className="mt-1 text-sm text-zinc-400">No videos posted yet.</p><div className="mt-5">{buy}</div></div>
    </div> : <>
      <div ref={scroller} onScroll={e => { const el = e.currentTarget; setActive(Math.round(el.scrollTop / Math.max(1, el.clientHeight))); }} className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {videos.map((v, i) => <Slide key={v.id} v={v} near={Math.abs(i - active) <= 1} playing={i === active && !buying} muted={muted} token={token} />)}
      </div>
      <div className="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2">
        <button type="button" aria-label="Previous video" disabled={active === 0} onClick={() => goto(active - 1)} className="grid size-9 place-items-center rounded-full border border-white/15 bg-black/35 backdrop-blur-md transition hover:bg-black/60 disabled:opacity-30"><ChevronUp className="size-4" /></button>
        <button type="button" aria-label="Next video" disabled={active >= videos.length - 1} onClick={() => goto(active + 1)} className="grid size-9 place-items-center rounded-full border border-white/15 bg-black/35 backdrop-blur-md transition hover:bg-black/60 disabled:opacity-30"><ChevronDown className="size-4" /></button>
        <button type="button" aria-label={muted ? "Unmute" : "Mute"} onClick={() => setMuted(m => !m)} className="grid size-9 place-items-center rounded-full border border-white/15 bg-black/35 backdrop-blur-md transition hover:bg-black/60">{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button>
      </div>
      {buy && <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-black/70 to-transparent px-4 pb-5 pt-12">{buy}</div>}
    </>}
    <AnimatePresence>
      {buying && token && <>
        <motion.button type="button" aria-label="Close buy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setBuying(false)} className="absolute inset-0 z-30 bg-black/50 backdrop-blur-sm" />
        <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 36 }} className={`${GLASS} absolute inset-x-0 bottom-0 z-40 max-h-[85%] overflow-y-auto rounded-t-3xl bg-[#101214]/90`}>
          <div className="flex items-center gap-3 px-4 pt-4"><img src={token.imageUrl} alt="" className="size-9 rounded-xl object-cover" /><p className="min-w-0 flex-1 truncate text-sm font-semibold">Buy ${token.ticker.toUpperCase()}</p><button type="button" onClick={() => setBuying(false)} aria-label="Close" className="grid size-8 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"><X className="size-4" /></button></div>
          <DbcTradeTicket characterId={token.characterId as Id<"ssCharacters">} ticker={token.ticker} network={token.network} mint={token.mint ?? undefined} />
        </motion.div>
      </>}
    </AnimatePresence>
  </div>;
}

function Slide({ v, near, playing, muted, token }: { v: FeedVideo; near: boolean; playing: boolean; muted: boolean; token: FeedToken | null }) {
  const video = useRef<HTMLVideoElement>(null), bar = useRef<HTMLSpanElement>(null);
  const [paused, setPaused] = useState(false), [ready, setReady] = useState(false);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (playing && !paused) void el.play().catch(() => undefined);
    else { el.pause(); if (!playing) el.currentTime = 0; }
  }, [playing, paused, near]);
  return <div className="relative h-full w-full snap-start snap-always overflow-hidden bg-black" onClick={() => setPaused(p => !p)}>
    {v.poster && <img src={v.poster} alt="" className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${ready ? "opacity-0" : "opacity-100"}`} />}
    {near && <video ref={video} src={v.url} poster={v.poster ?? undefined} muted={muted} loop playsInline preload="auto" onLoadedData={() => setReady(true)}
      onTimeUpdate={e => { const t = e.currentTarget; if (bar.current && t.duration) bar.current.style.transform = `scaleX(${t.currentTime / t.duration})`; }}
      className="absolute inset-0 size-full object-cover" />}
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
    <AnimatePresence>{paused && playing && <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 grid place-items-center"><span className="grid size-16 place-items-center rounded-full bg-black/50 backdrop-blur-md"><span className="ml-1 size-0 border-y-[11px] border-l-[18px] border-y-transparent border-l-white" /></span></motion.div>}</AnimatePresence>
    <div className="pointer-events-none absolute inset-x-4 bottom-24 pr-12">
      {token && <p className="text-[13px] font-semibold text-white drop-shadow">@{token.name.replace(/\s+/g, "").toLowerCase()}</p>}
      {v.caption && <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-white/85 drop-shadow">{v.caption}</p>}
    </div>
    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/15"><span ref={bar} className="block h-full origin-left bg-[#d7ff00]" style={{ transform: "scaleX(0)" }} /></span>
  </div>;
}

export function useReplyCounts(ids: string[]): Record<string, number> {
  return useQuery(api.solstarFeed.replyCounts, ids.length ? { calloutIds: ids.slice(0, 40) as Id<"ssFeed">[] } : "skip") ?? {};
}
