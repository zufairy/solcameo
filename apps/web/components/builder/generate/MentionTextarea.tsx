"use client";
/* eslint-disable @next/next/no-img-element -- remote avatars */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api } from "@/convex/_generated/api";

export interface Mention { token: string; name: string; avatarUrl: string; ticker?: string; self?: boolean }

const tokenOf = (name: string) => name.replace(/\s+/g, "").replace(/[^\w-]/g, "") || "agent";
const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\//.test(u);
const cleanTicker = (t: string) => t.replace(/^\$/, "");

/**
 * Prompt textarea with @cameo tagging, shared by Photo, Video and Carousel.
 * Typing @ opens a list of agents you can bring in. Tagged names are highlighted, and hovering one
 * shows the profile picture. `onCast` reports the tagged agents (never yourself) so the caller can
 * attach their pictures as extra references.
 */
export function MentionTextarea({ value, onChange, placeholder, rows = 3, disabled, selfMint, selfName, selfImage, onCast, className = "", textClass = "text-[14px] leading-[1.55]", maxLength = 4000 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; disabled?: boolean;
  selfMint?: string; selfName?: string; selfImage?: string; onCast?: (cast: Mention[]) => void; className?: string; textClass?: string; maxLength?: number;
}) {
  const reduced = useReducedMotion();
  const agents = useQuery(api.influencers.listSearchable, {});
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ q: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [hover, setHover] = useState<{ m: Mention; x: number; y: number } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const portal = typeof document !== "undefined"; // popups only render after interaction, so no hydration mismatch

  const roster = useMemo(() => {
    const seen = new Set<string>();
    const out: Mention[] = [];
    if (selfName) {
      const token = tokenOf(selfName);
      const me = agents?.find((a) => a.mintAddress === selfMint);
      seen.add(token.toLowerCase());
      out.push({ token, name: selfName, avatarUrl: https(selfImage) ? selfImage : https(me?.avatarUrl) ? me.avatarUrl : "", ticker: me?.ticker ?? undefined, self: true });
    }
    for (const a of agents ?? []) {
      if (a.mintAddress === selfMint) continue;
      const token = tokenOf(a.name);
      if (seen.has(token.toLowerCase())) continue;
      seen.add(token.toLowerCase());
      out.push({ token, name: a.name, avatarUrl: https(a.avatarUrl) ? a.avatarUrl : "", ticker: a.ticker ?? undefined });
    }
    return out;
  }, [agents, selfMint, selfName, selfImage]);

  const cast = useMemo(() => {
    const found: Mention[] = [];
    for (const m of value.matchAll(/@([\w-]+)/g)) {
      const hit = roster.find((r) => r.token.toLowerCase() === m[1].toLowerCase());
      if (hit && !hit.self && hit.avatarUrl && !found.some((f) => f.token === hit.token)) found.push(hit);
    }
    return found;
  }, [value, roster]);
  const castKey = cast.map((c) => c.token).join("|");
  useEffect(() => { onCast?.(cast); }, [castKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = query
    ? roster.filter((r) => {
        const q = query.q.toLowerCase().replace(/^\$/, "");
        return r.token.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || (r.ticker ?? "").toLowerCase().includes(q);
      }).slice(0, 20)
    : [];
  const segments = useMemo(() => value.split(/(@[\w-]+)/g).filter((t) => t !== "").map((text) => ({
    text, member: text.startsWith("@") ? roster.find((r) => r.token.toLowerCase() === text.slice(1).toLowerCase()) : undefined,
  })), [value, roster]);

  const measure = useCallback(() => { if (ref.current) setRect(ref.current.getBoundingClientRect()); }, []);
  useLayoutEffect(() => {
    if (!query) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [query, measure]);
  const placeAbove = !rect || rect.top > 300 || rect.top > window.innerHeight - rect.bottom;

  function detect(text: string, caret: number) {
    const m = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
    setQuery(m ? { q: m[2], start: caret - m[2].length - 1 } : null);
    setActive(0);
  }
  function pick(member: Mention) {
    if (!query) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    onChange(`${value.slice(0, query.start)}@${member.token} ${value.slice(caret)}`);
    setQuery(null);
    requestAnimationFrame(() => { const pos = query.start + member.token.length + 2; el?.focus(); el?.setSelectionRange(pos, pos); });
  }

  return (
    <div className="relative">
      <textarea
        ref={ref} value={value} rows={rows} maxLength={maxLength} disabled={disabled} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onClick={(e) => detect(value, e.currentTarget.selectionStart)}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onKeyUp={(e) => { if (e.key.startsWith("Arrow") && e.key !== "ArrowDown" && e.key !== "ArrowUp") detect(value, e.currentTarget.selectionStart); }}
        onKeyDown={(e) => {
          if (!query || !matches.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % matches.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[active]); }
          else if (e.key === "Escape") setQuery(null);
        }}
        className={`w-full resize-none bg-transparent p-0 ${textClass} text-transparent caret-white outline-none selection:bg-white/25 selection:text-transparent placeholder:text-zinc-500 ${className}`}
      />
      {/* Mirror layer: the same text with @tags highlighted. Only the tag chips take pointer events, for the hover card. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`whitespace-pre-wrap break-words ${textClass} text-white`} style={{ transform: `translateY(${-scrollTop}px)` }}>
          {segments.map((seg, i) => seg.member ? (
            <span key={i}
              onMouseDown={(e) => { e.preventDefault(); ref.current?.focus(); }}
              onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover({ m: seg.member!, x: r.left + r.width / 2, y: r.top }); }}
              onMouseLeave={() => setHover(null)}
              className="pointer-events-auto cursor-pointer rounded-[4px] bg-[#d7ff00]/15 font-bold text-[#d7ff00] ring-1 ring-[#d7ff00]/25 transition-colors hover:bg-[#d7ff00]/25">{seg.text}</span>
          ) : <span key={i}>{seg.text}</span>)}
          {value.endsWith("\n") ? "​" : null}
        </div>
      </div>
      {portal && createPortal(
        <>
          <AnimatePresence>
            {query && matches.length > 0 && rect && (
              <motion.div key="mention-popup" role="listbox" aria-label="Cameos you can bring in"
                style={{ position: "fixed", left: rect.left, width: Math.max(rect.width, 280), zIndex: 400, ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }), transformOrigin: placeAbove ? "bottom center" : "top center" }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: placeAbove ? 10 : -10, scale: 0.96, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: placeAbove ? 6 : -6, scale: 0.97, filter: "blur(4px)" }}
                transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7, filter: { duration: 0.2 } }}
                className="overflow-hidden rounded-xl border border-white/15 bg-zinc-900/90 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl">
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  <span>Cameos you can bring in</span><span className="normal-case tracking-normal text-zinc-600">↑↓ browse · Enter add</span>
                </div>
                <ul className="max-h-64 overflow-y-auto p-1">
                  {matches.map((m, i) => (
                    <motion.li key={m.token} role="option" aria-selected={i === active}
                      initial={reduced ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.025, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      ref={(el) => { if (el && i === active) el.scrollIntoView({ block: "nearest" }); }}>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setActive(i)}
                        className="relative flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-300">
                        {i === active && <motion.span layoutId="mention-active" className="absolute inset-0 rounded-lg bg-white/[0.1] ring-1 ring-white/10" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                        <span className="relative">{m.avatarUrl ? <img src={m.avatarUrl} alt="" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/15" /> : <span className="grid size-9 place-items-center rounded-full bg-white/10 text-xs font-bold">{m.name.slice(0, 1).toUpperCase()}</span>}</span>
                        <span className="relative min-w-0 flex-1">
                          <span className={`block truncate font-semibold ${i === active ? "text-white" : ""}`}>{m.name}{m.self && <span className="ml-1.5 rounded bg-[#d7ff00]/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-[#d7ff00]">You</span>}</span>
                          <span className="block truncate text-[11px] text-zinc-500">@{m.token}</span>
                        </span>
                        {m.ticker && <span className="relative shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-200">${cleanTicker(m.ticker)}</span>}
                      </button>
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {hover && (
              <motion.div key={hover.m.token} aria-hidden="true"
                style={{ position: "fixed", left: Math.min(Math.max(hover.x, 90), window.innerWidth - 90), top: hover.y - 10, zIndex: 410, translateX: "-50%", translateY: "-100%", transformOrigin: "bottom center" }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85, y: 8, filter: "blur(6px)" }}
                animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.92, y: 4 }}
                transition={{ type: "spring", stiffness: 400, damping: 26 }}
                className="pointer-events-none w-40 overflow-hidden rounded-xl border border-white/20 bg-zinc-900/90 text-center shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
                {hover.m.avatarUrl ? <img src={hover.m.avatarUrl} alt="" className="aspect-square w-full object-cover" /> : <div className="grid aspect-square w-full place-items-center bg-white/10 text-3xl font-bold">{hover.m.name.slice(0, 1).toUpperCase()}</div>}
                <div className="px-3 py-2">
                  <p className="truncate text-[13px] font-extrabold uppercase tracking-wide text-white">{hover.m.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[#d7ff00]">@{hover.m.token}{hover.m.ticker ? ` · $${cleanTicker(hover.m.ticker)}` : ""}</p>
                  {hover.m.self && <p className="mt-0.5 text-[10px] text-zinc-500">Main character</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>, document.body)}
    </div>
  );
}
