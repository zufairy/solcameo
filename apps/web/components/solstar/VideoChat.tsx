"use client";
/* eslint-disable @next/next/no-img-element -- member avatars hosted on remote storage */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Loader2, MessageCircle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { ensureSiwsViaRegistered, getCurrentSiwsToken } from "@/lib/client/siwsIdentity";
import { shortWallet } from "@/lib/solstar/feed";
import { formatRelativeTime } from "@/lib/solstar/relativeTime";
import { useNow } from "./feedShared";

const MAX = 280;
const GROUP_MS = 5 * 60_000; // messages from one person within this window share a name, avatar and time

type Message = { id: string; wallet: string; name: string; imageUrl: string; body: string; createdAt: number; mine: boolean; pending?: boolean; failed?: boolean };
type Pending = { id: string; body: string; createdAt: number; failed?: boolean };

/**
 * Chat under one made video, in a glass panel beside the player. The conversation opens already loaded with what was
 * said before, live from Convex, and lands at the newest message. Your own message appears the instant you send it
 * and settles when the server confirms. Messages from one person in a row are grouped like iMessage.
 */
export function VideoChat({ videoKey, characterId, className = "" }: { videoKey: string; characterId: string | null; className?: string }) {
  const { publicKey } = useUnifiedSolanaWallet();
  const { authenticated, login } = useSupabaseAuth();
  const me = publicKey ? shortWallet(publicKey.toBase58()) : null;
  const rows = useQuery(api.solstarFeed.listVideoComments, { videoKey });
  const now = useNow(30_000);
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [mountedAt] = useState(() => Date.now()); // history appears at rest; only messages after this animate in
  const [away, setAway] = useState(0); // messages that arrived while scrolled up
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const seen = useRef(0);

  const messages = useMemo<Message[]>(() => {
    const server: Message[] = (rows ?? []).map((r) => ({ ...r, mine: !!me && r.wallet === me }));
    const mine = server.filter((m) => m.mine);
    // A pending message is replaced by the server copy as soon as that arrives.
    const waiting = pending.filter((p) => !mine.some((m) => m.body === p.body && m.createdAt >= p.createdAt - 10_000))
      .map<Message>((p) => ({ id: p.id, wallet: me ?? "", name: "You", imageUrl: "", body: p.body, createdAt: p.createdAt, mine: true, pending: !p.failed, failed: p.failed }));
    return [...server, ...waiting];
  }, [rows, pending, me]);

  const toBottom = useCallback((smooth: boolean) => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    stick.current = true; setAway(0);
  }, []);
  // Open at the newest message, before the first paint of the history.
  const opened = useRef(false);
  useLayoutEffect(() => { if (rows !== undefined && !opened.current) { opened.current = true; seen.current = rows.length; toBottom(false); } }, [rows, toBottom]);
  useEffect(() => {
    if (!opened.current) return;
    const added = messages.length - seen.current;
    seen.current = messages.length;
    if (added <= 0) return;
    const last = messages[messages.length - 1];
    if (stick.current || last?.mine) toBottom(true);
    else setAway((n) => n + added);
  }, [messages, toBottom]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setError("");
    if (!authenticated) { login(); setError("Sign in to join the chat."); return; }
    const id = `pending-${Date.now()}`;
    setPending((p) => [...p, { id, body, createdAt: Date.now() }]);
    setText(""); input.current?.focus();
    try {
      if (!getCurrentSiwsToken() && !(await ensureSiwsViaRegistered())) throw new Error("Connect your Solana wallet and approve the sign-in message to chat.");
      const res = await fetch("/api/solstar/video-comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoKey, body, ...(characterId ? { characterId } : {}) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "rate_limited") throw new Error("Slow down a little before sending again.");
        if (data.error === "duplicate_message") throw new Error("You already sent that.");
        if (data.code === "siws_required" || res.status === 401) throw new Error("Connect your Solana wallet and approve the sign-in message to chat.");
        throw new Error("Could not send right now. Try again.");
      }
    } catch (e) {
      setPending((p) => p.map((m) => (m.id === id ? { ...m, failed: true } : m)));
      setError(e instanceof Error ? e.message : "Could not send right now. Try again.");
    }
  }
  const retry = (m: Message) => { setPending((p) => p.filter((x) => x.id !== m.id)); setText(m.body); };
  const fit = (el: HTMLTextAreaElement) => { el.style.height = "0px"; el.style.height = `${Math.min(110, el.scrollHeight)}px`; };

  return (
    <section aria-label="Video chat" className={`relative flex min-h-0 flex-col overflow-hidden border border-white/[0.14] bg-[linear-gradient(160deg,rgba(255,255,255,0.12),rgba(255,255,255,0.035)_40%,rgba(255,255,255,0.07))] font-apple text-white antialiased shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_30px_90px_-24px_rgba(0,0,0,0.85)] backdrop-blur-2xl ${className}`}>
      <header className="flex shrink-0 items-center gap-2.5 border-b border-white/10 px-4 py-3">
        <MessageCircle aria-hidden className="size-[18px] text-white/70" />
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Chat</h2>
        <span className="rounded-[3px] bg-white/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white/70">{messages.length}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-white/50"><span className="size-1.5 animate-pulse rounded-full bg-[#d7ff00]" />Live</span>
      </header>

      <div ref={list} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; if (stick.current) setAway(0); }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="log" aria-live="polite" aria-relevant="additions">
        {rows === undefined ? (
          <div className="space-y-3" aria-busy="true">{[62, 40, 74, 52].map((w, i) => <div key={i} className={`flex gap-2 ${i % 2 ? "justify-end" : ""}`}><div className="h-9 animate-pulse rounded-[10px] bg-white/[0.07]" style={{ width: `${w}%` }} /></div>)}</div>
        ) : !messages.length ? (
          <div className="grid h-full place-items-center px-6 text-center"><div><MessageCircle aria-hidden className="mx-auto size-7 text-white/30" /><p className="mt-3 text-[14px] font-semibold">No messages yet</p><p className="mt-1 text-[13px] leading-5 text-white/50">Be the first to say something about this video.</p></div></div>
        ) : messages.map((m, i) => {
          const prev = messages[i - 1], next = messages[i + 1];
          const joinsPrev = !!prev && prev.mine === m.mine && prev.wallet === m.wallet && m.createdAt - prev.createdAt < GROUP_MS;
          const joinsNext = !!next && next.mine === m.mine && next.wallet === m.wallet && next.createdAt - m.createdAt < GROUP_MS;
          // The corner that points at the sender flattens where bubbles stack, like iMessage.
          const tail = m.mine ? `${joinsPrev ? "rounded-tr-[5px]" : ""} rounded-br-[5px]` : `${joinsPrev ? "rounded-tl-[5px]" : ""} rounded-bl-[5px]`;
          return (
            <motion.div key={m.id} layout="position" initial={m.pending || m.createdAt >= mountedAt ? { opacity: 0, y: 8, scale: 0.98 } : false} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className={`flex items-end gap-2 ${m.mine ? "flex-row-reverse" : ""} ${joinsPrev ? "mt-0.5" : "mt-3 first:mt-0"}`}>
              {!m.mine && (joinsNext ? <span className="size-7 shrink-0" /> : <img src={m.imageUrl} alt="" className="size-7 shrink-0 rounded-[4px] bg-white/10 object-cover ring-1 ring-white/15" />)}
              <div className={`flex min-w-0 max-w-[82%] flex-col ${m.mine ? "items-end" : "items-start"}`}>
                {!m.mine && !joinsPrev && <span className="mb-1 ml-1 truncate text-[12px] font-semibold text-white/75">{m.name}</span>}
                <p className={`whitespace-pre-wrap break-words rounded-[14px] px-3 py-[7px] text-[14px] leading-[19px] tracking-[-0.005em] ${tail} ${m.pending ? "opacity-60" : ""} ${
                  m.mine ? "bg-[#d7ff00] text-black shadow-[0_6px_18px_-8px_rgba(215,255,0,0.5)]" : "border border-white/[0.1] bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md"}`}>{m.body}</p>
                {!joinsNext && (
                  <span className="mx-1 mt-1 text-[11px] text-white/40">
                    {m.failed ? <button type="button" onClick={() => retry(m)} className="font-medium text-rose-300 hover:underline">Not sent. Tap to edit</button> : m.pending ? "Sending…" : formatRelativeTime(now, m.createdAt)}
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {away > 0 && (
        <button type="button" onClick={() => toBottom(true)} className="absolute bottom-[84px] left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-[4px] border border-white/20 bg-black/55 px-3 py-1.5 text-[12px] font-semibold text-white shadow-lg backdrop-blur-xl transition hover:bg-black/75">
          <ArrowDown className="size-3.5" />{away} new {away === 1 ? "message" : "messages"}
        </button>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="shrink-0 border-t border-white/10 bg-black/25 p-3">
        {error && <p role="status" className="mb-2 px-1 text-[12px] text-amber-300/90">{error}</p>}
        <div className="flex items-end gap-2 rounded-[12px] border border-white/[0.14] bg-white/[0.07] py-1.5 pl-3.5 pr-1.5 transition-colors focus-within:border-white/35 focus-within:bg-white/[0.1]">
          <textarea ref={input} value={text} rows={1} maxLength={MAX} placeholder={authenticated ? "Message…" : "Sign in to chat"} aria-label="Write a message"
            onChange={(e) => { setText(e.target.value); fit(e.currentTarget); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            className="max-h-[110px] min-h-[24px] min-w-0 flex-1 resize-none self-center bg-transparent text-[14px] leading-6 text-white outline-none placeholder:text-white/40" />
          {text.length > MAX - 60 && <span className="self-center text-[11px] tabular-nums text-white/40">{MAX - text.length}</span>}
          <button type="submit" disabled={!text.trim()} aria-label="Send message" className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#d7ff00] text-black transition hover:bg-[#e4ff59] active:scale-95 disabled:bg-white/15 disabled:text-white/35">
            {pending.some((p) => !p.failed) && !text.trim() ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" strokeWidth={2.6} />}
          </button>
        </div>
      </form>
    </section>
  );
}
