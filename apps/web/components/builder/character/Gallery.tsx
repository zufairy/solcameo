"use client";
/* eslint-disable @next/next/no-img-element -- generated portraits come from R2 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Compass, Download, History, Loader2, Maximize2, Shirt, Sparkles, Star, X } from "lucide-react";
import type { CharModel } from "@/lib/character/types";
import { DISPLAY_FONT, LIME, SPRING, SURFACE } from "./character-ui";

export type Tile = {
  id: string;
  model: CharModel;
  ratio: string;
  status: "pending" | "done" | "failed";
  url?: string;
  error?: string;
  startedAt: number;
};

export const MODEL_LABEL: Record<CharModel, string> = { soul: "Soul", soul2: "Soul 2", reference: "Reference edit", qwen: "Qwen Image 3" };

const cssRatio = (r: string) => r.replace(":", " / ");

async function download(url: string, name: string) {
  try {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function PendingCard({ tile, now }: { tile: Tile; now: number }) {
  const secs = Math.max(0, Math.round((now - tile.startedAt) / 1000));
  const progress = 1 - Math.exp(-secs / 28); // eases toward ~95% so it never looks stuck
  return (
    <div className="relative size-full overflow-hidden bg-zinc-900/80" style={{ aspectRatio: cssRatio(tile.ratio) }}>
      <motion.div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_40%,rgba(163,230,53,0.16),transparent)]" animate={{ opacity: [0.35, 1, 0.35], scale: [1, 1.08, 1] }} transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }} />
      <motion.div aria-hidden className="absolute inset-y-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/[0.09] to-transparent" initial={{ x: "-120%" }} animate={{ x: "300%" }} transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }} />
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="relative mx-auto grid size-12 place-items-center">
            <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
              <circle cx="24" cy="24" r="21" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
              <motion.circle cx="24" cy="24" r="21" fill="none" stroke={LIME} strokeWidth="3" strokeLinecap="round" strokeDasharray={132} animate={{ strokeDashoffset: 132 * (1 - progress) }} transition={{ duration: 0.8, ease: "easeOut" }} />
            </svg>
            <Sparkles className="size-4 text-lime-400" />
          </div>
          <p className="mt-2.5 text-[12px] font-medium text-zinc-300">Rendering</p>
          <p className="text-[11px] tabular-nums text-zinc-500">{secs}s</p>
        </div>
      </div>
    </div>
  );
}

function TileCard({ tile, now, picked, index, onPick, onOpen, onDismiss, onShirt }: {
  tile: Tile; now: number; picked: boolean; index: number;
  onPick: () => void; onOpen: () => void; onDismiss: () => void; onShirt?: () => void;
}) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 24, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
      transition={{ ...SPRING, delay: Math.min(index, 8) * 0.04 }}
      className={`group relative overflow-hidden rounded-2xl bg-zinc-900 ring-2 transition-shadow duration-300 ${
        picked ? "ring-[#D4F53C] shadow-[0_18px_50px_-18px_rgba(212,245,60,0.55)]" : "ring-white/[0.08] hover:ring-white/25 hover:shadow-[0_18px_50px_-22px_rgba(0,0,0,0.9)]"
      }`}
    >
      {tile.status === "pending" && <PendingCard tile={tile} now={now} />}

      {tile.status === "failed" && (
        <div className="relative grid place-items-center bg-red-950/20 p-5 text-center" style={{ aspectRatio: cssRatio(tile.ratio) }}>
          <div>
            <AlertTriangle className="mx-auto mb-2 size-5 text-red-300" />
            <p className="text-[12.5px] leading-snug text-red-200/90">{tile.error ?? "Generation failed"}</p>
          </div>
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-zinc-300 transition-colors hover:bg-black/70 hover:text-white"><X className="size-3.5" /></button>
        </div>
      )}

      {tile.status === "done" && tile.url && (
        <>
          <button type="button" onClick={onOpen} aria-label={`Open ${MODEL_LABEL[tile.model]} portrait`} className="block w-full cursor-zoom-in">
            <motion.img
              initial={{ opacity: 0, scale: 1.06, filter: "blur(14px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              src={tile.url} alt={`${MODEL_LABEL[tile.model]} portrait`} decoding="async"
              className="w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" style={{ aspectRatio: cssRatio(tile.ratio) }}
            />
          </button>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[10.5px] font-semibold tracking-wide text-white backdrop-blur-md">{MODEL_LABEL[tile.model]}</span>
          <div className="absolute inset-x-2.5 bottom-2.5 flex translate-y-2 items-center justify-between gap-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100">
            <button type="button" onClick={onPick} className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-bold transition-transform active:scale-95 ${picked ? "bg-lime-400 text-black" : "bg-white text-black hover:bg-lime-300"}`}>
              {picked ? <Check className="size-3.5" strokeWidth={3} /> : <Star className="size-3.5" />}
              {picked ? "Selected" : "Select"}
            </button>
            <span className="flex gap-1.5">
              <button type="button" aria-label="Download" onClick={() => void download(tile.url!, `character-${tile.id}.jpg`)} className="grid size-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/80"><Download className="size-3.5" /></button>
              <button type="button" aria-label="Expand" onClick={onOpen} className="grid size-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/80"><Maximize2 className="size-3.5" /></button>
            </span>
          </div>
          {onShirt && <button type="button" onClick={onShirt} aria-label="Change shirt" title="Change shirt" className="absolute right-2.5 top-2.5 z-10 grid size-8 place-items-center rounded-full border border-white/25 bg-gradient-to-b from-white/[0.28] to-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_6px_18px_-6px_rgba(0,0,0,0.8)] backdrop-blur-xl transition-transform hover:scale-110 active:scale-95"><Shirt className="size-4" /></button>}
          <AnimatePresence>
            {picked && (
              <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={SPRING} className={`absolute top-2.5 grid size-7 place-items-center rounded-full bg-lime-400 text-black shadow-lg ${onShirt ? "right-12" : "right-2.5"}`}>
                <Star className="size-3.5 fill-black" />
              </motion.span>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
}

/** Higgsfield's "Explore" hero: a fan of tall look cards over a big condensed headline. */
const HERO = [
  { src: "/character/opt/goth.webp", w: 118, h: 250, y: 34, z: 1 },
  { src: "/character/opt/retro.webp", w: 136, h: 290, y: 14, z: 2 },
  { src: "/character/opt/suits.webp", w: 170, h: 340, y: 0, z: 4 },
  { src: "/character/opt/y2k.webp", w: 136, h: 290, y: 14, z: 2 },
  { src: "/character/opt/sporty.webp", w: 118, h: 250, y: 34, z: 1 },
];

function Hero({ prompt }: { prompt: string | null }) {
  return (
    <div className="flex min-h-[calc(100dvh-160px)] flex-col items-center justify-center py-10 text-center">
      <div className="mb-8 flex max-w-full items-end justify-center overflow-hidden px-2 pb-2">
        {HERO.map((c, i) => (
          <motion.div
            key={c.src}
            initial={{ opacity: 0, y: 60, scale: 0.9 }} animate={{ opacity: 1, y: c.y, scale: 1 }}
            transition={{ ...SPRING, delay: 0.08 + Math.abs(i - 2) * 0.07 }}
            whileHover={{ y: c.y - 10, scale: 1.04, zIndex: 9 }}
            className="relative -mx-2 shrink-0 overflow-hidden rounded-[22px] border-[3px] bg-white shadow-[0_24px_50px_-20px_rgba(0,0,0,0.9)]"
            style={{ width: c.w, height: c.h, zIndex: c.z, borderColor: SURFACE.ring }}
          >
            <img src={c.src} alt="" className="size-full object-cover" />
          </motion.div>
        ))}
      </div>
      <h3 className="text-[46px] font-black uppercase leading-[1.08] tracking-[0.03em] text-white" style={{ fontFamily: DISPLAY_FONT }}>
        Your influencer,<br />your viral hit
      </h3>
      <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-zinc-400">
        Build your AI influencer with the face, body, and style you want. Choose traits and a ratio, then generate with Qwen. Finished portraits are saved to History.
      </p>
      <AnimatePresence>
        {prompt && (
          <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mx-auto mt-5 max-w-md rounded-2xl p-3.5 text-left text-[12px] leading-relaxed text-zinc-400" style={{ background: SURFACE.section }}>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: LIME }}>Prompt</span>{prompt}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Lightbox({ tile, picked, onClose, onPick }: { tile: Tile; picked: boolean; onClose: () => void; onPick: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] grid place-items-center bg-black/85 p-4 backdrop-blur-md" onClick={onClose} role="dialog" aria-modal="true" aria-label="Portrait preview">
      <motion.div initial={{ scale: 0.94, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }} transition={SPRING} className="relative max-h-full max-w-[min(92vw,720px)]" onClick={(e) => e.stopPropagation()}>
        <img src={tile.url} alt={`${MODEL_LABEL[tile.model]} portrait`} className="max-h-[82vh] w-auto rounded-2xl object-contain shadow-[0_40px_120px_-30px_rgba(0,0,0,1)]" />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold text-white">{MODEL_LABEL[tile.model]} · {tile.ratio}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => void download(tile.url!, `character-${tile.id}.jpg`)} className="flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/20"><Download className="size-4" /> Download</button>
            <button type="button" onClick={() => { onPick(); onClose(); }} className="flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold text-black" style={{ background: LIME }}>
              {picked ? <Check className="size-4" strokeWidth={3} /> : <Star className="size-4" />} {picked ? "Current character" : "Use as character"}
            </button>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="absolute -right-3 -top-3 grid size-9 place-items-center rounded-full border border-white/15 bg-zinc-900 text-white transition-colors hover:bg-zinc-800"><X className="size-4" /></button>
      </motion.div>
    </motion.div>
  );
}

export function Gallery({ tiles, generating, pickedUrl, onPick, onDismiss, onShirt, onSave, saving, error, prompt, historyLoading = false, saveLabel = "Save character", fill = false }: {
  tiles: Tile[]; generating: boolean; pickedUrl: string | null;
  saveLabel?: string; /** Stretch to the parent height instead of a capped, sticky panel (onboarding). */ fill?: boolean; onPick: (t: Tile) => void; onDismiss: (id: string) => void; onShirt?: (t: Tile) => void; onSave: () => void; saving: boolean;
  error: string | null; prompt: string | null; historyLoading?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"explore" | "history" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const anyPending = tiles.some((t) => t.status === "pending");
  useEffect(() => {
    if (!anyPending) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyPending]);

  // Masonry: each tile goes to the currently shortest column, so mixed ratios interlock and newest stay on top.
  const columns = useMemo(() => {
    const cols: { tile: Tile; index: number }[][] = [[], [], []];
    const heights = [0, 0, 0];
    tiles.forEach((tile, index) => {
      const [w, h] = tile.ratio.split(":").map(Number);
      let k = 0;
      for (let c = 1; c < cols.length; c++) if (heights[c] < heights[k] - 0.001) k = c;
      cols[k].push({ tile, index });
      heights[k] += (h || 4) / (w || 3);
    });
    return cols;
  }, [tiles]);

  const opened = tiles.find((t) => t.id === open && t.status === "done");
  const done = tiles.filter((t) => t.status === "done").length;
  const showFeed = generating || (view ?? (tiles.length ? "history" : "explore")) === "history";

  return (
    <div className={`flex min-w-0 flex-col rounded-[32px] border border-white/[0.06] ${fill ? "h-[calc(100dvh-6.5rem)] min-h-[480px] lg:h-full lg:min-h-0" : "h-[calc(100dvh-192px)] min-h-[560px] lg:sticky lg:top-10 lg:self-start"}`} style={{ background: SURFACE.panel }}>
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-1.5">
          {([["explore", "Explore", <Compass key="c" className="size-4" />], ["history", "History", <History key="h" className="size-4" />]] as const).map(([id, label, icon]) => {
            const on = (showFeed ? "history" : "explore") === id;
            return (
              <button key={id} type="button" onClick={() => setView(id)} aria-pressed={on}
                className={`flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors ${on ? "border border-white/10 bg-[#2b2c30] text-white" : "text-zinc-400 hover:text-white"}`}>
                {icon}{label}
                {id === "history" && done > 0 && <span className="rounded-full bg-white/10 px-1.5 text-[11px] tabular-nums text-zinc-300">{done}</span>}
              </button>
            );
          })}
          {(generating || historyLoading) && <span role="status" className="ml-2 flex items-center gap-1.5 text-[12px]" style={{ color: LIME }}><Loader2 className="size-3.5 animate-spin" /> {generating ? "Rendering…" : "Restoring history…"}</span>}
        </div>
        <motion.button whileTap={{ scale: 0.96 }} disabled={!pickedUrl || saving || generating} onClick={onSave}
          className="flex h-10 items-center gap-2 rounded-xl px-4 text-[14px] font-bold text-black transition-all disabled:cursor-not-allowed disabled:opacity-35"
          style={{ background: LIME, boxShadow: pickedUrl && !generating ? "0 8px 24px -10px rgba(212,245,60,0.7)" : undefined }}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" strokeWidth={3} />} {saveLabel}
        </motion.button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 [scrollbar-width:thin]">
        {!showFeed ? (
          <Hero prompt={prompt} />
        ) : (
          <div className="flex items-start gap-3">
            {columns.map((col, ci) => (
              <div key={ci} className="flex min-w-0 flex-1 flex-col gap-3">
                <AnimatePresence initial={false}>
                  {col.map(({ tile, index }) => (
                    <TileCard key={tile.id} tile={tile} now={now} index={index} picked={!!tile.url && tile.url === pickedUrl}
                      onPick={() => onPick(tile)} onOpen={() => setOpen(tile.id)} onDismiss={() => onDismiss(tile.id)} onShirt={onShirt ? () => onShirt(tile) : undefined} />
                  ))}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mx-4 mb-4 flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {opened && <Lightbox key="lb" tile={opened} picked={opened.url === pickedUrl} onClose={() => setOpen(null)} onPick={() => onPick(opened)} />}
      </AnimatePresence>
    </div>
  );
}
