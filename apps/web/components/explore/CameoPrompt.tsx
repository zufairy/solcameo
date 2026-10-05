"use client";
/* eslint-disable @next/next/no-img-element -- remote avatars */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, Sparkles, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { ReferenceVideo } from "@/lib/explore/feed";

export interface CameoMember { token: string; name: string; avatarUrl: string }

const tokenOf = (name: string) => name.replace(/\s+/g, "").replace(/[^\w-]/g, "") || "agent";
const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\//.test(u);

/** Scene-direction box with @cameo mentions and a "magic" auto-written scenario. */
export function CameoPrompt({ mint, primaryName, item, value, onChange, onCast }: {
  mint: string;
  primaryName: string;
  item: ReferenceVideo;
  value: string;
  onChange: (v: string) => void;
  /** Mentioned agents, in mention order, for the parent to attach as extra references. */
  onCast: (cast: CameoMember[]) => void;
}) {
  const reduced = useReducedMotion();
  const agents = useQuery(api.influencers.listSearchable, {});
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ q: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState<string[] | null>(null);
  const edited = useRef(false); // true once the operator typed their own words
  const runId = useRef(0);

  const roster = useMemo(() => {
    const seen = new Set<string>();
    const out: CameoMember[] = [];
    for (const a of agents ?? []) {
      if (a.mintAddress === mint || !https(a.avatarUrl)) continue;
      const token = tokenOf(a.name);
      if (seen.has(token.toLowerCase())) continue;
      seen.add(token.toLowerCase());
      out.push({ token, name: a.name, avatarUrl: a.avatarUrl });
    }
    return out;
  }, [agents, mint]);

  const cast = useMemo(() => {
    const found: CameoMember[] = [];
    for (const m of value.matchAll(/@([\w-]+)/g)) {
      const hit = roster.find((r) => r.token.toLowerCase() === m[1].toLowerCase());
      if (hit && !found.some((f) => f.token === hit.token)) found.push(hit);
    }
    return found;
  }, [value, roster]);
  const castKey = cast.map((c) => c.token).join("|");
  useEffect(() => { onCast(cast); }, [castKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = query ? roster.filter((r) => r.token.toLowerCase().includes(query.q.toLowerCase()) || r.name.toLowerCase().includes(query.q.toLowerCase())).slice(0, 6) : [];

  function detect(text: string, caret: number) {
    const m = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
    setQuery(m ? { q: m[2], start: caret - m[2].length - 1 } : null);
    setActive(0);
  }
  function pick(member: CameoMember) {
    if (!query) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${member.token} ${value.slice(caret)}`;
    onChange(next);
    setQuery(null);
    edited.current = false; // choosing a cameo should refresh the auto scenario
    requestAnimationFrame(() => { const pos = query.start + member.token.length + 2; el?.focus(); el?.setSelectionRange(pos, pos); });
  }

  async function magic(opts?: { keepDraft?: boolean }) {
    const id = ++runId.current;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/explore/cameo-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: mint,
          title: item.title,
          description: item.description,
          category: item.category,
          cast: [{ token: tokenOf(primaryName), name: primaryName }, ...cast.map((c) => ({ token: c.token, name: c.name }))],
          draft: opts?.keepDraft ? value : "",
        }),
      });
      const data = (await res.json()) as { prompt?: string; error?: string };
      if (!res.ok || !data.prompt) throw new Error(data.error || "Couldn't write a prompt right now.");
      if (id !== runId.current) return; // superseded or edited meanwhile
      // Keep every mentioned cameo in the text so references stay attached.
      const missing = cast.filter((c) => !new RegExp(`@${c.token}\\b`, "i").test(data.prompt!)).map((c) => `@${c.token}`);
      const text = missing.length ? `${data.prompt} ${missing.join(" ")}` : data.prompt;
      if (reduced) { onChange(text); return; }
      const words = text.split(/(\s+)/).filter(Boolean);
      setReveal(words);
      window.setTimeout(() => { if (id === runId.current) { onChange(text); setReveal(null); } }, Math.min(2600, words.length * 22 + 500));
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : "Couldn't write a prompt right now.");
    } finally {
      if (id === runId.current) setBusy(false);
    }
  }

  // Automatic scenario: on open, and whenever the cast changes, until the operator writes their own.
  useEffect(() => {
    if (edited.current && value.trim()) return;
    const t = window.setTimeout(() => void magic(), 600);
    return () => window.clearTimeout(t);
  }, [castKey, item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">Scene direction <span className="text-zinc-600">· type @ to cameo another agent</span></span>
        <button type="button" disabled={busy} onClick={() => { edited.current = false; void magic({ keepDraft: true }); }}
          className="inline-flex items-center gap-1 rounded-full border border-[#d7ff00]/30 bg-[#d7ff00]/10 px-2.5 py-1 text-[11px] font-semibold text-[#d7ff00] transition-colors hover:bg-[#d7ff00]/20 disabled:opacity-60">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}Magic prompt
        </button>
      </div>

      <AnimatePresence initial={false}>
        {cast.length > 0 && (
          <motion.div initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap gap-1.5 overflow-hidden">
            {cast.map((c) => (
              <motion.span key={c.token} layout initial={reduced ? false : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] py-0.5 pl-0.5 pr-2 text-[11px] text-white backdrop-blur">
                <img src={c.avatarUrl} alt="" className="size-5 rounded-full object-cover" />@{c.token}
                <button type="button" aria-label={`Remove ${c.name}`} onClick={() => onChange(value.replace(new RegExp(`@${c.token}\\b\\s?`, "gi"), ""))} className="text-zinc-400 hover:text-white"><X className="size-3" /></button>
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative">
        <textarea
          ref={ref}
          value={value}
          rows={4}
          maxLength={4000}
          onChange={(e) => { edited.current = true; runId.current++; setReveal(null); setBusy(false); onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
          onClick={(e) => detect(value, e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (!query || !matches.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % matches.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); }
            else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active]); }
            else if (e.key === "Escape") setQuery(null);
          }}
          placeholder="Describe the scene, or @ another agent to bring them in…"
          className={`w-full resize-none rounded-lg border bg-black/20 p-3 text-sm text-white outline-none transition-colors focus:border-[#d7ff00] ${busy ? "border-[#d7ff00]/50" : "border-white/10"} ${reveal ? "text-transparent" : ""}`}
        />
        {reveal && (
          <div aria-live="polite" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg p-3 text-sm leading-[1.4] text-white">
            {reveal.map((w, i) => (
              <motion.span key={i} initial={{ opacity: 0, filter: "blur(8px)", y: 4 }} animate={{ opacity: 1, filter: "blur(0px)", y: 0 }} transition={{ delay: i * 0.022, duration: 0.35, ease: "easeOut" }}
                className={w.startsWith("@") ? "text-[#d7ff00]" : undefined}>{w}</motion.span>
            ))}
          </div>
        )}
        {busy && !reveal && !reduced && (
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-lg" style={{ background: "linear-gradient(110deg, transparent 30%, rgba(215,255,0,0.12) 50%, transparent 70%)", backgroundSize: "200% 100%" }}
            animate={{ backgroundPositionX: ["200%", "-100%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }} />
        )}
        <AnimatePresence>
          {query && matches.length > 0 && (
            <motion.ul role="listbox" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-white/15 bg-zinc-900/90 p-1 shadow-2xl backdrop-blur-xl">
              {matches.map((m, i) => (
                <li key={m.token} role="option" aria-selected={i === active}>
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${i === active ? "bg-white/10 text-white" : "text-zinc-300"}`}>
                    <img src={m.avatarUrl} alt="" className="size-6 rounded-md object-cover" />
                    <span className="truncate">{m.name}</span><span className="ml-auto text-[11px] text-zinc-500">@{m.token}</span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
