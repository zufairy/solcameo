"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import {
  Clapperboard, Globe, Loader2, AlertCircle, Sparkles, Upload, History, Play,
  Wand2, PencilLine, Film, CheckCircle2, MousePointerClick, Palette, UserRound,
  Download, Languages, RotateCcw, Shuffle,
} from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// ── ANIMATION STORYBOARD ─────────────────────────────────────────────────────
//  Analyze finishes → breakdown cascade (absolute from result landing):
//     0ms  summary strip fades up
//   140ms  concept card 1 springs in
//   260ms  concept card 2 springs in
//   380ms  concept card 3 springs in
//   520ms  generate CTA fades up
//  Each render card cross-fades its stage line (scripting → rendering → done).
const TIMING = {
  summary: 0,
  conceptBase: 0.14,
  conceptStagger: 0.12,
  cta: 0.52,
  spring: { type: "spring" as const, stiffness: 260, damping: 24 },
};

type ConceptFormat = "reaction" | "cartoon" | "review";
interface Concept { format: ConceptFormat; title: string; idea: string; hookText: string }
interface Analysis {
  productSummary: string;
  concepts: Concept[];
  screenshotUrl: string | null;
  productImageUrl: string | null;
  productImageUrls?: string[];
  websiteText: string;
}

const FORMAT_META: Record<ConceptFormat, { label: string; engine: string; length: string; icon: typeof Film; blurb: string }> = {
  reaction: { label: "Reaction + Text", engine: "Grok Imagine", length: "~8s", icon: MousePointerClick, blurb: "Caught-on-camera reverse psychology — candid multi-cut reaction, deadpan observer text, zero sell." },
  cartoon: { label: "Anime Soft-Sell", engine: "Seedance 1.5", length: "~20s", icon: Palette, blurb: "Anime mini-episode — the product's real problem is the plot, its feature is the turn." },
  review: { label: "Realistic Review", engine: "Gemini Omni", length: "~10s", icon: UserRound, blurb: "Hyper-real selfie review locked to the uploaded face — grounded in the site's real claims." },
};

interface SlotDoc { type: string; label: string; engine: string; status: string; concept?: string; script?: string; videoUrl?: string; imageUrls?: string[]; error?: string }
interface RunDoc { _id: Id<"ugcSampleRuns">; websiteUrl: string; clientName?: string; language?: string; createdAt: number; slots: SlotDoc[] }

const LANGUAGES = ["English", "Manglish", "Bahasa Malaysia", "Bahasa Indonesia", "Spanish", "French", "Hindi", "Tagalog", "Arabic", "Mandarin Chinese"] as const;

function clientNameOf(r: RunDoc): string {
  if (r.clientName) return r.clientName;
  try {
    const stem = new URL(r.websiteUrl).hostname.replace(/^www\./i, "").split(".")[0] ?? "";
    return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : r.websiteUrl;
  } catch { return r.websiteUrl; }
}

/** Blob download (works cross-origin when the host sends CORS, which the
 *  Supabase-hosted burns do); falls back to opening the file in a new tab. */
async function downloadVideo(url: string, name: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name.endsWith(".mp4") ? name : `${name}.mp4`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

const SLOT_STAGES: Record<string, { label: string; icon: typeof Film }> = {
  pending: { label: "Queued", icon: Loader2 },
  scripting: { label: "Writing the script…", icon: PencilLine },
  rendering: { label: "Rendering video…", icon: Film },
  done: { label: "Done", icon: CheckCircle2 },
  failed: { label: "Failed", icon: AlertCircle },
};

// Client-side downscale before upload — 3 full-res photos once overflowed a
// JSON body ("Unterminated string"); one compressed frame stays far under it.
async function compressImageDataUrl(dataUrl: string, maxDim = 1280, quality = 0.9): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** History-card avatar: the client site's favicon (via Google's favicon proxy —
 *  works for any public domain, no crawling); falls back to the letter badge
 *  when the domain is unparsable or the icon fails to load. */
function ClientFavicon({ websiteUrl, fallback }: { websiteUrl: string; fallback: string }) {
  const [broken, setBroken] = useState(false);
  const host = (() => { try { return new URL(websiteUrl).hostname; } catch { return ""; } })();
  if (!host || broken) {
    return (
      <div className="flex items-center justify-center size-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-[13px] font-bold text-cyan-300">
        {fallback}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center size-8 rounded-lg bg-white/[0.06] border border-[#1e1e24] overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
        alt={host}
        className="size-5"
        onError={() => setBroken(true)}
      />
    </div>
  );
}

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function AdminUgcSamplePage() {
  const { accessToken, getFreshToken } = useSupabaseAuth();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [clientType, setClientType] = useState<"app" | "physical" | "service">("app");
  const [language, setLanguage] = useState<string>("English");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<Id<"ugcSampleRuns"> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = useQuery(api.ugcSampleRuns.get, runId ? { runId } : "skip");
  const history = useQuery(api.ugcSampleRuns.listRecent, { limit: 20 });

  const token = async () => (await getFreshToken?.()) || accessToken || undefined;

  const onPhoto = async (file: File) => {
    setPhotoUploading(true);
    setError(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Couldn't read the file"));
        r.readAsDataURL(file);
      });
      const compressed = await compressImageDataUrl(dataUrl);
      const res = await fetch("/api/upload-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: compressed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error || `Upload failed (${res.status})`);
      setPhotoUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoUploading(false);
    }
  };

  const analyze = async () => {
    if (!websiteUrl.trim() || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setRunId(null);
    try {
      const res = await fetch("/api/admin/ugc-sample/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl: websiteUrl.trim(), notes, clientType, accessToken: await token() }),
      });
      const raw = await res.text();
      let data: (Analysis & { ok?: boolean; error?: string }) | null = null;
      try { data = JSON.parse(raw); } catch { /* handled below */ }
      if (!data) throw new Error(`Request failed (HTTP ${res.status})`);
      if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setAnalysis(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const generate = async () => {
    if (!analysis || !photoUrl || launching) return;
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ugc-sample/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteUrl: websiteUrl.trim(),
          photoUrl,
          productSummary: analysis.productSummary,
          websiteText: analysis.websiteText,
          screenshotUrl: analysis.screenshotUrl ?? "",
          productImageUrl: analysis.productImageUrl ?? "",
          productImageUrls: analysis.productImageUrls ?? [],
          concepts: analysis.concepts,
          clientType,
          language,
          accessToken: await token(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Launch failed (${res.status})`);
      setRunId(data.runId as Id<"ugcSampleRuns">);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLaunching(false);
    }
  };

  const [retrying, setRetrying] = useState<number | null>(null);
  // `targetRunId` lets HISTORY packs retry their own slots (a failed FOMO/
  // Emotional card in an old pack was previously unrecoverable — and invisible).
  // Retrying a history slot reopens that run so the live subscription shows it.
  const retrySlot = async (index: number, targetRunId?: Id<"ugcSampleRuns">) => {
    const rid = targetRunId ?? runId;
    if (!rid || retrying !== null) return;
    setRetrying(index);
    try {
      const res = await fetch("/api/admin/ugc-sample/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: rid, index, accessToken: await token() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Retry failed (${res.status})`);
      if (targetRunId && targetRunId !== runId) {
        setRunId(targetRunId);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(null);
    }
  };

  const activeSlots = run?.slots ?? null;
  const canGenerate = !!analysis && !!photoUrl && !launching && !runId;

  const historyRows: RunDoc[] = useMemo(() => ((history ?? []) as RunDoc[]).filter((h) => h._id !== runId), [history, runId]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="max-w-[1100px] mx-auto px-6 py-10">
        <div className="flex items-center gap-2.5 mb-1.5">
          <div className="flex items-center justify-center size-7 rounded-lg bg-cyan-500/15 border border-cyan-500/25">
            <Clapperboard className="size-3.5 text-cyan-400" />
          </div>
          <h1 className="text-[19px] font-bold text-white">UGC Sample</h1>
          <span className="text-[10px] text-cyan-500/70 border border-cyan-500/20 rounded-md px-1.5 py-0.5 font-mono">generated from a website</span>
        </div>
        {/* ── Step 1: inputs ── */}
        <div className="rounded-2xl border border-[#1c1c22] bg-[#0d0d10] p-5 mb-6">
          <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Client website</label>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-[#1e1e24] bg-[#0a0a0c] px-3.5 h-11 focus-within:border-cyan-500/50">
            <Globe className="size-4 text-zinc-600 shrink-0" />
            <input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://client-product.com"
              className="flex-1 bg-transparent text-[13px] text-white placeholder:text-zinc-600 outline-none"
              disabled={analyzing || launching}
            />
          </div>

          {/* Client type — decides how the product is shown (a physical product
              must be IN HAND; an app lives on screen) and what data feeds the
              scripts/briefs. */}
          <div className="mt-4">
            <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Client type</label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {([
                { id: "app", label: "📱 App / Software", hint: "the UI on screen is the star" },
                { id: "physical", label: "📦 Physical product", hint: "presenter holds + uses it on camera" },
                { id: "service", label: "🛍️ Service / Shop", hint: "sells the experience + outcome" },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.hint}
                  disabled={analyzing || launching}
                  onClick={() => setClientType(t.id)}
                  aria-pressed={clientType === t.id}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-40 ${
                    clientType === t.id
                      ? "border border-cyan-500/50 bg-cyan-500/[0.08] text-cyan-300"
                      : "border border-[#1e1e24] bg-[#0a0a0c] text-zinc-400 hover:border-[#34343e]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Script language — every script + text story is written natively in it. */}
          <div className="mt-4">
            <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Script language</label>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-[#1e1e24] bg-[#0a0a0c] px-3.5 h-11 w-fit focus-within:border-cyan-500/50">
              <Languages className="size-4 text-zinc-600 shrink-0" />
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={analyzing || launching}
                className="bg-transparent text-[13px] text-white outline-none pr-2 [&>option]:bg-[#0a0a0c]"
              >
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
                Presenter photo <span className="text-zinc-700 normal-case font-normal">(required — fronts the reaction + review)</span>
              </label>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={photoUploading || analyzing || launching}
                className={`mt-2 w-full flex items-center gap-3 rounded-xl border px-3.5 h-14 transition ${
                  photoUrl ? "border-cyan-500/40 bg-cyan-500/[0.05]" : "border-dashed border-[#26262e] bg-[#0a0a0c] hover:border-[#34343e]"
                }`}
              >
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt="presenter" className="size-10 rounded-lg object-cover border border-[#26262e]" />
                ) : (
                  <div className="flex items-center justify-center size-10 rounded-lg bg-[#131318] border border-[#1e1e24]">
                    {photoUploading ? <Loader2 className="size-4 text-cyan-400 animate-spin" /> : <Upload className="size-4 text-zinc-500" />}
                  </div>
                )}
                <div className="text-left">
                  <p className="text-[12.5px] font-medium text-white">{photoUrl ? "Photo ready" : photoUploading ? "Uploading…" : "Upload a face photo"}</p>
                  <p className="text-[11px] text-zinc-600">{photoUrl ? "Click to replace" : "Clear, front-facing — this person appears in the videos"}</p>
                </div>
              </button>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
                Notes <span className="text-zinc-700 normal-case font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the videos should emphasize…"
                disabled={analyzing || launching}
                className="mt-2 w-full h-14 resize-none rounded-xl border border-[#1e1e24] bg-[#0a0a0c] px-3.5 py-2.5 text-[13px] text-white placeholder:text-zinc-600 outline-none focus:border-cyan-500/50"
              />
            </div>
          </div>

          <button
            onClick={analyze}
            disabled={analyzing || launching || !websiteUrl.trim()}
            className="mt-5 inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-white text-zinc-900 text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-100"
          >
            {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {analyzing ? "Reading the site…" : "Analyze website"}
          </button>
          {analyzing && (
            <p className="mt-2 text-[11.5px] text-zinc-500">Crawling copy, capturing a live screenshot, picking the best product shot…</p>
          )}
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3.5 py-3 text-[12.5px] text-red-300">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* ── Step 2: breakdown cascade ── */}
        <AnimatePresence>
          {analysis && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-6">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...TIMING.spring, delay: TIMING.summary }}
                className="rounded-2xl border border-[#1c1c22] bg-[#0d0d10] p-5 mb-4 flex gap-4"
              >
                {analysis.screenshotUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={analysis.screenshotUrl} alt="site" className="hidden sm:block w-36 rounded-lg border border-[#1e1e24] object-cover object-top self-start" />
                )}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Sparkles className="size-3.5 text-cyan-400" />
                    <span className="text-[12px] font-semibold text-white">What we understood</span>
                  </div>
                  <p className="text-[13px] text-zinc-400 leading-relaxed">{analysis.productSummary}</p>
                </div>
              </motion.div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {analysis.concepts.map((c, i) => {
                  const meta = FORMAT_META[c.format];
                  const Icon = meta.icon;
                  return (
                    <motion.div
                      key={c.format}
                      initial={{ opacity: 0, y: 16, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ ...TIMING.spring, delay: TIMING.conceptBase + i * TIMING.conceptStagger }}
                      className="rounded-2xl border border-[#1c1c22] bg-[#0d0d10] p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center justify-center size-6 rounded-md bg-cyan-500/10 border border-cyan-500/20">
                            <Icon className="size-3 text-cyan-400" />
                          </div>
                          <span className="text-[12.5px] font-semibold text-white">{meta.label}</span>
                        </div>
                        <span className="text-[9.5px] font-mono text-zinc-600 border border-[#1e1e24] rounded px-1.5 py-0.5">{meta.engine} · {meta.length}</span>
                      </div>
                      <p className="text-[12px] font-medium text-cyan-300/90 mb-1">{c.title}</p>
                      <p className="text-[11.5px] text-zinc-500 leading-snug">{c.idea}</p>
                      {c.format === "reaction" && c.hookText && (
                        <p className="mt-2 text-[11px] text-zinc-400 border border-[#1e1e24] rounded-lg px-2 py-1 inline-block font-semibold">“{c.hookText}”</p>
                      )}
                    </motion.div>
                  );
                })}
              </div>

              {!runId && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...TIMING.spring, delay: TIMING.cta }}
                  className="mt-4"
                >
                  <button
                    onClick={generate}
                    disabled={!canGenerate}
                    className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-cyan-500 text-zinc-950 text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-400"
                  >
                    {launching ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />}
                    {launching ? "Launching…" : "Generate 6 samples"}
                  </button>
                  {!photoUrl && <p className="mt-2 text-[11.5px] text-amber-400/80">Upload the presenter photo above first.</p>}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Step 3: live render cards ── */}
        {activeSlots && (
          <div className="flex gap-4 mb-10 overflow-x-auto pb-2 snap-x">
            {(activeSlots as SlotDoc[]).map((slot, i) => {
              const stage = SLOT_STAGES[slot.status] ?? SLOT_STAGES.pending;
              const StageIcon = stage.icon;
              const busy = slot.status === "pending" || slot.status === "scripting" || slot.status === "rendering";
              return (
                <motion.div
                  key={`${slot.type}-${i}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...TIMING.spring, delay: i * TIMING.conceptStagger }}
                  className="rounded-2xl border border-[#1c1c22] bg-[#0d0d10] overflow-hidden w-[240px] shrink-0 snap-start"
                >
                  <div className="px-3.5 py-2.5 border-b border-[#1c1c22] flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-white">{slot.label}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[9.5px] font-mono text-zinc-600">{slot.engine}</span>
                      {(slot.type === "story-fomo" || slot.type === "story-emotional") && !busy && (
                        // Shuffle = re-run the WHOLE story sequence for this card
                        // (fresh stock clip + fresh story + fresh audio track) via
                        // the retry route — text-only LLM cost, no video generation.
                        <button
                          type="button"
                          title="Shuffle — regenerate this story (new clip, new text, new audio)"
                          aria-label="Shuffle this story"
                          disabled={retrying !== null}
                          onClick={() => void retrySlot(i)}
                          className="grid size-6 place-items-center rounded-md border border-[#26262e] text-zinc-500 transition hover:border-cyan-500/40 hover:text-cyan-300 disabled:opacity-40"
                        >
                          {retrying === i ? <Loader2 className="size-3 animate-spin" /> : <Shuffle className="size-3" />}
                        </button>
                      )}
                    </span>
                  </div>
                  {(slot.imageUrls?.length ?? 0) > 0 ? (
                    <div className="w-full aspect-[9/16] bg-black overflow-y-hidden overflow-x-auto flex snap-x">
                      {slot.imageUrls!.map((u, j) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={u} src={u} alt={`slide ${j + 1}`} className="h-full w-full object-cover shrink-0 snap-start" />
                      ))}
                    </div>
                  ) : slot.status === "done" && slot.videoUrl ? (
                    <video src={slot.videoUrl} controls playsInline className="w-full aspect-[9/16] bg-black" />
                  ) : (
                    <div className="w-full aspect-[9/16] bg-[#0a0a0c] flex flex-col items-center justify-center gap-2.5 px-4">
                      <StageIcon className={`size-5 ${slot.status === "failed" ? "text-red-400" : "text-cyan-400"} ${busy ? "animate-pulse" : ""}`} />
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={slot.status}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.2 }}
                          className={`text-[11.5px] text-center ${slot.status === "failed" ? "text-red-300" : "text-zinc-500"}`}
                        >
                          {slot.status === "failed" ? (slot.error ?? stage.label) : stage.label}
                        </motion.span>
                      </AnimatePresence>
                      {slot.status === "failed" && (
                        <button
                          type="button"
                          disabled={retrying !== null}
                          onClick={() => void retrySlot(i)}
                          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/[0.08] px-3 py-1.5 text-[11.5px] font-semibold text-cyan-300 transition hover:bg-cyan-500/[0.15] disabled:opacity-40"
                        >
                          {retrying === i ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                          Retry this card
                        </button>
                      )}
                      {busy && (
                        <div className="w-24 h-1 rounded-full bg-[#1c1c22] overflow-hidden">
                          <motion.div
                            className="h-full w-1/3 bg-cyan-500 rounded-full"
                            animate={{ x: ["-100%", "300%"] }}
                            transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {slot.status === "done" && (slot.imageUrls?.length ?? 0) > 0 && !slot.videoUrl && (
                    <div className="p-3">
                      {slot.script && <p className="text-[11px] text-zinc-500 leading-snug line-clamp-3 whitespace-pre-line">{slot.script}</p>}
                      <p className="mt-1.5 text-[10.5px] text-zinc-600">{slot.imageUrls!.length} slides — swipe the preview · tap a slide to open</p>
                      <div className="mt-1 flex gap-2">
                        {slot.imageUrls!.map((u, j) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer" className="text-[10.5px] text-cyan-400 hover:text-cyan-300">{j + 1}</a>
                        ))}
                      </div>
                    </div>
                  )}
                  {slot.status === "done" && slot.videoUrl && (
                    <div className="p-3">
                      {slot.script && <p className="text-[11px] text-zinc-500 leading-snug line-clamp-3">{slot.script}</p>}
                      <div className="mt-2 flex items-center gap-3">
                        <a href={slot.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-cyan-400 hover:text-cyan-300">
                          <Play className="size-3" /> Open
                        </a>
                        <button type="button" onClick={() => void downloadVideo(slot.videoUrl!, `${slot.type}-sample`)}
                          className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-zinc-400 hover:text-white">
                          <Download className="size-3" /> Download
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* ── History ── */}
        <div className="flex items-center gap-2 mb-3">
          <History className="size-3.5 text-zinc-600" />
          <h2 className="text-[13px] font-semibold text-zinc-400">History</h2>
        </div>
        {history === undefined ? (
          <p className="text-[12px] text-zinc-600">Loading history…</p>
        ) : historyRows.length === 0 && !runId ? (
          <p className="text-[12px] text-zinc-600">No runs yet — generated sample packs show up here.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {historyRows.map((r) => {
              const doneSlots = r.slots.filter((sl) => sl.status === "done" && (sl.videoUrl || (sl.imageUrls?.length ?? 0) > 0));
              const packName = clientNameOf(r);
              return (
                <div key={r._id} className="rounded-2xl border border-[#1c1c22] bg-[#0d0d10] overflow-hidden">
                  {/* Pack header — client name + site, fetched from the run doc */}
                  <div className="px-4 py-3 border-b border-[#1c1c22] flex items-center gap-3">
                    <ClientFavicon websiteUrl={r.websiteUrl} fallback={packName.charAt(0)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold text-white truncate">{packName}</p>
                      <p className="text-[11px] text-zinc-600 truncate">
                        {r.websiteUrl} · {doneSlots.length}/{r.slots.length} videos{r.language ? ` · ${r.language}` : ""} · {timeAgo(r.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setRunId(r._id); setAnalysis(null); setWebsiteUrl(r.websiteUrl); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#1e1e24] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 hover:border-[#34343e] hover:text-white transition"
                    >
                      <Play className="size-3" /> Reopen
                    </button>
                  </div>
                  {/* EVERY slot in ONE sliding row — finished videos play, the
                      carousel is ONE card (inner slide strip), and a failed /
                      stuck slot shows its state WITH a Retry instead of being
                      silently hidden (the "FOMO/Emotional not showing" bug). */}
                  <div className="flex gap-3 overflow-x-auto p-3 snap-x">
                    {r.slots.map((sl, i) => {
                      const finished = sl.status === "done" && (sl.videoUrl || (sl.imageUrls?.length ?? 0) > 0);
                      if (finished && sl.videoUrl) {
                        return (
                          <div key={`${sl.type}-${i}`} className="w-[170px] shrink-0 snap-start">
                            <div className="relative rounded-xl overflow-hidden border border-[#1e1e24] bg-black">
                              <video src={sl.videoUrl} controls playsInline preload="metadata" className="w-full aspect-[9/16] object-cover" />
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <p className="text-[10.5px] text-zinc-500 truncate">{sl.label}</p>
                              <button
                                type="button"
                                aria-label={`Download ${sl.label}`}
                                onClick={() => void downloadVideo(sl.videoUrl!, `${packName}-${sl.type}`)}
                                className="shrink-0 text-zinc-500 hover:text-white transition"
                              >
                                <Download className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }
                      if (finished && (sl.imageUrls?.length ?? 0) > 0) {
                        // Carousel = ONE card: the slides swipe INSIDE it.
                        return (
                          <div key={`${sl.type}-${i}`} className="w-[170px] shrink-0 snap-start">
                            <div className="relative rounded-xl overflow-hidden border border-[#1e1e24] bg-black">
                              <div className="flex snap-x snap-mandatory overflow-x-auto">
                                {sl.imageUrls!.map((u, j) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={j} src={u} alt={`${sl.label} slide ${j + 1}`} className="w-[170px] shrink-0 snap-center aspect-[9/16] object-cover" />
                                ))}
                              </div>
                              <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300">{sl.imageUrls!.length} slides</span>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <p className="text-[10.5px] text-zinc-500 truncate">{sl.label} · swipe</p>
                              <a href={sl.imageUrls![0]} target="_blank" rel="noreferrer" aria-label={`Open ${sl.label}`} className="shrink-0 text-zinc-500 hover:text-white transition">
                                <Download className="size-3.5" />
                              </a>
                            </div>
                          </div>
                        );
                      }
                      // Unfinished: failed → error + Retry; still running/stuck →
                      // status + Retry (a slot stuck since a crashed run can be
                      // re-fired; the route 409s only genuinely-running slots).
                      const failed = sl.status === "failed";
                      return (
                        <div key={`${sl.type}-${i}`} className="w-[170px] shrink-0 snap-start">
                          <div className={`flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center ${failed ? "border-red-500/25 bg-red-500/[0.04]" : "border-[#1e1e24] bg-[#101014]"}`}>
                            {failed
                              ? <AlertCircle className="size-4 text-red-400" />
                              : <Loader2 className="size-4 animate-spin text-zinc-600" />}
                            <p className={`text-[10px] leading-snug ${failed ? "text-red-300/90" : "text-zinc-500"}`}>
                              {failed ? (sl.error ?? "failed").slice(0, 90) : `${sl.status}…`}
                            </p>
                            <button
                              type="button"
                              disabled={retrying !== null}
                              onClick={() => void retrySlot(i, r._id)}
                              className="inline-flex items-center gap-1 rounded-md border border-[#2a2a32] px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:border-[#3a3a44] hover:text-white transition disabled:opacity-40"
                            >
                              {retrying === i ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                              Retry
                            </button>
                          </div>
                          <p className="mt-1.5 text-[10.5px] text-zinc-500 truncate">{sl.label}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
