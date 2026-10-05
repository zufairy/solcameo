"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { X, ArrowUp } from "lucide-react";
import flashAvatar from "@/assets/flash.jpeg";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";

type Msg = { role: "user" | "assistant"; content: string; at: number };

const EASE = [0.16, 1, 0.3, 1] as const;
const WELCOME: Msg = {
  role: "assistant",
  content: "Hey! 👋 I'm Vello's assistant. Ask me anything: launching an AI influencer, posting a brand campaign, how payouts work, whatever you need.",
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
  // One-time "Ask anything" nudge beside the launcher — pops in on load, then
  // auto-removes after a few seconds (or the moment the chat is opened).
  const [hint, setHint] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (open) setHint(false); }, [open]);

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
                    <Image src={flashAvatar} alt="Vello" className="size-6 shrink-0 rounded-md object-cover ring-1 ring-black/5" />
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
                  <Image src={flashAvatar} alt="Vello" className="size-6 shrink-0 rounded-md object-cover ring-1 ring-black/5" />
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

      {/* Launcher + one-time "Ask anything" nudge */}
      <div className="relative">
        <AnimatePresence>
          {hint && !open && (
            <motion.div
              key="hint"
              initial={{ opacity: 0, x: 10, scale: 0.85 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 10, scale: 0.85 }}
              transition={{ type: "spring", stiffness: 420, damping: 20 }}
              className="absolute right-[3.5rem] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-xl bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-800 shadow-[0_10px_28px_-8px_rgba(0,0,0,0.35)] ring-1 ring-black/5"
            >
              Ask anything ✨
              <span className="absolute -right-1 top-1/2 size-2.5 -translate-y-1/2 rotate-45 bg-white" />
            </motion.div>
          )}
        </AnimatePresence>
      <motion.button
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.92 }}
        aria-label={open ? "Close chat" : "Open live chat"}
        className="relative grid size-12 place-items-center overflow-hidden rounded-2xl text-white shadow-[0_14px_34px_-10px_rgba(132,204,22,0.6)] ring-1 ring-black/5"
        style={{ background: "linear-gradient(135deg,#a3e635,#84cc16)" }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }}>
              <X className="size-5" />
            </motion.span>
          ) : (
            <motion.span key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="absolute inset-0">
              <Image src={flashAvatar} alt="Chat with Vello" className="size-full object-cover" />
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
