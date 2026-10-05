"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { X, ArrowUp } from "lucide-react";
import flashAvatar from "@/assets/flash.jpeg";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

type Msg = { role: "user" | "assistant"; content: string; at: number };

const EASE = [0.16, 1, 0.3, 1] as const;
const WELCOME: Msg = {
  role: "assistant",
  content: "Hey! 👋 I'm the Solcameo assistant. Ask me anything: launching an AI influencer, posting a brand campaign, how payouts work, whatever you need.",
  at: 0,
};

/** Stable per-visitor session id, persisted so a returning visitor continues the
 *  same thread (and the admin sees one conversation, not many). */
function useSessionId(): string {
  const [id, setId] = useState("");
  useEffect(() => {
    try {
      let v = localStorage.getItem("vello_live_chat_sid");
      if (!v) {
        v = `lc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem("vello_live_chat_sid", v);
      }
      setId(v);
    } catch {
      setId(`lc_${Math.random().toString(36).slice(2, 10)}`);
    }
  }, []);
  return id;
}

export default function LiveChatWidget() {
  const sessionId = useSessionId();
  const { getFreshToken, profile } = useSupabaseAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Speech bubble that pops out of the launcher every so often. Timing and copy vary
  // so it never feels like a metronome.
  const reduced = useReducedMotion();
  const [bubble, setBubble] = useState<string | null>(null);
  useEffect(() => {
    if (open) return;
    const lines = ["Ask anything ✨", "Need a hand?", "Questions about launching?", "We reply in seconds"];
    let show: ReturnType<typeof setTimeout>, hide: ReturnType<typeof setTimeout>, i = 0;
    const cycle = (delay: number) => {
      show = setTimeout(() => {
        setBubble(lines[i++ % lines.length]);
        hide = setTimeout(() => { setBubble(null); cycle(9000 + Math.random() * 9000); }, 4200 + Math.random() * 1600);
      }, delay);
    };
    cycle(1800);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [open]);

  // Auto-scroll to the newest message / typing indicator.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending, open]);

  useEffect(() => {
    if (open) { setUnread(false); setTimeout(() => inputRef.current?.focus(), 250); }
  }, [open]);

  // Let any button anywhere open the chat: `window.dispatchEvent(new Event("vello:open-live-chat"))`.
  useEffect(() => {
    const openChat = () => setOpen(true);
    window.addEventListener("vello:open-live-chat", openChat);
    return () => window.removeEventListener("vello:open-live-chat", openChat);
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || sending || !sessionId) return;
    const userMsg: Msg = { role: "user", content: text, at: Date.now() };
    const history = messages.filter((m) => m.at !== 0); // drop the static welcome
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    try {
      // Logged-in visitors send their token so the admin Live Chat list shows
      // who they are (the server verifies it; the body is never trusted for email).
      const token = await getFreshToken().catch(() => null);
      const res = await fetch("/api/support-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sessionId,
          message: text,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          wallet: profile?.walletAddress,
          name: profile?.name,
          page: typeof window !== "undefined" ? window.location.pathname + window.location.search : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
      const reply = data.reply || "Sorry, I hit a snag. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply, at: Date.now() }]);
      if (!open) setUnread(true);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Connection hiccup — please try again.", at: Date.now() }]);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[120] flex flex-col items-end gap-2.5" style={{ fontFamily: "var(--font-inter)" }}>
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="flex h-[min(500px,70vh)] w-[min(340px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_24px_64px_-20px_rgba(0,0,0,0.4)]"
          >
            {/* Header — lime green, black text */}
            <div className="relative flex items-center gap-2.5 px-3.5 py-2.5 text-black" style={{ background: "linear-gradient(135deg,#bef264,#a3e635 55%,#84cc16)" }}>
              <Image src={flashAvatar} alt="Vello Assistant" className="size-8 shrink-0 rounded-lg object-cover ring-1 ring-black/15" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-[13px] font-bold">Vello Assistant</p>
                <p className="flex items-center gap-1.5 text-[10.5px] text-black/70">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-700/60" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-800" />
                  </span>
                  Online, replies in seconds
                </p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close chat" className="grid size-7 place-items-center rounded-full text-black/60 transition-colors hover:bg-black/10 hover:text-black">
                <X className="size-4" />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-[#f7f7f5] px-3 py-3.5">
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: EASE }}
                  className={`flex items-end gap-1.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "assistant" && (
                    <Image src={flashAvatar} alt="Solcameo" className="size-6 shrink-0 rounded-md object-cover ring-1 ring-black/5" />
                  )}
                  <div className={`max-w-[82%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[12.5px] leading-relaxed ${
                    m.role === "user"
                      ? "rounded-br-[3px] bg-teal-600 text-white shadow-[0_2px_8px_-2px_rgba(13,148,136,0.5)]"
                      : "rounded-bl-[3px] border border-zinc-200/80 bg-white text-zinc-800 shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
                  }`}>
                    {m.content}
                  </div>
                </motion.div>
              ))}
              {sending && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-end gap-1.5 justify-start">
                  <Image src={flashAvatar} alt="Solcameo" className="size-6 shrink-0 rounded-md object-cover ring-1 ring-black/5" />
                  <div className="flex items-center gap-1 rounded-lg rounded-bl-[3px] border border-zinc-200/80 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                    {[0, 1, 2].map((d) => (
                      <span key={d} className="size-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: `${d * 0.15}s` }} />
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-black/5 bg-white p-2">
              <div className="flex items-end gap-1.5 rounded-lg border border-zinc-200 bg-[#f7f7f5] py-1 pl-2.5 pr-1 focus-within:border-lime-400">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder="Type your message…"
                  className="max-h-24 flex-1 resize-none bg-transparent py-1 text-[12.5px] text-zinc-800 outline-none placeholder:text-zinc-400"
                />
                <button
                  onClick={() => void send()}
                  disabled={!input.trim() || sending}
                  aria-label="Send"
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-black text-lime-300 transition-all hover:bg-zinc-800 active:scale-90 disabled:bg-zinc-300 disabled:text-white"
                >
                  <ArrowUp className="size-3.5" strokeWidth={2.75} />
                </button>
              </div>
              <p className="mt-1 text-center text-[9.5px] text-zinc-400">AI assistant · a human can follow up</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Launcher: a soft, slowly morphing bubble with a drifting glow and a speech bubble that pops out. */}
      <div className="relative">
        <AnimatePresence>
          {bubble && !open && (
            <motion.div
              key={bubble}
              style={{ originX: 1, originY: 0.5 }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.2, x: 14, filter: "blur(6px)" }}
              animate={{ opacity: 1, scale: 1, x: 0, filter: "blur(0px)" }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, x: 8, filter: "blur(4px)" }}
              transition={{ type: "spring", stiffness: 170, damping: 17, mass: 0.9, filter: { duration: 0.35 }, opacity: { duration: 0.4 } }}
              className="pointer-events-none absolute right-[3.6rem] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[18px] border border-white/60 bg-white/85 px-3.5 py-2 text-[12.5px] font-semibold text-zinc-800 shadow-[0_14px_36px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            >
              {bubble}
              {/* Little bubbles trailing from the launcher */}
              <span aria-hidden="true" className="absolute -right-2 top-1/2 size-2 -translate-y-1/2 rounded-full bg-white/85" />
              <span aria-hidden="true" className="absolute -right-3.5 top-[62%] size-1 rounded-full bg-white/70" />
            </motion.div>
          )}
        </AnimatePresence>
        {!reduced && !open && (
          <>
            <motion.span aria-hidden="true" className="absolute -inset-3 rounded-full bg-[conic-gradient(from_0deg,rgba(190,242,100,0.0),rgba(163,230,53,0.45),rgba(190,242,100,0.0),rgba(132,204,22,0.35),rgba(190,242,100,0.0))] blur-xl" animate={{ rotate: 360 }} transition={{ duration: 17, repeat: Infinity, ease: "linear" }} />
            <motion.span aria-hidden="true" className="absolute -inset-1 rounded-full bg-[conic-gradient(from_90deg,rgba(255,255,255,0),rgba(255,255,255,0.35),rgba(255,255,255,0),rgba(163,230,53,0.4),rgba(255,255,255,0))] blur-md" animate={{ rotate: -360 }} transition={{ duration: 23, repeat: Infinity, ease: "linear" }} />
          </>
        )}
        <motion.button
          onClick={() => setOpen((v) => !v)}
          whileHover={reduced ? undefined : { scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          animate={reduced || open ? { y: 0, rotate: 0, borderRadius: "16px" } : {
            y: [0, -3, 1, -2, 0],
            rotate: [0, 1.2, -0.8, 0.6, 0],
            borderRadius: ["22px 18px 24px 16px", "17px 24px 18px 23px", "24px 17px 21px 19px", "19px 22px 16px 24px", "22px 18px 24px 16px"],
          }}
          transition={{
            y: { duration: 8.3, repeat: Infinity, ease: "easeInOut" },
            rotate: { duration: 11.7, repeat: Infinity, ease: "easeInOut" },
            borderRadius: { duration: 13.1, repeat: Infinity, ease: "easeInOut" },
            scale: { type: "spring", stiffness: 260, damping: 18 },
          }}
          aria-label={open ? "Close chat" : "Open live chat"}
          className="relative grid size-12 place-items-center overflow-hidden text-white shadow-[0_14px_34px_-10px_rgba(132,204,22,0.6)] ring-1 ring-white/40"
          style={{ background: "linear-gradient(135deg,#a3e635,#84cc16)" }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {open ? (
              <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }}>
                <X className="size-5" />
              </motion.span>
            ) : (
              <motion.span key="chat" initial={{ opacity: 0, scale: 1.1 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="absolute inset-0">
                <Image src={flashAvatar} alt="Chat with Solcameo" className="size-full object-cover" />
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-white/25 to-transparent" />
              </motion.span>
            )}
          </AnimatePresence>
          {unread && !open && (
            <span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-white bg-rose-500" />
          )}
        </motion.button>
      </div>
    </div>
  );
}
