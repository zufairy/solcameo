"use client";
/* eslint-disable @next/next/no-img-element -- remote avatars */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ImagePlus, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { ReferenceVideo } from "@/lib/explore/feed";

export interface CameoMember { token: string; name: string; avatarUrl: string; ticker?: string; self?: boolean }

const tokenOf = (name: string) => name.replace(/\s+/g, "").replace(/[^\w-]/g, "") || "agent";
const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\//.test(u);

/** Scene-direction box with @cameo mentions and a "magic" auto-written scenario. */
export function CameoPrompt({ mint, primaryName, primaryImage, item, mode = "motion-transfer", value, onChange, onCast }: {
  mint: string;
  primaryName: string;
  primaryImage?: string;
  item: ReferenceVideo;
  mode?: "motion-transfer" | "object-swap";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [hover, setHover] = useState<{ m: CameoMember; x: number; y: number } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const portal = typeof document !== "undefined"; // popups only render after user interaction, so no hydration mismatch
  const [uploads, setUploads] = useState<CameoMember[]>([]);
  const [uploading, setUploading] = useState(false);
  // Words of the last auto-written prompt (mentions stripped). Anything else in the box is the operator's own.
  const lastAuto = useRef("");
  const strip = (t: string) => t.replace(/@[\w-]*/g, "").replace(/\s+/g, " ").trim();
  const userWrote = (t: string) => !!strip(t) && strip(t) !== lastAuto.current;
  const runId = useRef(0);

  // Everyone who can be mentioned, yourself included. `self` is the primary character, which is always in the scene.
  const roster = useMemo(() => {
    const seen = new Set<string>();
    const out: CameoMember[] = [];
    const me = agents?.find((a) => a.mintAddress === mint);
    const selfToken = tokenOf(primaryName);
    seen.add(selfToken.toLowerCase());
    out.push({ token: selfToken, name: primaryName, avatarUrl: https(primaryImage) ? primaryImage : https(me?.avatarUrl) ? me!.avatarUrl : "", ticker: me?.ticker ?? undefined, self: true });
    for (const a of agents ?? []) {
      if (a.mintAddress === mint) continue;
      const token = tokenOf(a.name);
      if (seen.has(token.toLowerCase())) continue;
      seen.add(token.toLowerCase());
      out.push({ token, name: a.name, avatarUrl: https(a.avatarUrl) ? a.avatarUrl : "", ticker: a.ticker ?? undefined });
    }
    for (const u of uploads) if (!seen.has(u.token.toLowerCase())) out.push(u);
    return out;
  }, [agents, mint, uploads, primaryName, primaryImage]);

  const cast = useMemo(() => {
    const found: CameoMember[] = [];
    for (const m of value.matchAll(/@([\w-]+)/g)) {
      const hit = roster.find((r) => r.token.toLowerCase() === m[1].toLowerCase());
      if (hit && !hit.self && hit.avatarUrl && !found.some((f) => f.token === hit.token)) found.push(hit);
    }
    return found;
  }, [value, roster]);
  const castKey = cast.map((c) => c.token).join("|");
  useEffect(() => { onCast(cast); }, [castKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = query ? roster.filter((r) => { const q = query.q.toLowerCase().replace(/^\$/, ""); return r.token.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || (r.ticker ?? "").toLowerCase().includes(q); }).slice(0, 20) : [];

  const segments = useMemo(() => value.split(/(@[\w-]+)/g).filter((t) => t !== "").map((text) => {
    const member = text.startsWith("@") ? roster.find((r) => r.token.toLowerCase() === text.slice(1).toLowerCase()) : undefined;
    return { text, member };
  }), [value, roster]);
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
  function pick(member: CameoMember) {
    if (!query) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, query.start)}@${member.token} ${value.slice(caret)}`;
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => { const pos = query.start + member.token.length + 2; el?.focus(); el?.setSelectionRange(pos, pos); });
  }

  async function addPhoto(file: File) {
    setError("");
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Couldn't read the file"));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/upload-ref", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64 }) });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`);
      const n = uploads.length + 1;
      const member: CameoMember = { token: `Photo${n}`, name: `Photo ${n}`, avatarUrl: data.url };
      setUploads((u) => [...u, member]);
      onChange(`${value}${value && !/\s$/.test(value) ? " " : ""}@${member.token} `);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
          mode,
          title: item.title,
          description: item.description,
          category: item.category,
          cast: [{ token: tokenOf(primaryName), name: primaryName, imageUrl: primaryImage }, ...cast.map((c) => ({ token: c.token, name: c.name, imageUrl: c.avatarUrl }))],
          draft: opts?.keepDraft ? value : "",
        }),
      });
      const data = (await res.json()) as { prompt?: string; error?: string };
      if (!res.ok || !data.prompt) throw new Error(data.error || "Couldn't write a prompt right now.");
      if (id !== runId.current) return; // superseded or edited meanwhile
      const text = data.prompt;
      lastAuto.current = strip(text);
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
    if (userWrote(value)) return;
    const t = window.setTimeout(() => void magic(), 600);
    return () => window.clearTimeout(t);
  }, [castKey, item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-xs text-zinc-300">Scene direction</span>
          <span className="mt-0.5 block text-[11px] text-zinc-600">Type @ for another agent, or add an image</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" aria-label="Add image" title="Add image" disabled={uploading || cast.length >= 7} onClick={() => fileRef.current?.click()}
            className="grid size-7 place-items-center rounded-full border border-white/25 bg-gradient-to-b from-white/[0.2] to-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] backdrop-blur-xl transition-colors hover:from-white/[0.28] hover:to-white/[0.1] disabled:opacity-50">
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto(f); }} />
          <button type="button" disabled={busy} onClick={() => void magic({ keepDraft: userWrote(value) })}
            className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11px] font-semibold border border-white/25 bg-gradient-to-b from-white/[0.2] to-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] backdrop-blur-xl transition-colors hover:from-white/[0.28] hover:to-white/[0.1] disabled:opacity-50">
            {busy && <Loader2 className="size-3 animate-spin" />}Magic prompt
          </button>
        </div>
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
          onChange={(e) => { runId.current++; setReveal(null); setBusy(false); onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
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
          placeholder="Describe the scene, or @ another agent to bring them in…"
          className={`w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-transparent caret-white outline-none transition-colors selection:bg-white/25 selection:text-transparent placeholder:text-zinc-500 focus:border-white/25`}
        />
        {/* Mirror layer: shows the text with @mentions highlighted. Only the mention chips take pointer events, for the hover card. */}
        {!reveal && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent">
            <div className="whitespace-pre-wrap break-words p-3 text-sm text-white" style={{ transform: `translateY(${-scrollTop}px)` }}>
              {segments.map((seg, i) => seg.member ? (
                <span key={i}
                  onMouseDown={(e) => { e.preventDefault(); ref.current?.focus(); }}
                  onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover({ m: seg.member!, x: r.left + r.width / 2, y: r.top }); }}
                  onMouseLeave={() => setHover(null)}
                  className="pointer-events-auto cursor-pointer rounded-[4px] bg-[#d7ff00]/15 font-bold text-[#d7ff00] ring-1 ring-[#d7ff00]/25 transition-colors hover:bg-[#d7ff00]/25">{seg.text}</span>
              ) : <span key={i}>{seg.text}</span>)}
              {value.endsWith("\n") ? "\u200b" : null}
            </div>
          </div>
        )}
        {reveal && (
          <div aria-live="polite" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg p-3 text-sm leading-[1.4] text-white">
            {reveal.map((w, i) => (
              <motion.span key={i} initial={{ opacity: 0, filter: "blur(8px)", y: 4 }} animate={{ opacity: 1, filter: "blur(0px)", y: 0 }} transition={{ delay: i * 0.022, duration: 0.35, ease: "easeOut" }}
                className={w.startsWith("@") ? "font-bold text-[#d7ff00]" : undefined}>{w}</motion.span>
            ))}
          </div>
        )}
        {busy && !reveal && !reduced && (
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-lg" style={{ background: "linear-gradient(110deg, transparent 30%, rgba(215,255,0,0.12) 50%, transparent 70%)", backgroundSize: "200% 100%" }}
            animate={{ backgroundPositionX: ["200%", "-100%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }} />
        )}
      </div>
      {portal && createPortal(
        <>
          <AnimatePresence>
            {query && matches.length > 0 && rect && (
              <motion.div key="cameo-popup" role="listbox" aria-label="Cameos you can bring in"
                style={{ position: "fixed", left: rect.left, width: rect.width, zIndex: 400, ...(placeAbove ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }), transformOrigin: placeAbove ? "bottom center" : "top center" }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: placeAbove ? 10 : -10, scale: 0.96, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: placeAbove ? 6 : -6, scale: 0.97, filter: "blur(4px)" }}
                transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.7, filter: { duration: 0.2 } }}
                className="overflow-hidden rounded-2xl border border-white/15 bg-zinc-900/85 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl">
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  <span>Cameos you can bring in</span><span className="normal-case tracking-normal text-zinc-600">↑↓ browse · Enter add</span>
                </div>
                <ul className="max-h-64 overflow-y-auto p-1">
                  {matches.map((m, i) => (
                    <motion.li key={m.token} role="option" aria-selected={i === active}
                      initial={reduced ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.025, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      ref={(el) => { if (el && i === active) el.scrollIntoView({ block: "nearest" }); }}>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setActive(i)}
                        className="relative flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm text-zinc-300">
                        {i === active && <motion.span layoutId="cameo-active" className="absolute inset-0 rounded-xl bg-white/[0.1] ring-1 ring-white/10" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                        <span className="relative">{m.avatarUrl ? <img src={m.avatarUrl} alt="" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/15" /> : <span className="grid size-9 place-items-center rounded-full bg-white/10 text-xs font-bold">{m.name.slice(0, 1).toUpperCase()}</span>}</span>
                        <span className="relative min-w-0 flex-1"><span className={`block truncate font-semibold ${i === active ? "text-white" : ""}`}>{m.name}{m.self && <span className="ml-1.5 rounded bg-[#d7ff00]/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-[#d7ff00]">You</span>}</span><span className="block truncate text-[11px] text-zinc-500">@{m.token}</span></span>
                        {m.ticker && <span className="relative shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-200">${m.ticker.replace(/^\$/, "")}</span>}
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
                className="pointer-events-none w-40 overflow-hidden rounded-2xl border border-white/20 bg-zinc-900/90 text-center shadow-[0_24px_60px_-16px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
                {hover.m.avatarUrl ? <img src={hover.m.avatarUrl} alt="" className="aspect-square w-full object-cover" /> : <div className="grid aspect-square w-full place-items-center bg-white/10 text-3xl font-bold">{hover.m.name.slice(0, 1).toUpperCase()}</div>}
                <div className="px-3 py-2"><p className="truncate text-[13px] font-extrabold uppercase tracking-wide text-white">{hover.m.name}</p><p className="mt-0.5 truncate text-[11px] text-[#d7ff00]">@{hover.m.token}{hover.m.ticker ? ` · $${hover.m.ticker.replace(/^\$/, "")}` : ""}</p>{hover.m.self && <p className="mt-0.5 text-[10px] text-zinc-500">Main character</p>}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </>, document.body)}
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
