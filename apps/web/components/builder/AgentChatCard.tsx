"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, BookOpen, Check, Sparkles } from "lucide-react";

interface PersonaSnapshot {
  name: string;
  handle?: string;
  niche?: string;
  audience?: string;
  language?: string;
  voiceArchetype?: string;
  backstory?: string;
  catchphrase?: string;
  traits?: string[];
  beliefs?: string[];
  contentPillars?: string[];
  avoidTopics?: string[];
  dreamCollab?: string;
  characterBible?: string;
  mintAddress?: string;
}

interface AgentChatCardProps {
  agentName: string;
  agentHandle?: string;
  avatarUrl?: string;
  mintAddress?: string;
  sessionId?: string;
  isMinted: boolean;
  knowledgeCount: number;
  voiceArchetype?: string;
  language?: string;
  /**
   * Full persona snapshot — used as a fallback when the server can't find the
   * agent in Convex (pre-mint / pre-draft state). Ensures chat works immediately.
   */
  personaSnapshot?: PersonaSnapshot;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  knowledgeUsed?: number;
  biblePatches?: string[];
  bibleUpdated?: { version: number } | null;
}

const STORAGE_KEY_PREFIX = "vello_agent_chat_";

export default function AgentChatCard({
  agentName,
  agentHandle,
  avatarUrl,
  mintAddress,
  sessionId,
  isMinted,
  knowledgeCount,
  voiceArchetype,
  language,
  personaSnapshot,
}: AgentChatCardProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showKnowledgeFlag, setShowKnowledgeFlag] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const storageKey = `${STORAGE_KEY_PREFIX}${mintAddress ?? sessionId ?? "agent"}`;

  // Restore history
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch { /* noop */ }
  }, [storageKey]);

  // Persist on change
  useEffect(() => {
    if (typeof window === "undefined" || messages.length === 0) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-20)));
    } catch { /* quota */ }
  }, [messages, storageKey]);

  // Auto-scroll — ONLY the card's own message pane, never the page. The old
  // scrollIntoView also scrolled every scrollable ancestor, which yanked the
  // whole Home tab down to this card the moment the tab opened. On the first
  // run (mount / history restore) jump instantly inside the pane only.
  const didMountScrollRef = useRef(false);
  useEffect(() => {
    const pane = endRef.current?.parentElement;
    if (!pane) return;
    if (!didMountScrollRef.current) {
      didMountScrollRef.current = true;
      pane.scrollTop = pane.scrollHeight;
      return;
    }
    pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!mintAddress && !sessionId) return;

    const userMsg: ChatMessage = {
      id: `${Date.now()}-u`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setSending(true);

    try {
      const history = [...messages, userMsg]
        .slice(-10)
        .map(({ role, content }) => ({ role, content }));

      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          sessionId,
          messages: history,
          // Always send the client-side snapshot — guarantees chat works even
          // when the DB lookup misses (pre-draft / pre-mint state).
          personaSnapshot: personaSnapshot ?? {
            name: agentName,
            handle: agentHandle,
            voiceArchetype,
            language,
          },
        }),
      });
      const data = await res.json() as {
        ok?: boolean; message?: string; error?: string; knowledgeReferenced?: number;
        join?: { campaignId: string; title: string; taskId: string } | null;
        posted?: { count: number; platforms: string[] } | null;
        biblePatches?: string[];
        bibleUpdated?: { version: number } | null;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? "Reply failed");

      const aiMsg: ChatMessage = {
        id: `${Date.now()}-a`,
        role: "assistant",
        content: data.message ?? "",
        timestamp: Date.now(),
        knowledgeUsed: data.knowledgeReferenced ?? 0,
        biblePatches: data.biblePatches,
        bibleUpdated: data.bibleUpdated,
      };
      setMessages((m) => [...m, aiMsg]);
      // A real campaign join was executed server-side — confirm it + point to Tasks.
      if (data.join) {
        setMessages((m) => [
          ...m,
          {
            id: `${Date.now()}-join`,
            role: "assistant",
            content: `✅ Joined "${data.join!.title}", generating your clip now. Track it in the Tasks page.`,
            timestamp: Date.now(),
          },
        ]);
      }
      // A real post/schedule was executed server-side — confirm what + where.
      if (data.posted && data.posted.count > 0) {
        const labels: Record<string, string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram", threads: "Threads", x: "X", twitter: "X", facebook: "Facebook" };
        const where = data.posted.platforms.map((p) => labels[p] ?? p).join(", ");
        setMessages((m) => [
          ...m,
          {
            id: `${Date.now()}-posted`,
            role: "assistant",
            content: `✅ Scheduled ${data.posted!.count} clip${data.posted!.count === 1 ? "" : "s"} to ${where}. Track them in the Posting tab calendar.`,
            timestamp: Date.now(),
          },
        ]);
      }
      if ((data.knowledgeReferenced ?? 0) > 0) {
        setShowKnowledgeFlag(true);
        setTimeout(() => setShowKnowledgeFlag(false), 2400);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown";
      setMessages((m) => [
        ...m,
        {
          id: `${Date.now()}-err`,
          role: "assistant",
          content: `(${agentName} couldn't reply: ${detail})`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    }
  }, [input, sending, mintAddress, sessionId, messages, agentName]);

  const handleSuggestion = (s: string) => {
    setInput(s);
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
  };

  const suggestions = buildSuggestions(agentName, voiceArchetype);
  const handleDisplay = agentHandle?.replace(/^@/, "") ?? agentName.toLowerCase().replace(/\s+/g, "");

  return (
    <div className="nb-card overflow-hidden flex flex-col">
      {/* Header, premium feel: avatar with online indicator, name in serif, voice meta */}
      <div className="px-5 py-4 border-b border-zinc-900/10 flex items-center gap-3 bg-white/40">
        <div className="relative shrink-0">
          <div className="size-12 rounded-full overflow-hidden bg-zinc-100 border border-zinc-900/10 shadow-inner">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={agentName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center font-serif text-[18px] font-bold text-zinc-600">
                {agentName?.[0]?.toUpperCase() ?? "A"}
              </div>
            )}
          </div>
          {/* "Online" pulse */}
          <span className="absolute bottom-0 right-0 flex h-3 w-3">
            <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-70 animate-ping" />
            <span className="relative size-3 rounded-full bg-emerald-500 border-2 border-white" />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="font-serif text-[17px] font-bold text-zinc-900 leading-none">{agentName}</h3>
            {isMinted && (
              <span className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-emerald-700 bg-emerald-100/60 border border-emerald-300/50 rounded px-1 py-0.5">
                On-chain
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 mt-0.5 leading-none">
            @{handleDisplay}
            {voiceArchetype && <span className="ml-1.5 italic">· {voiceArchetype}</span>}
            {language && <span className="ml-1.5">· {language}</span>}
          </p>
        </div>
      </div>

      {/* Knowledge indicator strip, premium "I know X things" badge */}
      <div className="px-5 py-2 border-b border-zinc-900/8 bg-[#faf6ec] flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10.5px] font-mono uppercase tracking-[0.16em] text-zinc-600">
          <BookOpen className="size-3" />
          <span>{knowledgeCount} {knowledgeCount === 1 ? "memory" : "memories"} loaded</span>
        </div>
        <AnimatePresence>
          {showKnowledgeFlag && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.16em] text-emerald-700"
            >
              <Sparkles className="size-3" />
              Used in this reply
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-[200px] max-h-[360px] overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-[13px] text-zinc-600 leading-[1.55]">
              <span className="font-serif text-zinc-900 font-bold">Talk to {agentName} directly.</span>
              {" "}Ask anything, give instructions, or have them write content. They&apos;ll reply in their voice, using their knowledge files.
            </p>
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSuggestion(s)}
                  className="block w-full text-left px-3 py-2 rounded-md border border-zinc-900/10 bg-white/60 hover:bg-white hover:border-zinc-900/30 text-[12px] text-zinc-700 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {m.role === "assistant" ? (
                <div className="flex gap-2 max-w-[88%]">
                  <div className="size-6 rounded-full overflow-hidden bg-zinc-100 border border-zinc-900/10 shrink-0">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center font-serif text-[11px] font-bold text-zinc-600">
                        {agentName?.[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-white border border-zinc-900/10 shadow-sm">
                    <p className="text-[13px] text-zinc-800 leading-[1.55] whitespace-pre-wrap break-words">{m.content}</p>
                    {(m.knowledgeUsed ?? 0) > 0 && (
                      <p className="text-[9.5px] font-mono uppercase tracking-[0.15em] text-zinc-400 mt-1.5">
                        ↳ referenced {m.knowledgeUsed} files
                      </p>
                    )}
                    {((m.biblePatches && m.biblePatches.length > 0) || m.bibleUpdated) && (
                      <div className="mt-2 flex flex-col gap-1">
                        {m.biblePatches?.map((summary, i) => (
                          <div
                            key={i}
                            className="inline-flex items-center gap-1.5 self-start rounded-full border border-lime-400/40 bg-lime-50/70 backdrop-blur-sm px-2.5 py-1 text-[10px] font-mono text-lime-800"
                          >
                            <Check className="size-2.5 text-lime-600 shrink-0" strokeWidth={3} />
                            <span>Applied to show plan: {summary}</span>
                          </div>
                        ))}
                        {m.bibleUpdated && (
                          <div
                            className="inline-flex items-center gap-1.5 self-start rounded-full border border-lime-400/40 bg-lime-50/70 backdrop-blur-sm px-2.5 py-1 text-[10px] font-mono text-lime-800"
                          >
                            <Check className="size-2.5 text-lime-600 shrink-0" strokeWidth={3} />
                            <span>Applied to show plan: show concept recompiled</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="px-3.5 py-2.5 rounded-2xl rounded-tr-md bg-zinc-900 text-white max-w-[80%]">
                  <p className="text-[13px] leading-[1.55] whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              )}
            </motion.div>
          ))
        )}
        {sending && (
          <div className="flex gap-2">
            <div className="size-6 rounded-full overflow-hidden bg-zinc-100 border border-zinc-900/10 shrink-0">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-serif text-[11px] font-bold text-zinc-600">
                  {agentName?.[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-white border border-zinc-900/10 shadow-sm flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="block size-1.5 rounded-full bg-zinc-400"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.05, repeat: Infinity, delay: i * 0.12 }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-zinc-900/10 bg-white/40">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-center gap-2 rounded-xl border border-zinc-900/12 bg-white px-3 py-1.5 focus-within:border-zinc-900/40 transition-colors shadow-sm"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Talk to ${agentName}…`}
            disabled={sending}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-zinc-900 placeholder:text-zinc-400 leading-tight h-7"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className={`flex size-7 items-center justify-center rounded-lg transition-colors ${
              input.trim() && !sending
                ? "bg-zinc-900 hover:bg-zinc-800 text-white"
                : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
            }`}
          >
            <ArrowUp className="size-3.5" strokeWidth={2.5} />
          </button>
        </form>
        <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.16em] text-zinc-400 text-center">
          {isMinted
            ? `Persona locked on-chain · NFT-verified replies`
            : `Pre-mint preview · Persona stored in draft`}
        </p>
      </div>
    </div>
  );
}

function buildSuggestions(name: string, archetype?: string): string[] {
  const base = [
    `Hey ${name}, how do you describe yourself in one sentence?`,
    `Write a 3-line hook in your voice for a new video.`,
    `What's your take on the latest trend in your niche?`,
  ];
  if (archetype === "mentor") base.push(`Teach me one thing your audience needs to know today.`);
  if (archetype === "entertainer") base.push(`Tell me a joke that fits your brand.`);
  return base.slice(0, 3);
}
