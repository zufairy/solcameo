"use client";
/* eslint-disable @next/next/no-img-element -- generated portraits and user logos come from R2 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, ImagePlus, Loader2, Shirt, Sparkles, Type, Wand2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SHIRT_COLORS, SHIRT_POSES, type ShirtMode } from "@/lib/character/shirt";
import type { Tile } from "./Gallery";
import { priceLabel, type StudioBilling } from "./studioBilling";

const LIME = "#D4F53C";
const RATIOS = [["3:4", 3 / 4], ["1:1", 1], ["9:16", 9 / 16], ["16:9", 16 / 9], ["4:3", 4 / 3], ["2:3", 2 / 3]] as const;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const closestRatio = (w: number, h: number) => RATIOS.reduce((best, r) => Math.abs(Math.log(w / h / r[1])) < Math.abs(Math.log(w / h / best[1])) ? r : best)[0];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
  return data;
}

type Created = { taskId: string; ticket: string; nextEngine: number | null; engineIndex: number };

const MODES: { id: ShirtMode; label: string; icon: React.ReactNode }[] = [
  { id: "logo", label: "My logo", icon: <ImagePlus className="size-3.5" /> },
  { id: "describe", label: "Describe", icon: <Type className="size-3.5" /> },
  { id: "auto", label: "AI picks", icon: <Wand2 className="size-3.5" /> },
];

/** Glass popup: put the user's logo (or a described / AI-chosen design) on a finished portrait, optionally in a new pose. */
export function ShirtStudio({ tile, mintAddress, draft, billing, onClose, onResult, onUse }: {
  tile: Tile | null; mintAddress?: string; draft: boolean; billing: StudioBilling; onClose: () => void;
  /** Fires as soon as an edit finishes (auto-save into the history feed). */
  onResult: (url: string, ratio: string) => void;
  /** The user chose this look as the selected portrait. */
  onUse: (url: string) => void;
}) {
  return (
    <Dialog open={!!tile} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-h-[92dvh] w-[min(96vw,980px)] max-w-none gap-0 overflow-hidden rounded-[28px] border border-white/[0.14] bg-[linear-gradient(135deg,rgba(255,255,255,0.1),rgba(255,255,255,0.025)_45%,rgba(255,255,255,0.06))] bg-[#0b0d0f]/80 p-0 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_50px_140px_-30px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:max-w-none">
        <DialogTitle className="sr-only">Shirt studio</DialogTitle>
        {tile && <Studio key={tile.id} tile={tile} mintAddress={mintAddress} draft={draft} billing={billing} onClose={onClose} onResult={onResult} onUse={onUse} />}
      </DialogContent>
    </Dialog>
  );
}

function Studio({ tile, mintAddress, draft, billing, onClose, onResult, onUse }: { tile: Tile; mintAddress?: string; draft: boolean; billing: StudioBilling; onClose: () => void; onResult: (url: string, ratio: string) => void; onUse: (url: string) => void }) {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<ShirtMode>("logo");
  const [logo, setLogo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>("");
  const [pose, setPose] = useState("keep");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [result, setResult] = useState<{ url: string; ratio: string } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [secs, setSecs] = useState(0);
  const alive = useRef(true);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (phase !== "working") return;
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function upload(f: File | undefined) {
    if (!f) return;
    setUploading(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", f); fd.append("kind", "logo");
      if (mintAddress) fd.append("mintAddress", mintAddress);
      if (draft) fd.append("draft", "1");
      setLogo((await api<{ url: string }>("/api/character/photo", { method: "POST", body: fd })).url);
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); } finally { setUploading(false); }
  }

  const fullDescription = [color && mode !== "auto" ? `${color} shirt` : "", description.trim()].filter(Boolean).join(", ");
  const ready = !uploading && (mode === "logo" ? !!logo : mode === "describe" ? !!fullDescription : true);

  async function run() {
    if (!ready || phase === "working" || billing.paying) return;
    setError("");
    // One run id per click: engine fallbacks reuse it, so the free image or the $0.50 is only taken once.
    const runId = crypto.randomUUID();
    const payment = await billing.prepare(1);
    if (!payment) return;
    setPhase("working"); setResult(null); setSecs(0);
    const seed = Date.now();
    let engineIndex = 0;
    try {
      for (;;) {
        setStatus(engineIndex === 0 ? "Fitting the shirt…" : "Trying another model…");
        let created: Created;
        try {
          created = await api<Created>("/api/character/shirt", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mintAddress, draft, runId, useFree: billing.useFree, ...(engineIndex === 0 ? payment : {}), imageUrl: tile.url, logoUrl: mode === "logo" ? logo : undefined, mode, description: fullDescription || undefined, pose, ratio: tile.ratio, engineIndex, seed }),
          });
        } catch (e) {
          const data = (e as { data?: { nextEngine?: number | null; code?: string } }).data;
          if (typeof data?.nextEngine === "number") { engineIndex = data.nextEngine; continue; }
          if (data?.code === "payment_used") billing.discard();
          void billing.refresh();
          throw e;
        }
        if (engineIndex === 0) billing.settled();
        const started = Date.now();
        let failed = "";
        while (alive.current && Date.now() - started < 4 * 60_000) {
          await sleep(3000);
          const r = await api<{ status: string; url?: string; error?: string }>(`/api/character/shirt/status?mint=${encodeURIComponent(mintAddress ?? "")}&id=${encodeURIComponent(created.taskId)}&ticket=${encodeURIComponent(created.ticket)}${draft ? "&draft=1" : ""}`);
          if (r.status === "completed" && r.url) {
            const dims = await new Promise<{ w: number; h: number }>(resolve => { const img = new Image(); img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => resolve({ w: 3, h: 4 }); img.src = r.url!; });
            if (!alive.current) return;
            const ratio = closestRatio(dims.w, dims.h);
            // Auto-save: the render is already in storage, so it lands in the history feed before the user does anything.
            onResult(r.url, ratio);
            setResult({ url: r.url, ratio }); setPhase("done"); return;
          }
          if (r.status === "failed") { failed = r.error || "Generation failed"; break; }
        }
        if (!alive.current) return;
        if (!failed) failed = "Timed out, try again";
        if (created.nextEngine !== null) { engineIndex = created.nextEngine; continue; }
        throw new Error(failed);
      }
    } catch (e) {
      if (alive.current) { setError(e instanceof Error ? e.message : "Could not generate the shirt"); setPhase("idle"); }
    }
  }

  const busy = phase === "working";
  return (
    <div className="grid max-h-[92dvh] min-h-0 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Preview: the original, then the result once it exists */}
      <div className="relative flex min-h-[320px] items-center justify-center bg-black/30 p-5 md:border-r md:border-white/10">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_30%,rgba(212,245,60,0.10),transparent)]" />
        <div className="relative w-full max-w-[340px]">
          <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/15 shadow-[0_30px_80px_-30px_rgba(0,0,0,1)]" style={{ aspectRatio: (result?.ratio ?? tile.ratio).replace(":", " / ") }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.img key={result?.url ?? tile.url} src={result?.url ?? tile.url} alt={result ? "Portrait with the new shirt" : "Selected portrait"} initial={{ opacity: 0, scale: 1.04, filter: "blur(10px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.6 }} className="absolute inset-0 size-full object-cover" />
            </AnimatePresence>
            {busy && <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[2px]">
              {!reduced && <motion.div aria-hidden className="absolute inset-y-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" initial={{ x: "-120%" }} animate={{ x: "300%" }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />}
              <div className="text-center"><Loader2 className="mx-auto size-6 animate-spin" style={{ color: LIME }} /><p role="status" className="mt-2 text-sm font-medium">{status}</p><p className="text-xs tabular-nums text-zinc-400">{secs}s · usually under a minute</p></div>
            </div>}
            {result && <motion.span initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur-md"><Check className="size-3" strokeWidth={3} style={{ color: LIME }} />Saved to history</motion.span>}
          </div>
          {result && <button type="button" onClick={() => setResult(null)} className="mt-3 w-full text-center text-xs text-zinc-400 transition-colors hover:text-white">Show original</button>}
        </div>
      </div>

      {/* Controls */}
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-3 px-6 pb-3 pt-5">
          <span className="grid size-9 place-items-center rounded-xl border border-white/20 bg-gradient-to-b from-white/[0.18] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"><Shirt className="size-4" /></span>
          <div className="min-w-0 flex-1"><p className="text-base font-semibold tracking-tight">Shirt studio</p><p className="text-xs text-zinc-400">Dress your character in your own design.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4 [scrollbar-width:thin]">
          <div role="tablist" aria-label="Shirt design" className="relative grid grid-cols-3 rounded-xl border border-white/10 bg-black/30 p-1">
            {MODES.map(m => <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} disabled={busy} onClick={() => setMode(m.id)} className={`relative flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-colors ${mode === m.id ? "text-black" : "text-zinc-400 hover:text-white"}`}>
              {mode === m.id && <motion.span layoutId="shirt-mode" transition={{ type: "spring", stiffness: 480, damping: 36 }} className="absolute inset-0 rounded-lg" style={{ background: LIME }} />}
              <span className="relative flex items-center gap-1.5">{m.icon}{m.label}</span>
            </button>)}
          </div>

          {mode === "logo" && <div>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" disabled={busy || uploading} onClick={() => file.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files?.[0]); }}
              className="group flex h-32 w-full items-center justify-center gap-4 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] transition-colors hover:border-white/40 hover:bg-white/[0.06]">
              {uploading ? <Loader2 className="size-5 animate-spin text-zinc-300" /> : logo
                ? <><span className="grid size-20 place-items-center overflow-hidden rounded-xl bg-white p-2"><img src={logo} alt="Your logo" className="max-h-full max-w-full object-contain" /></span><span className="text-left text-sm"><span className="block font-semibold">Logo ready</span><span className="text-xs text-zinc-400">Click to replace</span></span></>
                : <span className="text-center"><ImagePlus className="mx-auto size-6 text-zinc-300 transition-transform group-hover:scale-110" /><span className="mt-2 block text-sm font-medium">Upload your logo</span><span className="text-xs text-zinc-500">PNG, JPG or WebP · printed exactly as supplied</span></span>}
            </button>
          </div>}

          {mode !== "auto" && <div className="space-y-2">
            <label htmlFor="shirt-desc" className="text-xs font-medium text-zinc-400">{mode === "logo" ? "Shirt style (optional)" : "Describe the shirt"}</label>
            <textarea id="shirt-desc" value={description} maxLength={240} disabled={busy} onChange={e => setDescription(e.target.value)} rows={2} placeholder={mode === "logo" ? "e.g. oversized heavyweight tee, slightly faded" : "e.g. oversized black tee with a gold dragon across the chest"} className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-white/30" />
            <div className="flex flex-wrap gap-1.5" aria-label="Shirt colour">
              {SHIRT_COLORS.map(c => <button key={c} type="button" disabled={busy} aria-pressed={color === c} onClick={() => setColor(color === c ? "" : c)} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${color === c ? "border-[#D4F53C]/60 bg-[#D4F53C]/15 text-[#D4F53C]" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"}`}>{c}</button>)}
            </div>
          </div>}
          {mode === "auto" && <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm leading-6 text-zinc-300">The AI will choose a clean, premium shirt that suits your character and fit it realistically. Run it again for a different design.</p>}

          <div>
            <p className="mb-2 text-xs font-medium text-zinc-400">Pose</p>
            <div className="flex flex-wrap gap-1.5">
              {SHIRT_POSES.map(p => <button key={p.id} type="button" disabled={busy} aria-pressed={pose === p.id} onClick={() => setPose(p.id)} className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${pose === p.id ? "border-white/60 bg-white text-black" : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/25 hover:text-white"}`}>{p.label}</button>)}
            </div>
          </div>
          <AnimatePresence>{error && <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</motion.p>}</AnimatePresence>
        </div>

        <div className="flex gap-2 border-t border-white/10 bg-black/20 p-4">
          {result && <button type="button" onClick={() => { onUse(result.url); onClose(); }} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-[#D4F53C]/50 bg-[#D4F53C]/10 text-[15px] font-bold transition-colors hover:bg-[#D4F53C]/20" style={{ color: LIME }}><Check className="size-4" strokeWidth={3} />Use this look</button>}
          <button type="button" disabled={!ready || busy || billing.paying} onClick={() => void run()} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-black transition-all active:scale-[.985] disabled:cursor-not-allowed disabled:opacity-40" style={{ background: LIME, boxShadow: ready && !busy ? "0 10px 28px -10px rgba(212,245,60,0.6)" : undefined }}>
            {busy ? <><Loader2 className="size-4 animate-spin" />Working…</> : billing.paying ? <><Loader2 className="size-4 animate-spin" />Confirm in wallet…</> : <><Sparkles className="size-4" />{result ? "Try again" : "Generate shirt"}{priceLabel(billing, 1) && <span className="rounded-full bg-black/15 px-2 py-0.5 text-[11px] font-semibold">{priceLabel(billing, 1)}</span>}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
