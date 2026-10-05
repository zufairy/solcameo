"use client";
/* eslint-disable @next/next/no-img-element -- remote preview thumbs */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Film, Loader2, Play, Plus, Shapes, User, Video, X, Check, Download } from "lucide-react";
import { useAgentLibrary } from "../useAgentLibrary";
import { LIME, SURFACE, SPRING } from "./character-ui";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MotionItem { id: string; title: string; previewUrl: string; thumbUrl?: string; videoUrl: string; duration: number }
export type MotionMode = "motion-transfer" | "object-swap";
export type Resolution = "480p" | "720p" | "1080p";

export interface MotionRun {
  id: string;
  createdAt: number;
  status?: "pending" | "error";
  url?: string;
  error?: string;
  title?: string;
  poster?: string;
  mode: MotionMode;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── Runs: start a Genjutsu job, poll it, keep results in the agent's library ──

export function useMotionRuns(mintAddress: string) {
  const [runs, setRuns] = useState<MotionRun[]>(() => {
    try { return JSON.parse(window.localStorage.getItem(`vello.motion.${mintAddress || "draft"}`) ?? "[]") as MotionRun[]; } catch { return []; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(`vello.motion.${mintAddress || "draft"}`, JSON.stringify(runs.filter((r) => !r.status).slice(0, 60))); } catch { /* quota */ }
  }, [runs, mintAddress]);
  useAgentLibrary("motion", mintAddress, runs, setRuns);

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const start = useCallback(async (p: { mode: MotionMode; videoUrl: string; imageUrls: string[]; prompt?: string; resolution: Resolution; title?: string; poster?: string }) => {
    const id = uid();
    setRuns((prev) => [{ id, createdAt: Date.now(), status: "pending", mode: p.mode, title: p.title, poster: p.poster }, ...prev]);
    const patch = (fn: (r: MotionRun) => MotionRun) => alive.current && setRuns((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
    try {
      const { requestId } = await api<{ requestId: string }>("/api/character/motion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, mode: p.mode, videoUrl: p.videoUrl, imageUrls: p.imageUrls, prompt: p.prompt, resolution: p.resolution }),
      });
      const t0 = Date.now();
      let delay = 4000;
      while (alive.current && Date.now() - t0 < 15 * 60_000) {
        await sleep(delay);
        delay = Math.min(delay + 1000, 8000);
        const r = await api<{ status: string; url?: string; error?: string }>(`/api/character/motion?mint=${encodeURIComponent(mintAddress)}&id=${encodeURIComponent(requestId)}`);
        if (r.status === "completed" && r.url) { patch((x) => ({ ...x, status: undefined, url: r.url })); return; }
        if (["failed", "nsfw", "canceled"].includes(r.status)) {
          patch((x) => ({ ...x, status: "error", error: r.status === "nsfw" ? "Blocked by content moderation" : r.error || "Generation failed" }));
          return;
        }
      }
      patch((x) => ({ ...x, status: "error", error: "Timed out, try again" }));
    } catch (e) {
      patch((x) => ({ ...x, status: "error", error: e instanceof Error ? e.message : "Generation failed" }));
    }
  }, [mintAddress]);

  const dismiss = useCallback((id: string) => setRuns((prev) => prev.filter((r) => r.id !== id)), []);
  return { runs, start, dismiss };
}

// ── Motion library (links only, scraped from Higgsfield's public feed) ──────────

export function MotionLibrary({ selectedId, onSelect }: { selectedId?: string | null; onSelect: (m: MotionItem | null) => void }) {
  const [items, setItems] = useState<MotionItem[]>([]);
  const [next, setNext] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);
  const [hasMore, setHasMore] = useState(true);
  const sentinel = useRef<HTMLDivElement>(null);
  const fetching = useRef(false);
  const reduced = useReducedMotion();

  const load = useCallback(async (cursor: number) => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true); setFailed(false);
    try {
      const d = await api<{ items: MotionItem[]; next: number }>(`/api/character/motions?cursor=${cursor}`);
      setItems((prev) => { const seen = new Set(prev.map((p) => p.id)); return [...prev, ...d.items.filter((i) => !seen.has(i.id))]; });
      setNext(d.next);
      setHasMore(d.items.length > 0 && d.next > cursor);
    } catch { setFailed(true); } finally { fetching.current = false; setLoading(false); }
  }, []);
  // Initial fetch of an external feed, synced into state on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(1); }, [load]);

  const reveal = useCallback(() => {
    if (loading || failed) return;
    if (visibleCount < items.length) setVisibleCount(count => Math.min(items.length, count + 10));
    else if (hasMore) void load(next);
  }, [loading, failed, visibleCount, items.length, hasMore, load, next]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || loading || failed || (visibleCount >= items.length && !hasMore)) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) reveal();
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [reveal, loading, failed, visibleCount, items.length, hasMore]);

  return (
    <div>
      <div className="columns-2 gap-2.5 sm:columns-3 xl:columns-4">
        {items.slice(0, visibleCount).map((m, i) => {
          const on = selectedId === m.id;
          return (
            <motion.button
              key={m.id} type="button" onClick={() => onSelect(on ? null : m)}
              onMouseEnter={() => setHover(m.id)} onMouseLeave={() => setHover((h) => (h === m.id ? null : h))}
              initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: reduced ? 0 : (i % 10) * 0.035 }}
              whileHover={{ y: -2 }} aria-pressed={on} title={m.title}
              className="group relative mb-2.5 block w-full overflow-hidden rounded-[18px] border-[2.5px] bg-black text-left outline-none"
              style={{ borderColor: on ? LIME : SURFACE.ring, boxShadow: on ? `0 0 0 1px ${LIME}55, 0 10px 28px -10px ${LIME}88` : undefined, aspectRatio: "9 / 16" }}
            >
              {hover === m.id
                ? <video src={m.previewUrl} poster={m.thumbUrl} autoPlay muted loop playsInline className="size-full object-cover" />
                : m.thumbUrl ? <img src={m.thumbUrl} alt="" loading="lazy" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-zinc-600"><Film className="size-6" /></div>}
              {hover !== m.id && <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur"><Play className="size-3 fill-white" /></span>}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2 pt-8 text-[11.5px] font-semibold leading-tight text-white">
                <span className="line-clamp-2">{m.title}</span>
                {m.duration > 0 && <span className="mt-0.5 block text-[10px] font-medium text-zinc-400">{Math.round(m.duration)}s</span>}
              </span>
              <AnimatePresence>
                {on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute left-2 top-2 grid size-6 place-items-center rounded-full text-black" style={{ background: LIME }}><Check className="size-3.5" strokeWidth={3.5} /></motion.span>}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>
      <div ref={sentinel} className="h-1" aria-hidden />
      {loading && <div role="status" className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-400"><Loader2 className="size-4 animate-spin" /> Loading video ideas…</div>}
      {failed && <p className="py-4 text-center text-[12.5px] text-zinc-500">Couldn&apos;t load the motion library. <button onClick={() => void load(next)} className="text-white underline">Retry</button></p>}
      {!loading && !failed && (visibleCount < items.length || hasMore) && (
        <button type="button" onClick={reveal} className="mx-auto mt-2 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-[12.5px] font-semibold text-zinc-300 transition-colors hover:text-white">
          Load more <ChevronRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Results ────────────────────────────────────────────────────────────────────

export function RunsGrid({ runs, onDismiss }: { runs: MotionRun[]; onDismiss: (id: string) => void }) {
  if (!runs.length) return null;
  return (
    <div className="columns-2 gap-2.5 sm:columns-3 xl:columns-4">
      {runs.map((r) => (
        <div key={r.id} className="group relative mb-2.5 overflow-hidden rounded-[18px] border border-white/10 bg-black" style={{ aspectRatio: "9 / 16" }}>
          {r.url ? (
            <>
              <video src={r.url} poster={r.poster} controls playsInline loop className="size-full object-cover" />
              <a href={r.url} download target="_blank" rel="noreferrer" title="Download" className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/80 group-hover:opacity-100"><Download className="size-3.5" /></a>
            </>
          ) : r.status === "error" ? (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
              <p className="text-[12px] text-red-400">{r.error || "Failed"}</p>
              <button type="button" onClick={() => onDismiss(r.id)} className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/20">Dismiss</button>
            </div>
          ) : (
            <div className="relative flex size-full flex-col items-center justify-center gap-2" style={{ background: SURFACE.inner }}>
              {r.poster && <img src={r.poster} alt="" className="absolute inset-0 size-full object-cover opacity-30 blur-sm" />}
              <Loader2 className="relative size-6 animate-spin" style={{ color: LIME }} />
              <span className="relative text-[12px] font-semibold text-zinc-300">Rendering…</span>
              <span className="relative text-[10.5px] text-zinc-500">about 2–5 min</span>
            </div>
          )}
          {r.title && <span className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-1 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-1.5 pt-6 text-[10.5px] font-medium text-zinc-300">{r.title}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Replicate panel (Higgsfield-style: motion transfer / objects swap) ──────────

const RES: Resolution[] = ["480p", "720p", "1080p"];

function Drop({ icon, title, hint, children, onFile, accept, busy, className = "" }: {
  icon: React.ReactNode; title: string; hint: string; children?: React.ReactNode; onFile: (f: File[]) => void; accept: string; busy?: boolean; className?: string;
}) {
  return (
    <label className={`group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[24px] border-2 border-dashed border-white/10 bg-[#202124] text-center transition-colors hover:border-[#D4F53C]/50 ${className}`}>
      <input type="file" accept={accept} multiple={accept.startsWith("image")} className="sr-only" onChange={(e) => { const f = e.target.files ? Array.from(e.target.files) : []; if (f.length) onFile(f); e.target.value = ""; }} />
      {children}
      <span className="relative grid size-11 place-items-center rounded-full bg-gradient-to-b from-[#3a3b3f] to-[#222326] text-zinc-300 ring-1 ring-white/10 transition-transform group-hover:scale-105">
        {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      </span>
      <span className="relative text-[15px] font-semibold leading-tight text-white">{title}</span>
      <span className="relative text-[12px] text-zinc-500">{hint}</span>
    </label>
  );
}

export function ReplicatePanel({ mintAddress, character, selected, onClearSelected, onGenerate }: {
  mintAddress: string;
  /** The saved influencer portrait, offered as the default character. */
  character?: string;
  selected: MotionItem | null;
  onClearSelected: () => void;
  onGenerate: (p: { mode: MotionMode; videoUrl: string; imageUrls: string[]; prompt?: string; resolution: Resolution; title?: string; poster?: string }) => void;
}) {
  const [mode, setMode] = useState<MotionMode>("motion-transfer");
  const [uploaded, setUploaded] = useState<{ url: string; name: string } | null>(null);
  const [images, setImages] = useState<string[]>(character ? [character] : []);
  const [usePrompt, setUsePrompt] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [res, setRes] = useState<Resolution>("720p");
  const [busy, setBusy] = useState<"video" | "image" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(!!character);
  useEffect(() => { if (character && !seeded.current) { seeded.current = true; setImages((p) => (p.length ? p : [character])); } }, [character]);

  const videoUrl = selected?.videoUrl ?? uploaded?.url;
  const ready = !!videoUrl && images.length > 0 && !busy;

  const upVideo = async ([file]: File[]) => {
    setBusy("video"); setError(null);
    try {
      const dur = await new Promise<number>((ok) => {
        const v = document.createElement("video"); v.preload = "metadata"; const u = URL.createObjectURL(file);
        v.onloadedmetadata = () => { URL.revokeObjectURL(u); ok(v.duration); }; v.onerror = () => { URL.revokeObjectURL(u); ok(0); }; v.src = u;
      });
      if (dur && dur < 4) throw new Error("Reference video must be at least 4 seconds");
      const fd = new FormData(); fd.append("file", file); fd.append("mintAddress", mintAddress);
      const d = await api<{ url: string }>("/api/character/motion-upload", { method: "POST", body: fd });
      onClearSelected(); setUploaded({ url: d.url, name: file.name });
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); } finally { setBusy(null); }
  };
  const upImages = async (files: File[]) => {
    setBusy("image"); setError(null);
    try {
      for (const f of files.slice(0, 8 - images.length)) {
        const fd = new FormData(); fd.append("file", f); fd.append("mintAddress", mintAddress);
        const d = await api<{ url: string }>("/api/character/photo", { method: "POST", body: fd });
        setImages((p) => (p.length >= 8 ? p : [...p, d.url]));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); } finally { setBusy(null); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-3">
        <div className="grid grid-cols-2 rounded-2xl bg-black/40 p-1 text-[13px] font-semibold">
          {([["motion-transfer", "Motion transfer", Film], ["object-swap", "Objects swap", Shapes]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" onClick={() => setMode(id)}
              className={`flex items-center justify-center gap-2 rounded-xl py-2 transition-colors ${mode === id ? "border border-white/10 bg-[#202124] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]" : "text-zinc-500 hover:text-zinc-300"}`}>
              <Icon className="size-4" />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 pb-3 [scrollbar-width:thin]">
        {selected || uploaded ? (
          <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-black" style={{ height: 190 }}>
            <video key={videoUrl} src={selected?.previewUrl ?? uploaded?.url} poster={selected?.thumbUrl} autoPlay muted loop playsInline className="size-full object-contain" />
            <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">{selected ? selected.title : uploaded?.name}</span>
            <button type="button" aria-label="Remove video" onClick={() => { onClearSelected(); setUploaded(null); }} className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-black/60 text-white hover:bg-black/85"><X className="size-4" /></button>
          </div>
        ) : (
          <Drop accept="video/*" onFile={(f) => void upVideo(f)} busy={busy === "video"} icon={<Video className="size-4" />} title="Add a reference video to extract motion" hint="Video duration: 4 to 30 seconds, or pick one from the library" className="h-[190px] px-6" />
        )}

        <div className="rounded-[24px] border-2 border-dashed border-white/10 bg-[#202124] p-3">
          {images.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {images.map((u) => (
                <div key={u} className="group relative aspect-square overflow-hidden rounded-xl border-2 border-white/10">
                  <img src={u} alt="" className="size-full object-cover" />
                  <button type="button" aria-label="Remove" onClick={() => setImages((p) => p.filter((x) => x !== u))} className="absolute inset-0 grid place-items-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"><X className="size-4 text-white" /></button>
                </div>
              ))}
              {images.length < 8 && (
                <label className="grid aspect-square cursor-pointer place-items-center rounded-xl border-2 border-dashed border-white/15 text-zinc-400 transition-colors hover:border-[#D4F53C]/50 hover:text-white">
                  <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { const f = e.target.files ? Array.from(e.target.files) : []; if (f.length) void upImages(f); e.target.value = ""; }} />
                  {busy === "image" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5" />}
                </label>
              )}
            </div>
          ) : (
            <Drop accept="image/*" onFile={(f) => void upImages(f)} busy={busy === "image"} icon={<User className="size-4" />} title="Add your characters, products, or clothes" hint="Up to 8 images" className="h-[130px] border-0 bg-transparent" />
          )}
          {character && !images.includes(character) && (
            <button type="button" onClick={() => setImages((p) => [character, ...p].slice(0, 8))} className="mt-2 flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-1 pr-3 text-[12px] font-semibold text-zinc-300 hover:text-white">
              <img src={character} alt="" className="size-6 rounded-full object-cover" /> Use my AI influencer
            </button>
          )}
        </div>

        <div className="rounded-[22px] px-4 py-3" style={{ background: SURFACE.section }}>
          <button type="button" role="switch" aria-checked={usePrompt} onClick={() => setUsePrompt((v) => !v)} className="flex w-full items-center justify-between text-left">
            <span className="text-[15px] font-semibold text-white">Prompt</span>
            <span className={`relative h-6 w-11 rounded-full transition-colors ${usePrompt ? "" : "bg-zinc-600"}`} style={usePrompt ? { background: LIME } : undefined}>
              <motion.span layout transition={SPRING} className="absolute top-0.5 size-5 rounded-full bg-white" style={{ left: usePrompt ? 22 : 2 }} />
            </span>
          </button>
          {usePrompt && <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="Optional: describe the scene or style" className="mt-2 w-full resize-none bg-transparent text-[13px] text-white placeholder:text-zinc-500 focus:outline-none" />}
        </div>

        <div className="rounded-[22px] px-4 py-3" style={{ background: SURFACE.section }}>
          <p className="text-[11px] text-zinc-500">Model</p>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[15px] font-semibold text-white">Higgsfield Genjutsu <span className="rounded-md border border-lime-400/30 bg-lime-400/10 px-1.5 py-0.5 text-[10px] font-bold" style={{ color: LIME }}>New</span></span>
            <div className="flex rounded-lg bg-black/40 p-0.5">
              {RES.map((r) => <button key={r} type="button" onClick={() => setRes(r)} className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${res === r ? "bg-[#d7ff00] text-black shadow-[0_0_14px_-4px_rgba(215,255,0,0.7)]" : "text-zinc-500 hover:text-zinc-300"}`}>{r}</button>)}
            </div>
          </div>
        </div>
        {error && <p className="px-1 text-[12px] text-red-400">{error}</p>}
      </div>

      <div className="border-t border-white/[0.06] p-4" style={{ background: SURFACE.panel }}>
        <motion.button whileTap={{ scale: 0.98, y: 2 }} whileHover={ready ? { y: -1 } : undefined} disabled={!ready}
          onClick={() => onGenerate({ mode, videoUrl: videoUrl!, imageUrls: images, prompt: usePrompt ? prompt : undefined, resolution: res, title: selected?.title ?? uploaded?.name, poster: selected?.thumbUrl })}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[16px] font-bold text-black transition-opacity disabled:cursor-not-allowed disabled:bg-[#2a2b2e] disabled:text-zinc-500 disabled:shadow-none"
          style={ready ? { background: LIME, boxShadow: "0 4px 0 0 #9cb524, 0 14px 30px -12px rgba(212,245,60,0.55)" } : undefined}>
          {ready ? "Generate" : !videoUrl ? "Add a reference video" : "Add a character"}
        </motion.button>
      </div>
    </div>
  );
}

