"use client";
/* eslint-disable @next/next/no-img-element -- remote GIPHY previews */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2, Search, X } from "lucide-react";
import { CALLOUT_GIFS, isGiphyUrl } from "@/lib/solstar/calloutMedia";

export type ChatGif = { url: string; alt: string };
type Item = { id: string; thumb: string; url: string; alt: string; w: number; h: number };

const PAGE = 24;
/** Quick searches that suit a trading chat; "" is GIPHY's trending feed. */
const CATEGORIES = [
  { label: "Trending", q: "" },
  { label: "LFG", q: "lets go" },
  { label: "Bullish", q: "bullish" },
  { label: "Moon", q: "to the moon" },
  { label: "Rekt", q: "rekt" },
  { label: "Cope", q: "cope" },
  { label: "GM", q: "good morning" },
  { label: "Laugh", q: "laughing" },
  { label: "Wow", q: "mind blown" },
  { label: "Clap", q: "applause" },
];

let keyRequest: Promise<string | null> | undefined;
/** The GIPHY key is fetched once per page load and shared by every picker. */
const loadKey = () => (keyRequest ??= fetch("/api/solstar/callouts/gifs").then((r) => r.json()).then((d) => (typeof d.apiKey === "string" ? d.apiKey : null)).catch(() => { keyRequest = undefined; return null; }));

type GiphyImage = { url?: string; width?: string; height?: string };
type GiphyGif = { id?: string; title?: string; images?: { fixed_width?: GiphyImage; downsized_medium?: GiphyImage } };

function toItems(data: GiphyGif[]): Item[] {
  return data.flatMap((g) => {
    const thumb = g.images?.fixed_width;
    const full = g.images?.downsized_medium?.url && isGiphyUrl(g.images.downsized_medium.url) ? g.images.downsized_medium.url : thumb?.url;
    if (!g.id || !thumb?.url || !full || !isGiphyUrl(thumb.url) || !isGiphyUrl(full)) return [];
    return [{ id: g.id, thumb: thumb.url, url: full, alt: (g.title || "GIF").slice(0, 160), w: Number(thumb.width) || 200, h: Number(thumb.height) || 200 }];
  });
}

const fallbackItems = (query: string): Item[] =>
  CALLOUT_GIFS.filter((g) => `${g.alt} ${g.tags}`.toLowerCase().includes(query.trim().toLowerCase())).map((g, i) => ({ id: `fallback-${i}`, thumb: g.url, url: g.url, alt: g.alt, w: 200, h: 200 }));

/**
 * GIF library for the chat composer. Searches GIPHY (trending by default, with trading-chat categories) and pages in
 * more as you scroll. Without a GIPHY key it falls back to a small set of reactions. Picking a GIF hands it to the
 * composer, which previews it and sends it with the message.
 */
export function ChatGifPicker({ onPick, onClose }: { onPick: (gif: ChatGif) => void; onClose: () => void }) {
  const reduced = useReducedMotion();
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const offset = useRef(0);
  const request = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { let live = true; void loadKey().then((k) => { if (live) setKey(k); }); return () => { live = false; }; }, []);
  useEffect(() => { const t = setTimeout(() => setTerm(query.trim()), 280); return () => clearTimeout(t); }, [query]);

  const fetchPage = useCallback(async (reset: boolean) => {
    if (key === undefined) return;
    const id = ++request.current;
    if (reset) { offset.current = 0; setDone(false); setItems([]); scroller.current?.scrollTo({ top: 0 }); }
    setLoading(true); setError("");
    if (!key) {
      if (id === request.current) { setItems(fallbackItems(term)); setDone(true); setLoading(false); }
      return;
    }
    try {
      const params = new URLSearchParams({ api_key: key, limit: String(PAGE), offset: String(offset.current), rating: "pg-13", ...(term ? { q: term } : {}) });
      const res = await fetch(`https://api.giphy.com/v1/gifs/${term ? "search" : "trending"}?${params}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("search");
      const json = (await res.json()) as { data?: GiphyGif[]; pagination?: { total_count?: number } };
      if (id !== request.current) return;
      const next = toItems(json.data ?? []);
      offset.current += json.data?.length ?? 0;
      setItems((prev) => (reset ? next : [...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]));
      setDone(!json.data?.length || offset.current >= (json.pagination?.total_count ?? Infinity));
    } catch {
      if (id !== request.current) return;
      setError("GIFs are unavailable right now.");
      setItems((prev) => (prev.length ? prev : fallbackItems(term)));
      setDone(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [key, term]);

  useEffect(() => { void fetchPage(true); }, [fetchPage]);

  // Load the next page a little before the bottom comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done || loading || !items.length) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) void fetchPage(false); }, { root: scroller.current, rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, done, loading, fetchPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [onClose]);

  // Two columns, each GIF going to the shorter one, so the grid stays tidy without a layout library.
  const columns: Item[][] = [[], []];
  const heights = [0, 0];
  for (const it of items) { const c = heights[0] <= heights[1] ? 0 : 1; columns[c].push(it); heights[c] += it.h / it.w; }

  return (
    <motion.div
      ref={root}
      role="dialog"
      aria-label="GIF library"
      initial={reduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="absolute inset-x-2 bottom-full z-30 mb-2 flex h-[340px] max-h-[60vh] origin-bottom flex-col overflow-hidden rounded-[14px] border border-white/[0.16] bg-[linear-gradient(145deg,rgba(255,255,255,0.12),rgba(255,255,255,0.03)_60%,rgba(215,255,0,0.05))] bg-[#0b0d0f]/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl"
    >
      <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-2.5">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-white/10 bg-white/[0.05] px-2.5 focus-within:border-white/25">
          <Search className="size-3.5 shrink-0 text-zinc-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={60}
            placeholder={key === null ? "Search reactions" : "Search GIFs"}
            aria-label="Search GIFs"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-zinc-500"
          />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="text-zinc-500 hover:text-white"><X className="size-3.5" /></button>}
        </label>
        <button type="button" aria-label="Close GIF library" onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-[8px] text-zinc-400 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
      </div>

      {key !== null && (
        <div className="flex gap-1.5 overflow-x-auto px-2.5 pb-2 [scrollbar-width:none]" role="tablist" aria-label="GIF categories">
          {CATEGORIES.map((c) => {
            const active = term.toLowerCase() === c.q;
            return (
              <button key={c.label} type="button" role="tab" aria-selected={active} onClick={() => setQuery(c.q)}
                className={`h-6 shrink-0 rounded-[6px] border px-2.5 text-[11px] font-semibold transition-colors ${active ? "border-[#d7ff00]/50 bg-[#d7ff00]/15 text-[#d7ff00]" : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white"}`}>
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      <div ref={scroller} aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-2 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]">
        {loading && !items.length ? (
          <div className="grid grid-cols-2 gap-1.5" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="animate-pulse rounded-[8px] bg-white/[0.06]" style={{ height: 70 + ((i * 37) % 60) }} />)}
          </div>
        ) : items.length ? (
          <div className="grid grid-cols-2 gap-1.5">
            {columns.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-1.5">
                {col.map((g) => (
                  <button key={g.id} type="button" onClick={() => onPick({ url: g.url, alt: g.alt })} aria-label={`Add GIF: ${g.alt}`}
                    className="group relative block w-full overflow-hidden rounded-[8px] bg-white/[0.05] ring-1 ring-white/10 transition active:scale-[0.97] hover:ring-[#d7ff00]/60"
                    style={{ aspectRatio: `${g.w} / ${g.h}` }}>
                    <img src={g.thumb} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-xs text-zinc-500">{error || "No GIFs found. Try another word."}</p>
        )}
        <div ref={sentinel} className="h-px" />
        {loading && !!items.length && <div className="grid place-items-center py-3"><Loader2 className="size-4 animate-spin text-zinc-500" /></div>}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.07] px-2.5 py-1.5 text-[10px] text-zinc-500">
        <span>{key === null ? "Quick reactions. Add a GIPHY key for the full library." : error || "Press Esc to close"}</span>
        {key !== null && <a href="https://giphy.com" target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-white">Powered by GIPHY</a>}
      </div>
    </motion.div>
  );
}
