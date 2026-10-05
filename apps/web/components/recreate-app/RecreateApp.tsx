"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ImagePlus, Loader2, X, Sparkles, RotateCcw, Download, Video as VideoIcon, ChevronRight,
  ScanEye, Wand2, LayoutGrid, Play, UserRound, Clapperboard,
} from "lucide-react";
import { AppHeaderShell } from "@/components/home/app-shell";

/* ════════ /recreate — standalone Recreate app ════════
   Upload a video → the pipeline watches it (scene cuts + transcript + vision),
   replans it scene-for-scene with a swapped presenter/product/language, and
   renders it with the chosen engine: Grok Imagine 1.5 (full shot-for-shot
   recreation — base take + native extend chain, on-screen text in-frame) or
   Wan 2.2 Animate Replace (presenter swapped into the ORIGINAL footage, motion/
   scene preserved). Per-USER (Privy login only), no agent/mint dependency.
   Dark, premium-app theme — same visual language as /carousel's CarouselApp.tsx:
   near-black canvas, glass cards, a dashed upload well with a circular icon
   badge, and label/value "field" rows with a trailing chevron. */

// Deep near-black canvas with faint radial glows — the whole page reads as one
// dark gradient scene instead of a flat fill.
const BG: React.CSSProperties = {
  background:
    "radial-gradient(85% 55% at 12% -8%, rgba(163,230,53,0.05), transparent 60%), " +
    "radial-gradient(70% 45% at 108% 112%, rgba(120,160,255,0.05), transparent 55%), " +
    "#08080a",
};
const INTER = { fontFamily: "var(--font-inter, var(--font-geist-sans, system-ui))" } as const;

// 3D primary: white gradient plate, inset highlight, glow, lift on hover.
const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-white to-white/85 px-4 py-2 " +
  "text-[13px] font-semibold text-black outline-none " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_28px_-10px_rgba(255,255,255,0.35),0_2px_6px_rgba(0,0,0,0.4)] " +
  "transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] " +
  "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0";

// Frosted-glass secondary with inset top light.
const PILL =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-white/15 " +
  "bg-gradient-to-b from-white/[0.12] to-white/[0.05] px-2.5 py-1 text-[12px] font-medium text-white/80 " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-xl transition-all duration-200 " +
  "hover:-translate-y-px hover:bg-white/15 hover:text-white active:translate-y-0 " +
  "disabled:cursor-not-allowed disabled:opacity-30";

// 3D glass container: vertical gradient surface + inset top light + deep shadow.
const CARD =
  "rounded-[1.25rem] border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.015] p-4 " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_35px_80px_-45px_rgba(0,0,0,0.95)]";

const LANGUAGES = [
  "English", "Malay", "Chinese (Mandarin)", "Indonesian", "Tamil",
  "Arabic", "Spanish", "French", "Hindi", "Japanese", "Korean",
] as const;

const ENGINES = [
  { id: "grok", label: "Grok 1.5 · full recreation" },
  { id: "wan", label: "Wan Animate · swap the presenter" },
  { id: "aleph", label: "Runway Aleph · edit the original (swap product)" },
] as const;

const RACES = [
  { id: "match_original", label: "Match original presenter" },
  { id: "malay", label: "Malay" },
  { id: "chinese", label: "Chinese" },
  { id: "indian", label: "Indian" },
  { id: "east_asian", label: "East Asian" },
  { id: "caucasian", label: "Caucasian / European" },
  { id: "black", label: "Black / African" },
  { id: "latino", label: "Latino / Hispanic" },
  { id: "arab", label: "Arab / Middle Eastern" },
  { id: "south_asian", label: "South Asian" },
] as const;

const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB — generous for a ≤60s clip
const MAX_SOURCE_SECONDS = 60;

type Phase = "understanding" | "planning" | "video" | "stitching" | "done" | "failed";
type Project = {
  _id: Id<"videoRecreateProjects">;
  sourceVideoUrl: string;
  productImageUrl?: string;
  language: string;
  race: string;
  avatarUrl?: string;
  phase: Phase;
  statusMessage: string;
  totalSegments?: number;
  clipIndex?: number;
  videoUrl?: string;
  videoNote?: string;
  error?: string;
};

const PROGRESS_STEPS: Phase[] = ["understanding", "planning", "video", "stitching", "done"];

const HOW_IT_WORKS = [
  { Icon: VideoIcon, title: "Upload your video", body: "A 1-60s clip: any product, presenter, or setting." },
  { Icon: ScanEye, title: "AI understands it", body: "Scene cuts, spoken script, and visuals are analyzed shot by shot." },
  { Icon: Wand2, title: "Recreated for you", body: "New presenter, language, and product. Same shot-for-shot pacing." },
] as const;

/** Label-on-top / value-below field with a trailing chevron. */
function FieldSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly (string | { id: string; label: string })[];
}) {
  const norm = options.map((o) => (typeof o === "string" ? { id: o, label: o } : o));
  return (
    <div className="relative rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-white/40">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full appearance-none bg-transparent pr-6 text-[13px] font-semibold text-white outline-none [&>option]:bg-neutral-900"
      >
        {norm.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <ChevronRight className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
    </div>
  );
}

export function RecreateApp() {
  const { user, authenticated, login } = usePrivy();
  const ownerId = user?.id;

  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);

  const [sourceVideoUrl, setSourceVideoUrl] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [productUploading, setProductUploading] = useState(false);
  const [characterImageUrl, setCharacterImageUrl] = useState<string | null>(null);
  const [characterUploading, setCharacterUploading] = useState(false);
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [race, setRace] = useState<string>(RACES[0].id);
  const [engine, setEngine] = useState<string>(ENGINES[0].id);
  const [referenceUrl, setReferenceUrl] = useState<string>("");
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [refMode, setRefMode] = useState<"product" | "web" | "app">("product");
  const [appStoreUrl, setAppStoreUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const [projectId, setProjectId] = useState<Id<"videoRecreateProjects"> | null>(null);
  const project = useQuery(api.videoRecreateProjects.get, projectId ? { id: projectId } : "skip") as Project | null | undefined;

  const uploadToStorage = useCallback(async (file: File): Promise<string | null> => {
    const uploadUrl = await generateUploadUrl({});
    const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) return null;
    const { storageId } = (await res.json()) as { storageId: string };
    return (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
  }, [generateUploadUrl, resolveStorageUrl]);

  const handleVideoUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("video/")) { setError("Pick a video file."); return; }
    if (file.size > MAX_VIDEO_BYTES) { setError(`Video is ${(file.size / 1048576).toFixed(0)}MB. Keep it under 200MB.`); return; }
    setVideoUploading(true);
    setError(null);
    try {
      const url = await uploadToStorage(file);
      if (url) { setSourceVideoUrl(url); setSourceFileName(file.name); }
      else setError("Could not upload the video.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setVideoUploading(false);
    }
  }, [uploadToStorage]);

  const handleProductUpload = useCallback(async (file: File) => {
    setProductUploading(true);
    setError(null);
    try {
      const url = await uploadToStorage(file);
      if (url) setProductImageUrl(url);
      else setError("Could not upload the product image.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setProductUploading(false);
    }
  }, [uploadToStorage]);

  const handleCharacterUpload = useCallback(async (file: File) => {
    setCharacterUploading(true);
    setError(null);
    try {
      const url = await uploadToStorage(file);
      if (url) setCharacterImageUrl(url);
      else setError("Could not upload the presenter photo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setCharacterUploading(false);
    }
  }, [uploadToStorage]);

  // Ads Library hand-off: /recreate?src=<external ad video url> — download +
  // re-host it once (the ad CDN URLs expire), then it's ready to replicate.
  const searchParams = useSearchParams();
  const importedRef = useRef(false);
  useEffect(() => {
    const src = searchParams.get("src");
    if (!src || !authenticated || importedRef.current || sourceVideoUrl) return;
    importedRef.current = true;
    setVideoUploading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/recreate/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: src }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
        if (!res.ok || !j.ok || !j.url) {
          setError(j.error ?? "Could not import the ad video. It may have expired, pick it again from the Ads Library.");
          return;
        }
        setSourceVideoUrl(j.url);
        setSourceFileName(searchParams.get("title") || "Ads Library video");
      } catch (e) {
        setError(e instanceof Error ? e.message : "import failed");
      } finally {
        setVideoUploading(false);
      }
    })();
  }, [searchParams, authenticated, sourceVideoUrl]);

  const canStart = authenticated && !!sourceVideoUrl && !starting && !videoUploading;

  const startRecreate = useCallback(async () => {
    if (!canStart || !sourceVideoUrl) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/recreate/kickoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceVideoUrl,
          engine,
          productImageUrl: (engine !== "wan" && refMode === "product" && productImageUrl) || undefined,
          characterImageUrl: (engine !== "aleph" && characterImageUrl) || undefined,
          referenceUrl: ((engine === "grok" || refMode === "web") && engine !== "wan" && referenceUrl.trim()) || undefined,
          userPrompt: userPrompt.trim() || undefined,
          refMode: engine !== "wan" ? refMode : undefined,
          appStoreUrl: (engine !== "wan" && refMode === "app" && appStoreUrl.trim()) || undefined,
          language,
          race,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; projectId?: string };
      if (!res.ok || !j.ok || !j.projectId) {
        setError(j.error ?? `Could not start (HTTP ${res.status})`);
        return;
      }
      setProjectId(j.projectId as Id<"videoRecreateProjects">);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setStarting(false);
    }
  }, [canStart, sourceVideoUrl, productImageUrl, characterImageUrl, referenceUrl, userPrompt, refMode, appStoreUrl, engine, language, race]);

  const reset = useCallback(() => {
    setProjectId(null);
    setSourceVideoUrl(null);
    setSourceFileName(null);
    setProductImageUrl(null);
    setCharacterImageUrl(null);
    setReferenceUrl("");
    setUserPrompt("");
    setAppStoreUrl("");
    setError(null);
  }, []);

  const history = useQuery(
    api.videoRecreateProjects.listByOwner,
    ownerId ? { ownerId } : "skip",
  ) as Project[] | undefined;

  if (!authenticated) {
    return (
      <AppHeaderShell>
        <div className="grid min-h-full place-items-center px-8 py-10" style={{ ...BG, ...INTER }}>
          <div className={`${CARD} text-center`}>
            <h2 className="text-[20px] font-thin tracking-tight text-white">Recreate</h2>
            <p className="mt-1.5 text-[13.5px] text-white/40">Sign in to upload and recreate a video.</p>
            <button type="button" onClick={login} className={`${PRIMARY_BTN} mt-4`}>Sign in</button>
          </div>
        </div>
      </AppHeaderShell>
    );
  }

  const stepIndex = project ? PROGRESS_STEPS.indexOf(project.phase) : -1;

  return (
    <AppHeaderShell>
    <div className="min-h-full px-6 py-7" style={{ ...BG, ...INTER }}>
      <div className="mx-auto max-w-[920px]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="flex items-center gap-2.5 text-[20px] font-thin tracking-tight text-white">
              <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                <RotateCcw className="size-4.5 text-white/80" strokeWidth={1.75} />
              </span>
              Recreate
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {project && (
              <button type="button" onClick={reset} className={PILL}>
                <RotateCcw className="size-3.5" /> New recreation
              </button>
            )}
            <Link href="/recreate/library" className={PILL}>
              <LayoutGrid className="size-3.5" /> Ads Library
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* ── Left: upload card ─────────────────────────────────────────── */}
          <div className={CARD}>
            {sourceVideoUrl ? (
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                <video src={sourceVideoUrl} controls className="aspect-[9/16] w-full max-h-[300px] object-contain bg-black" />
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="truncate text-[12px] text-white/45">{sourceFileName}</span>
                  <button type="button" onClick={() => { setSourceVideoUrl(null); setSourceFileName(null); }} className="rounded p-0.5 text-white/40 hover:text-white">
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <label className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[1.1rem] border-2 border-dashed border-white/15 bg-white/[0.015] px-4 py-8 text-center transition-colors hover:border-white/25 hover:bg-white/[0.03]">
                {/* Stacked-frames illustration — three fanned 9:16 cards with a
                    play badge on the front one, instead of a lone video glyph. */}
                <span className="relative h-[70px] w-[88px]">
                  <span className="absolute left-1 top-3.5 h-[53px] w-[38px] -rotate-[10deg] rounded-lg border border-white/12 bg-gradient-to-b from-white/[0.10] to-white/[0.02] shadow-[0_8px_20px_-8px_rgba(0,0,0,0.8)] transition-transform duration-300 group-hover:-rotate-[14deg] group-hover:-translate-x-1" />
                  <span className="absolute left-[25px] top-1 h-[57px] w-[40px] rotate-[2deg] rounded-lg border border-white/15 bg-gradient-to-b from-white/[0.14] to-white/[0.03] shadow-[0_10px_24px_-8px_rgba(0,0,0,0.85)]" />
                  <span className="absolute left-[48px] top-2.5 grid h-[55px] w-[39px] rotate-[11deg] place-items-center rounded-lg border border-lime-300/30 bg-gradient-to-b from-lime-300/[0.16] to-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_12px_28px_-8px_rgba(0,0,0,0.9)] transition-transform duration-300 group-hover:rotate-[15deg] group-hover:translate-x-1">
                    {videoUploading
                      ? <Loader2 className="size-4 animate-spin text-lime-200" />
                      : <Play className="size-4 fill-lime-200 text-lime-200" />}
                  </span>
                </span>
                <span className="text-[14px] font-medium text-white">{videoUploading ? "Uploading…" : "Upload video to edit"}</span>
                <span className="text-[12.5px] text-white/35">1–{MAX_SOURCE_SECONDS}s clip · up to 200MB</span>
                <input type="file" accept="video/*" className="hidden" disabled={videoUploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleVideoUpload(f); e.target.value = ""; }} />
              </label>
            )}

            <div className="mt-3">
              <FieldSelect label="Engine" value={engine} onChange={setEngine} options={ENGINES} />
              <p className="mt-1.5 text-[11.5px] text-white/35">
                {engine === "wan"
                  ? "Swaps the presenter. Same scene, motion, pacing."
                  : engine === "aleph"
                    ? "Edits the original to your prompt. Everything else stays as filmed."
                    : "Full shot-for-shot recreation: new presenter, language, product, text."}
              </p>
            </div>

            {/* One row: the promote switch (product / website / app) + the
                Product and Presenter upload buttons / attached chips. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {engine !== "wan" && (
                <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5 w-fit">
                  {([
                    { id: "product", label: "Product" },
                    { id: "web", label: "Website" },
                    { id: "app", label: "App" },
                  ] as const).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setRefMode(m.id)}
                      className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${refMode === m.id ? "bg-white text-black" : "text-white/50 hover:text-white/80"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
              {engine !== "wan" && refMode === "product" && (
                productImageUrl ? (
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] py-0.5 pl-0.5 pr-1.5"
                    title={engine === "aleph" ? "Aleph swaps it into the original footage" : "Swapped into scenes showing a product"}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={productImageUrl} alt="Product" className="size-6 rounded-md object-cover" />
                    <span className="text-[11px] text-white/70">Product</span>
                    <button type="button" onClick={() => setProductImageUrl(null)} className="rounded p-0.5 text-white/40 hover:text-white">
                      <X className="size-3" />
                    </button>
                  </div>
                ) : (
                  <label className={`${PILL} cursor-pointer`} title="Upload a product image (optional). It gets swapped into the video">
                    {productUploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                    {productUploading ? "…" : "Product"}
                    <input type="file" accept="image/*" className="hidden" disabled={productUploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleProductUpload(f); e.target.value = ""; }} />
                  </label>
                )
              )}
              {engine !== "aleph" && (
                characterImageUrl ? (
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] py-0.5 pl-0.5 pr-1.5"
                    title={engine === "grok" ? "This person presents the recreation" : "This person is swapped into the video"}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={characterImageUrl} alt="Presenter" className="size-6 rounded-md object-cover" />
                    <span className="text-[11px] text-white/70">Presenter</span>
                    <button type="button" onClick={() => setCharacterImageUrl(null)} className="rounded p-0.5 text-white/40 hover:text-white">
                      <X className="size-3" />
                    </button>
                  </div>
                ) : (
                  <label className={`${PILL} cursor-pointer`} title="Upload a presenter photo (optional). Leave empty and we generate one">
                    {characterUploading ? <Loader2 className="size-3.5 animate-spin" /> : <UserRound className="size-3.5" />}
                    {characterUploading ? "…" : "Presenter"}
                    <input type="file" accept="image/*" className="hidden" disabled={characterUploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCharacterUpload(f); e.target.value = ""; }} />
                  </label>
                )
              )}
            </div>

            {engine !== "wan" && refMode === "app" && (
              <div className="mt-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
                <input
                  type="url"
                  value={appStoreUrl}
                  onChange={(e) => setAppStoreUrl(e.target.value)}
                  placeholder="App Store / Play Store link"
                  className="w-full bg-transparent text-[13px] text-white placeholder:text-white/30 outline-none"
                />
              </div>
            )}

            {engine !== "wan" && refMode !== "app" && (
              <div className="mt-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
                <input
                  type="url"
                  value={referenceUrl}
                  onChange={(e) => setReferenceUrl(e.target.value)}
                  placeholder={refMode === "web" ? "Website link — https://your-site.com" : "Product / brand link (optional)"}
                  className="w-full bg-transparent text-[13px] text-white placeholder:text-white/30 outline-none"
                />
              </div>
            )}

            {/* Free-text direction — rides every prompt (grok), or steers the
                Aleph edit directly. */}
            <div className="relative mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-white/40">
                {engine === "aleph" ? "What should change? (prompt)" : "Extra direction (optional)"}
              </span>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                rows={2}
                placeholder={engine === "aleph"
                  ? "e.g. Replace the phone on the desk with my product; change the billboard text to VELLO"
                  : "e.g. Focus on the discount offer, keep the energy calm, mention free shipping"}
                className="mt-1 w-full resize-none bg-transparent text-[13px] font-medium text-white placeholder:font-normal placeholder:text-white/25 outline-none"
              />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {engine === "grok" && <FieldSelect label="Language" value={language} onChange={setLanguage} options={LANGUAGES} />}
              {engine !== "aleph" && !characterImageUrl && (
                <FieldSelect label="Presenter" value={race} onChange={setRace} options={RACES} />
              )}
            </div>

            <button type="button" disabled={!canStart} onClick={() => void startRecreate()} className={`${PRIMARY_BTN} mt-5 w-full`}>
              {starting ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />}
              {starting ? "Starting…" : "Recreate"}
            </button>
            {error && <p className="mt-3 text-[12.5px] text-red-400">{error}</p>}
          </div>

          {/* ── Right: generation progress / result ─────────────────────────── */}
          <div className={CARD}>
            {!project ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 text-center">
                {/* "Finished video" illustration: a glowing 9:16 frame with a
                    play badge, film-strip edges, and sparkles — what done looks
                    like, not an empty video glyph. */}
                <span className="relative">
                  <span className="relative grid h-[112px] w-[66px] place-items-center rounded-xl border border-white/15 bg-gradient-to-b from-white/[0.10] to-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_18px_40px_-16px_rgba(0,0,0,0.9)]">
                    {/* film-strip perforations */}
                    <span className="absolute inset-y-2 left-1.5 flex w-1 flex-col justify-between">
                      {[0, 1, 2, 3, 4].map((n) => <span key={n} className="h-1.5 w-1 rounded-[2px] bg-white/15" />)}
                    </span>
                    <span className="absolute inset-y-2 right-1.5 flex w-1 flex-col justify-between">
                      {[0, 1, 2, 3, 4].map((n) => <span key={n} className="h-1.5 w-1 rounded-[2px] bg-white/15" />)}
                    </span>
                    <span className="grid size-9 place-items-center rounded-full border border-lime-300/30 bg-lime-300/10 shadow-[0_0_24px_rgba(163,230,53,0.25)]">
                      <Play className="ml-0.5 size-4 fill-lime-200 text-lime-200" />
                    </span>
                  </span>
                  <Sparkles className="absolute -right-4 -top-3 size-4 text-lime-200/70" />
                  <Sparkles className="absolute -left-4 bottom-2 size-3 text-white/30" />
                </span>
                <div>
                  <p className="text-[13.5px] font-medium text-white/70">Your recreation lands here</p>
                  <p className="mt-0.5 text-[12px] text-white/35">Upload a clip and hit Recreate.</p>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-1.5">
                  {PROGRESS_STEPS.map((p) => (
                    <div key={p} className="flex flex-1 items-center gap-1.5">
                      <div className={`h-1.5 flex-1 rounded-full ${project.phase === "failed" ? "bg-red-900/50" : PROGRESS_STEPS.indexOf(p) <= stepIndex ? "bg-white" : "bg-white/10"}`} />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {project.phase !== "done" && project.phase !== "failed" && <Loader2 className="size-4 animate-spin text-white/40" />}
                  <p className={`text-[13px] ${project.phase === "failed" ? "text-red-400" : "text-white/70"}`}>
                    {project.phase === "failed" ? (project.error ?? "Failed") : project.statusMessage}
                  </p>
                </div>

                <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                  {project.phase === "done" && project.videoUrl ? (
                    <video src={project.videoUrl} controls autoPlay className="aspect-[9/16] w-full max-h-[420px] object-contain bg-black" />
                  ) : (
                    <div className="grid aspect-[9/16] max-h-[420px] place-items-center">
                      <Loader2 className="size-8 animate-spin text-white/20" />
                    </div>
                  )}
                </div>
                {project.videoNote && <p className="mt-2 text-[11.5px] text-white/35">{project.videoNote}</p>}
                {project.phase === "done" && project.videoUrl && (
                  <a href={project.videoUrl} download target="_blank" rel="noreferrer" title="Download" className={`${PILL} mt-3 w-fit !px-2.5`}>
                    <Download className="size-4" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        {!project && (
          <div className="mt-10 grid gap-3.5 sm:grid-cols-3">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={s.title} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                <span className="grid size-10 place-items-center rounded-full bg-gradient-to-b from-white/[0.09] to-white/[0.02] ring-1 ring-white/10">
                  <s.Icon className="size-[18px] text-white/60" />
                </span>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/35">Step {i + 1}</p>
                <h4 className="mt-0.5 text-[14px] font-semibold text-white">{s.title}</h4>
                <p className="mt-1 text-[12.5px] leading-relaxed text-white/40">{s.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── History ───────────────────────────────────────────────────────── */}
        {history && history.length > 0 && (
          <div className="mt-8">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-white/40">History</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {history.map((p) => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => setProjectId(p._id)}
                  className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] text-left transition-transform hover:-translate-y-0.5"
                >
                  {p.videoUrl ? (
                    <video
                      src={p.videoUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="aspect-[9/16] w-full bg-black object-cover"
                      onMouseEnter={(e) => { void e.currentTarget.play().catch(() => {}); }}
                      onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                    />
                  ) : (
                    <div className="grid aspect-[9/16] w-full place-items-center text-white/20">
                      {p.phase === "failed" ? <X className="size-5" /> : <Loader2 className="size-4 animate-spin" />}
                    </div>
                  )}
                  <p className="truncate px-2 py-1.5 text-[11px] font-medium text-white/60">{p.language} · {RACES.find((r) => r.id === p.race)?.label ?? p.race}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </AppHeaderShell>
  );
}
