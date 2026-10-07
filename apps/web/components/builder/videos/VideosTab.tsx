"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { normalizeShowBible, resolveIdentityRefs } from "@/lib/builder/showBible";
import type { Id } from "@/convex/_generated/dataModel";
import { Loader2, Wand2, X, Maximize2, Trash2, RotateCcw, AlertCircle, ImagePlus } from "lucide-react";
import { DEFAULT_VIDEO_ENGINE, VIDEO_STORYBOARD_COST_USDC, getVideoEngine, resolveDurationRange, selectableVideoEngines, videoLengthOptions, videoCostForLength, type VideoEngineId } from "@/lib/builder/agentTypes";
import { KIE_VIDEO_PRICING, type VideoQuality } from "@/lib/builder/kieVideoPricing";
import { formatRetailUsd } from "@/lib/pricing/retail";
import { aspectFor, aspectsForEngine, type VideoAspect } from "@/lib/builder/videoAspects";
import { CardProgress } from "@/components/explore/RenderProgress";
import { CHIP, ChipCheck, ChipSelect, PANEL, PriceButton, ResultHeading } from "@/components/builder/generate/ui";
import { MentionTextarea, type Mention } from "@/components/builder/generate/MentionTextarea";

// Same visible set as the Director tab's engine picker — keep in sync with it.
// Computed LAZILY (not at module init): dereferencing VIDEO_ENGINES while this
// module evaluates trips a TDZ ("Cannot access 'X' before initialization") in
// the minified production chunk whenever webpack orders this module ahead of
// agentTypes — which is exactly what broke the Videos tab in prod.
function visibleEngines() {
  // Veo 3.1 + Kling hidden from user pickers (HIDDEN_VIDEO_ENGINE_IDS) — an
  // agent already configured on one still renders with it.
  return selectableVideoEngines();
}


import { useAgentLibrary } from "@/components/builder/useAgentLibrary";


type VideoAsset = {
  id: string;
  taskId?: Id<"agentTasks">;
  url?: string;
  posterUrl?: string;
  prompt: string;
  createdAt: number;
  status?: "pending" | "error";
  error?: string;
  /** Rough elapsed-time label while pending — videos take a while, and a bare
   *  spinner with no sense of progress reads as broken. */
  startedAt?: number;
  /** Snapshot of what actually went into this specific generation — captured at
   *  click time, not read live later, so the modal always shows what THIS video
   *  used even if the operator changes the engine/reference/toggles afterward. */
  meta?: {
    engineId: VideoEngineId;
    referenceImages: string[];
    skipStoryboard: boolean;
    noPersona: boolean;
    /** Size this video was rendered in, so its card keeps the same shape. */
    aspect?: VideoAspect;
  };
};

/** CSS ratio of a card: the size the video was rendered in (portrait when unknown). */
const cardRatio = (v: { meta?: { aspect?: VideoAspect } }) => (v.meta?.aspect ?? "9:16").replace(":", " / ");

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter}`;
}

/**
 * "Videos" tab (AI Influencer) — same design language as Photos: a prompt box,
 * queue as many as you want (each gets its own progress card, no blocking),
 * results land in a grid below. Deliberately has NO engine/style picker of its
 * own — every video is generated through the SAME path the agent's own
 * scheduled runs use (`/api/agents/run-task`, `create_video`), so it always
 * reflects whatever Director has configured (engine, length, camera, color
 * grade, web search, the pinned "My Images" reference, series cast if this
 * agent is a series) and the persona. This tab is just "what happens next,"
 * on demand, in the operator's own words.
 */
export function VideosTab({ mintAddress, agentName, characterImages }: { mintAddress?: string; agentName?: string; characterImages?: { url: string; label: string }[] }) {
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);

  // Director tab's standing engine pick — the dropdown here defaults to it, but
  // can be overridden per-generation without touching the saved config. Also
  // carries the profile photos (avatar + mint stills) for the reference picker.
  const influencerDoc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoEngine?: string; videoMinSeconds?: number; videoMaxSeconds?: number; avatarUrl?: string; avatarStills?: string[]; videoConfig?: { pinnedVideoReferenceUrl?: string; aspectRatio?: string } }
    | null
    | undefined;

  // Past Photos-tab generations — same server history the Photos tab shows, so
  // any of those images can be picked as this video's face reference.
  const imageHistory = useQuery(api.carouselImages.listByMint, mintAddress ? { mintAddress } : "skip") as
    | { _id: string; imageUrl: string }[]
    | undefined;

  const storageKey = useMemo(() => `vello.videos.${mintAddress || "draft"}`, [mintAddress]);
  const [videos, setVideos] = useState<VideoAsset[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as VideoAsset[]) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try {
      // A "pending" card can't resume across a reload (its taskId can, but we
      // don't want a stale spinner if the tab was closed mid-render) — keep only
      // settled results, same rule Photos uses.
      const settled = videos.filter((v) => !v.status);
      window.localStorage.setItem(storageKey, JSON.stringify(settled));
    } catch { /* quota, ignore */ }
  }, [videos, storageKey]);

  // Every finished video is saved to the agent (R2), not just this browser.
  useAgentLibrary("video", mintAddress, videos, setVideos);

  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<VideoAsset | null>(null);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [engineOverride, setEngineOverride] = useState<VideoEngineId | null>(null);
  const [skipStoryboard, setSkipStoryboard] = useState(false);
  const [aspectOverride, setAspectOverride] = useState<VideoAspect | null>(null);
  // "No Persona": the prompt is sent as-is — no persona voice, character bible,
  // skills, memories or standing orders blended into the script or clip prompts.
  const [noPersona, setNoPersona] = useState(false);
  const engineId = engineOverride ?? (influencerDoc?.videoEngine as VideoEngineId | undefined) ?? DEFAULT_VIDEO_ENGINE;
  // Quality and length for THIS video. Each engine sells its own set (Kie's price table), and the price is exact for
  // the pair picked, so the quote on the button is what the render is billed.
  const pricingSpec = KIE_VIDEO_PRICING[engineId];
  // Size for THIS video: the pick here, else the Director tab's saved size, limited to what the engine can render.
  const aspect = aspectFor(engineId, aspectOverride ?? influencerDoc?.videoConfig?.aspectRatio);
  const [qualityOverride, setQualityOverride] = useState<VideoQuality | null>(null);
  const [secondsOverride, setSecondsOverride] = useState<number | null>(null);
  const quality: VideoQuality = qualityOverride && pricingSpec?.qualities.includes(qualityOverride) ? qualityOverride : (pricingSpec?.defaultQuality ?? "720p");
  const seconds = useMemo(() => {
    const options = videoLengthOptions(engineId);
    if (secondsOverride && options.includes(secondsOverride)) return secondsOverride;
    const range = resolveDurationRange(influencerDoc?.videoMinSeconds, influencerDoc?.videoMaxSeconds);
    return options.find((d) => d >= range.min) ?? options[0] ?? range.min;
  }, [engineId, secondsOverride, influencerDoc?.videoMinSeconds, influencerDoc?.videoMaxSeconds]);
  // Provider price plus 15%, plus the storyboard image unless it is skipped. The server bills the same numbers.
  const priceUsd = useMemo(() => {
    const engine = getVideoEngine(engineId);
    return (skipStoryboard ? 0 : VIDEO_STORYBOARD_COST_USDC) + videoCostForLength(engine, seconds, quality);
  }, [engineId, seconds, quality, skipStoryboard]);
  const priceText = formatRetailUsd(priceUsd);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadReferenceImage = useCallback(async (file: File) => {
    setUploadingImage(true);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
      if (publicUrl) setAttachedImage(publicUrl);
      else setError("Could not store the image.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploadingImage(false);
    }
  }, [generateUploadUrl, resolveStorageUrl]);
  // Clock read ONLY from this ticking effect, never at render time (Date.now()
  // during render is impure/unstable) — render just reads `now`.
  const [now, setNow] = useState(() => Date.now());

  // Tick every second while anything is pending, purely to advance the
  // elapsed-time / stage label — no network cost.
  const hasPending = videos.some((v) => v.status === "pending");
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasPending]);

  // Batch-poll every pending video's real render status in one reactive query.
  const pendingTaskIds = useMemo(
    () => videos.filter((v) => v.status === "pending" && v.taskId).map((v) => v.taskId!),
    [videos],
  );
  const statusMap = useQuery(
    api.agentTasks.generationStatus,
    pendingTaskIds.length > 0 ? { ids: pendingTaskIds } : "skip",
  ) as Record<string, { status: string; videoUrl?: string; posterUrl?: string; error?: string; paid?: boolean }> | undefined;

  useEffect(() => {
    if (!statusMap) return;
    // Subscribing to an external system (the Convex reactive poll) and syncing
    // its updates into local state on change — the pattern's own carve-out.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVideos((prev) => prev.map((v) => {
      if (v.status !== "pending" || !v.taskId) return v;
      const s = statusMap[v.taskId];
      if (!s) return v;
      if (s.status === "succeeded" && s.videoUrl) {
        return { ...v, status: undefined, url: s.videoUrl, posterUrl: s.posterUrl };
      }
      if (s.status === "failed") {
        return { ...v, status: "error", error: s.error || "Render failed" };
      }
      return v; // still pending/running, keep waiting
    }));
  }, [statusMap]);

  // What run-task will ACTUALLY send Kie as the character reference(s), mirrored
  // client-side so the stack next to the engine dropdown never lies:
  //   attached image → ONLY it; else the pinned video ref → ONLY it; else the
  //   profile stills (up to 3) / avatar fallback. Moved above `generate` so it
  //   can be snapshotted into each video's `meta` at generation time.
  // Bible's locked identity refs — sit BELOW an explicit attach/pin in the
  // server's precedence (mirrored here), and surface in the picker below so the
  // operator can deliberately choose one.
  const bibleIdentityRefs = useMemo(() => {
    const bible = normalizeShowBible((influencerDoc as { showBible?: unknown } | null | undefined)?.showBible);
    if (!bible) return [] as string[];
    const r = resolveIdentityRefs(bible);
    return [r.primary, ...r.extras].filter((u): u is string => !!u);
  }, [influencerDoc]);

  const effectiveRefs = useMemo(() => {
    const pinned = influencerDoc?.videoConfig?.pinnedVideoReferenceUrl?.trim() || undefined;
    if (attachedImage) return [attachedImage];
    if (pinned) return [pinned];
    if (bibleIdentityRefs.length) return bibleIdentityRefs.slice(0, 3);
    const stills = Array.from(new Set(
      (influencerDoc?.avatarStills ?? []).filter((u) => /^https?:\/\//i.test(u) && !/\.gif(\?|#|$)/i.test(u)),
    ));
    const fallback = stills.length > 0 ? stills : influencerDoc?.avatarUrl ? [influencerDoc.avatarUrl] : [];
    return fallback.slice(0, 3);
  }, [attachedImage, bibleIdentityRefs, influencerDoc?.videoConfig?.pinnedVideoReferenceUrl, influencerDoc?.avatarStills, influencerDoc?.avatarUrl]);

  const canWrite = Boolean(mintAddress);
  // Guards against a double-click/double-tap firing two independent run-task
  // requests (and therefore two KIE renders) before the first one lands — the
  // button previously had no in-flight state at all. Cleared once the request
  // settles, so "queue another" (a different prompt right after) still works.
  const [isGenerating, setIsGenerating] = useState(false);
  const [cast, setCast] = useState<Mention[]>([]);

  const generate = useCallback(() => {
    if (isGenerating) return;
    const p = prompt.trim();
    if (!p || !canWrite) return;
    const localId = makeId();
    setError(null);
    setIsGenerating(true);
    const meta = { engineId, referenceImages: effectiveRefs, skipStoryboard, noPersona, aspect };
    setVideos((prev) => [{ id: localId, prompt: p, createdAt: Date.now(), status: "pending", startedAt: Date.now(), meta }, ...prev]);

    void (async () => {
      try {
        const res = await fetch("/api/agents/run-task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mintAddress,
            taskType: "create_video",
            title: `Video: ${p.slice(0, 60)}`,
            input: {
              topic: cast.length ? `${p}\n\nTagged agents (extra character references): ${cast.map((c) => `@${c.token}`).join(", ")}.` : p,
              ...(cast.some((c) => !c.self) ? { mentionRefImageUrls: cast.filter((c) => !c.self).map((c) => c.avatarUrl).slice(0, 2), mentionCast: cast.filter((c) => !c.self).map((c) => ({ token: c.token, imageUrl: c.avatarUrl })).slice(0, 5) } : {}),
              ...(attachedImage ? { referenceImageUrl: attachedImage } : {}),
              videoEngine: engineId,
              aspectRatio: aspect,
              durationSeconds: seconds,
              ...(pricingSpec ? { videoResolution: quality } : {}),
              ...(skipStoryboard ? { skipStoryboard: true } : {}),
              ...(noPersona ? { noPersona: true } : {}),
            },
            triggeredBy: "videos_panel",
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; taskId?: string; error?: string; message?: string };
        if (!res.ok || data.error || !data.taskId) {
          const msg = data.message ?? data.error ?? `HTTP ${res.status}`;
          setVideos((prev) => prev.map((v) => (v.id === localId ? { ...v, status: "error", error: msg } : v)));
          return;
        }
        setVideos((prev) => prev.map((v) => (v.id === localId ? { ...v, taskId: data.taskId as Id<"agentTasks"> } : v)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "network error";
        setVideos((prev) => prev.map((v) => (v.id === localId ? { ...v, status: "error", error: msg } : v)));
      } finally {
        setIsGenerating(false);
      }
    })();
    setAttachedImage(null);
  }, [prompt, canWrite, mintAddress, attachedImage, engineId, skipStoryboard, noPersona, isGenerating, effectiveRefs, cast, pricingSpec, quality, seconds, aspect]);

  const removeVideo = useCallback((id: string) => setVideos((prev) => prev.filter((v) => v.id !== id)), []);
  const retryVideo = useCallback((v: VideoAsset) => {
    setPrompt(v.prompt);
    removeVideo(v.id);
  }, [removeVideo]);

  const pendingCount = videos.filter((v) => v.status === "pending").length;

  // Pickable reference images, same sources the Photos tab surfaces: the
  // profile photos saved at profile creation (display avatar + mint stills)
  // first, then every past Photos-tab generation. Clicking one attaches it as
  // this video's face reference (same slot the manual upload fills).
  const pickerImages = useMemo(() => {
    const urls: { url: string; label: string }[] = [];
    const seen = new Set<string>();
    const push = (url: string | undefined, label: string) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push({ url, label });
    };
    for (const c of characterImages ?? []) push(c.url, c.label);
    push(influencerDoc?.avatarUrl, "Profile");
    for (const s of influencerDoc?.avatarStills ?? []) push(s, "Profile");
    // Show-Bible refs (uploaded/generated in the Director bible editor) are
    // selectable here too — tapping one attaches it, which OUTRANKS the
    // bible's automatic pick server-side.
    for (const u of bibleIdentityRefs) push(u, "Show Bible");
    for (const r of imageHistory ?? []) push(r.imageUrl, "Generated");
    return urls;
  }, [characterImages, influencerDoc?.avatarUrl, influencerDoc?.avatarStills, bibleIdentityRefs, imageHistory]);

  return (
    <div className="min-h-full px-8 py-8">
      <div className="mx-auto max-w-[1100px]">
        {/* ── Prompt box ──────────────────────────────────────────────────── */}
        <div className={`mx-auto max-w-[900px] p-5 ${PANEL}`}>
          {attachedImage && (
            <div className="mb-3 flex items-center gap-2">
              <div className="group relative size-14 overflow-hidden rounded-lg border-2 border-white/15">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachedImage} alt="reference" className="size-full object-cover" />
                <button type="button" onClick={() => setAttachedImage(null)} title="Remove reference"
                  className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                  <X className="size-4 text-white" />
                </button>
              </div>
              <span className="text-[10.5px] text-zinc-500">Sent to Kie as the face reference for this video.</span>
            </div>
          )}
          <MentionTextarea
            value={prompt}
            onChange={setPrompt}
            onCast={setCast}
            selfMint={mintAddress}
            selfName={agentName}
            selfImage={influencerDoc?.avatarUrl}
            placeholder="What should this video be about? Type @ to bring in another agent, e.g. reacting to a viral trend in my niche…"
            rows={3}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" disabled={uploadingImage}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReferenceImage(f); e.target.value = ""; }} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingImage}
              title="Attach a reference image, sent to Kie instead of the default face"
              className={`${CHIP} disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0`}>
              {uploadingImage ? <Loader2 className="size-3 animate-spin" /> : <ImagePlus className="size-3" />}
              {uploadingImage ? "Uploading…" : "Image"}
            </button>
            <ChipSelect value={engineId} onChange={(v) => setEngineOverride(v as VideoEngineId)} title="Video engine for this generation, defaults to the Director tab's pick"
              options={visibleEngines().map((e) => ({ value: e.id, label: e.label }))} />
            <ChipSelect value={aspect} onChange={(v) => setAspectOverride(v as VideoAspect)} title="Video size: portrait, landscape or square"
              options={aspectsForEngine(engineId).map((a) => ({ value: a.value, label: a.label }))} />
            {pricingSpec && (
              <ChipSelect value={quality} onChange={(v) => setQualityOverride(v as VideoQuality)} title="Video quality, sets the exact price"
                options={pricingSpec.qualities.map((q) => ({ value: q, label: q === "4k" ? "4K" : q }))} />
            )}
            <ChipSelect value={String(seconds)} onChange={(v) => setSecondsOverride(Number(v))} title="Video length, sets the exact price"
              options={videoLengthOptions(engineId).map((d) => ({ value: String(d), label: `${d}s` }))} />
            <ChipCheck checked={skipStoryboard} onChange={setSkipStoryboard} label="Skip storyboard"
              title="Skip the multi-panel storyboard image, the video renders straight from your selected reference image" />
            <ChipCheck checked={noPersona} onChange={setNoPersona} label="No persona"
              title="Send your prompt as-is: no persona voice, character bible, skills or memories are blended into the video. Unchecked, the video follows the agent's persona and settings." />
            {effectiveRefs.length > 0 && (
              <div
                className="flex items-center gap-1.5"
                title={
                  attachedImage
                    ? "Attached image, sent to Kie as THE reference for this video"
                    : influencerDoc?.videoConfig?.pinnedVideoReferenceUrl?.trim()
                      ? "Pinned video reference, sent to Kie as THE reference"
                      : "No reference selected, the profile photos are sent to Kie"
                }
              >
                <div className="flex -space-x-2.5">
                  {effectiveRefs.map((u) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={u} src={u} alt="Kie reference"
                      className="size-7 rounded-full border-2 border-lime-400/70 object-cover ring-2 ring-[#050506]" />
                  ))}
                </div>
              </div>
            )}
            <PriceButton className="ml-auto" disabled={!canWrite || !prompt.trim() || isGenerating} busy={isGenerating} onClick={generate} priceUsd={null} priceText={priceText} pending={pendingCount}
              title={isGenerating ? "Sending…" : pendingCount > 0 ? "Renders run in the background, queue another anytime" : "Includes the 15% Solcameo fee"} />
          </div>
          {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
        </div>

        {/* ── My Images: pick a saved photo as this video's face reference ── */}
        {pickerImages.length > 0 && (
          <div className="mt-4 mx-auto max-w-[900px]">
            <p className="text-[11px] font-semibold text-zinc-400">My Images</p>
            <p className="text-[10.5px] text-zinc-600">Tap a photo to use it as the face reference for the next video, same as attaching it.</p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {pickerImages.map(({ url, label }) => {
                const selected = attachedImage === url;
                return (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setAttachedImage(selected ? null : url)}
                    title={selected ? "Remove reference" : `Use this ${label.toLowerCase()} photo as the video reference`}
                    className={`relative size-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${selected ? "border-lime-400" : "border-white/10 hover:border-white/30"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={label} className="size-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-px text-[7.5px] font-bold uppercase tracking-wide text-zinc-200">{label}</span>
                    {selected && (
                      <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-lime-500 text-[9px] font-black text-black">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Video grid ──────────────────────────────────────────────────── */}
        <ResultHeading
          className="mt-8"
          title="My Videos"
          description="Everything this agent has generated. Click a video to open it, download it, or use it in a post."
        />
        {videos.length === 0 ? (
          <div className="mt-14 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-white/[0.05]">
              <Wand2 className="size-5 text-zinc-300" />
            </span>
            <p className="mt-4 text-[15px] font-semibold text-white">No videos yet</p>
            <p className="mt-1 text-[12.5px] text-zinc-500">Write a prompt above and generate one.</p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <AnimatePresence initial={false}>
              {videos.map((v) => {
                if (v.status === "pending") {
                  const elapsedSec = Math.max(0, Math.round((now - (v.startedAt ?? v.createdAt)) / 1000));
                  return (
                    <motion.div key={v.id} layout
                      initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      style={{ aspectRatio: cardRatio(v) }}
                      className="relative w-full overflow-hidden rounded-xl border-2 border-white/10"
                    >
                      <CardProgress paid={statusMap?.[v.taskId ?? ""]?.paid === true || elapsedSec >= 25} prompt={v.prompt} elapsed={elapsedSec} />
                    </motion.div>
                  );
                }
                if (v.status === "error") {
                  return (
                    <motion.div key={v.id} layout
                      initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      style={{ aspectRatio: cardRatio(v) }}
                      className="relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-red-500/30 bg-red-500/[0.06] px-4 text-center"
                    >
                      <AlertCircle className="size-5 text-red-400" />
                      <span className="text-[10.5px] leading-snug text-red-300">{v.error ?? "Generation failed"}</span>
                      <div className="mt-1 flex gap-2">
                        <button type="button" onClick={() => retryVideo(v)}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold text-white hover:bg-white/20">
                          <RotateCcw className="size-3" /> Retry
                        </button>
                        <button type="button" onClick={() => removeVideo(v.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 text-[10.5px] font-semibold text-zinc-400 hover:bg-white/10">
                          Dismiss
                        </button>
                      </div>
                    </motion.div>
                  );
                }
                return (
                  <div key={v.id}
                    role={v.url ? "button" : undefined}
                    tabIndex={v.url ? 0 : undefined}
                    onClick={() => v.url && setLightbox(v)}
                    onKeyDown={(e) => { if (v.url && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setLightbox(v); } }}
                    style={{ aspectRatio: cardRatio(v) }}
                    className={`vello-card-pop group relative w-full overflow-hidden rounded-xl border-2 border-white/10 backdrop-blur-xl ${v.url ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/60" : ""}`}>
                    {v.url ? (
                      // No `controls` here — clicking the card opens the modal, where
                      // the real player (with controls) lives. Keeping native controls
                      // on the grid thumbnail fights the card's own click-to-open.
                      // `poster` falls back to the Vello mark so a video with no
                      // captured thumbnail still shows a real image, not a black frame.
                      <video src={v.url} poster={v.posterUrl || "/vellosquare.png"} preload="metadata" playsInline muted className="pointer-events-none size-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.posterUrl || "/vellosquare.png"} alt={v.prompt} className="size-full object-cover" />
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="line-clamp-1 pl-0.5 text-[10px] text-zinc-300">{v.prompt}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        {v.url && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setLightbox(v); }} title="View full size"
                            className="pointer-events-auto rounded p-1 text-white hover:bg-white/20">
                            <Maximize2 className="size-3.5" />
                          </button>
                        )}
                        <button type="button" onClick={(e) => { e.stopPropagation(); removeVideo(v.id); }} title="Remove"
                          className="pointer-events-auto rounded p-1 text-white hover:bg-red-500/40">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {lightbox && (
        <div
          role="button"
          tabIndex={-1}
          onClick={() => setLightbox(null)}
          // block + overflow-y-auto (not a centering flex container) — centering
          // a flex/grid container with overflow clips content above the fold in
          // several browsers once it's taller than the viewport, which is exactly
          // what made "scroll down to see the prompt" not work. A plain scrolling
          // block with the content centered via margin auto scrolls normally no
          // matter how tall the video + details panel end up.
          className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-sm"
        >
          <button type="button" onClick={() => setLightbox(null)} title="Close"
            className="fixed right-5 top-5 z-10 flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X className="size-5" />
          </button>
          <div
            onClick={(e) => e.stopPropagation()}
            className="mx-auto flex w-full max-w-[420px] flex-col items-center gap-4 px-6 py-16"
          >
            <video src={lightbox.url} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-lg object-contain shadow-2xl" />

            {/* ── Generation details, prompt, reference image(s), settings ── */}
            <div className="w-full rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4 text-left">
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Prompt</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-200">{lightbox.prompt}</p>

              {(lightbox.meta?.referenceImages?.length ?? 0) > 0 && (
                <div className="mt-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Reference image{lightbox.meta!.referenceImages.length > 1 ? "s" : ""}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {lightbox.meta!.referenceImages.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={url} src={url} alt="Reference used for this video" className="size-14 rounded-lg border border-white/15 object-cover" />
                    ))}
                  </div>
                </div>
              )}

              {lightbox.meta && (
                <div className="mt-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Settings</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-zinc-300">
                      {visibleEngines().find((e) => e.id === lightbox.meta!.engineId)?.label ?? lightbox.meta.engineId}
                    </span>
                    {lightbox.meta.skipStoryboard && (
                      <span className="rounded-lg border border-lime-400/30 bg-lime-400/10 px-2 py-1 text-[11px] font-semibold text-lime-300">Skip storyboard</span>
                    )}
                    {lightbox.meta.noPersona && (
                      <span className="rounded-lg border border-lime-400/30 bg-lime-400/10 px-2 py-1 text-[11px] font-semibold text-lime-300">No persona</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
