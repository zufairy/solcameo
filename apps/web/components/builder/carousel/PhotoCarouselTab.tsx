"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Plus, Upload, Loader2, Send, Trash2, Copy, ChevronUp, ChevronDown,
  GalleryHorizontal, Music, Image as ImageIcon, Sparkles,
} from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { IMAGE_ENGINES, imageRetailPriceUsd } from "@/lib/builder/imageEngines";
import { CHIP, ChipSelect, PANEL, PriceButton, ResultHeading } from "@/components/builder/generate/ui";
import { MentionTextarea, type Mention } from "@/components/builder/generate/MentionTextarea";
import { CarouselIdeationPanel, type Idea } from "./CarouselIdeationPanel";

// Same warm-dark "glass" background used across the builder (Home/Editor/
// Posting) — a near-black base with two soft green glows, not flat cream.

const EASE = [0.16, 1, 0.3, 1] as const;

// The three engines the Photo Carousel Builder offers (drop order = user-facing
// order). Nano Banana 2 Lite is an internal budget tier, not shown here.
const CAROUSEL_ENGINE_IDS = ["gpt-image-2", "nano-banana-2", "nano-banana-pro"] as const;
const carouselEngines = CAROUSEL_ENGINE_IDS
  .map((id) => IMAGE_ENGINES.find((e) => e.id === id))
  .filter((e): e is (typeof IMAGE_ENGINES)[number] => Boolean(e));

// Default to a REFERENCE-ACCEPTING engine so the agent's own stills are always
// fed to KIE (gpt-image-2 ignores image_input, so a default there would render a
// generic face instead of the influencer).
const DEFAULT_ENGINE_ID = carouselEngines.find((e) => e.acceptsReferences)?.id ?? carouselEngines[0]?.id ?? IMAGE_ENGINES[0].id;
const ASPECT_RATIOS = ["9:16", "4:5", "1:1", "16:9"] as const;
const PRIVACY_LEVELS = [
  { id: "PUBLIC_TO_EVERYONE", label: "Public" },
  { id: "FOLLOWER_OF_CREATOR", label: "Followers" },
  { id: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
  { id: "SELF_ONLY", label: "Only me" },
] as const;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50MB each, a carousel photo

type SlideSource = "empty" | "generated" | "uploaded" | "legacy";
type Slide = {
  id: string;
  prompt: string;
  engineId: string;
  aspectRatio: string;
  imageUrl: string;            // durable public URL (KIE persist or Convex storage)
  rowId?: string;              // carouselImages row id (KIE-generated slides only)
  generating: boolean;
  error?: string;
  source: SlideSource;
};

type ImageRow = {
  _id: string;
  prompt: string;
  engineLabel: string;
  imageUrl: string;
  status: "generated" | "posted";
  _creationTime: number;
};

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter}`;
}

const newSlide = (): Slide => ({
  id: makeId(),
  prompt: "",
  engineId: DEFAULT_ENGINE_ID,
  aspectRatio: "9:16",
  imageUrl: "",
  generating: false,
  source: "empty",
});

/**
 * Photo Carousel Builder (clip.carouselbuilder) — the dedicated tab an install
 * unlocks in the clipper workspace.
 *
 * CANVAS MODEL: slides are CARDS on a canvas, each holding one carousel image.
 * A slide is either generated in place with KIE (prompt + model + ratio) or
 * uploaded (a few photos at once). The card order IS the carousel order (first
 * card = cover). The whole canvas is persisted to localStorage so a refresh
 * keeps the slides.
 *
 * POSTING: the ordered slide images go to /api/social/post (photo branch) →
 * uploadPhotos → TikTok /upload_photos. The **Add trending audio** checkbox
 * switches to post_mode=MEDIA_UPLOAD + auto_add_music=true — the carousel lands
 * in the TikTok inbox so the operator picks the trending sound in-app (the API
 * can't choose a trending track itself). Unchecked = DIRECT_POST (instant).
 */
export function PhotoCarouselTab({ mintAddress, sessionId, agentName, avatarUrl }: { mintAddress?: string; sessionId?: string; agentName?: string; avatarUrl?: string }) {
  const reduceMotion = useReducedMotion();
  const { accessToken } = useSupabaseAuth();
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);

  // ── Canvas state (slides = carousel cards), persisted to localStorage ──────
  const storageKey = useMemo(() => `vello.carousel.${mintAddress || sessionId || "draft"}`, [mintAddress, sessionId]);
  const [slides, setSlides] = useState<Slide[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Slide[]) : [];
    } catch { return []; /* ignore corrupt drafts */ }
  });
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(slides)); } catch { /* quota, ignore */ }
  }, [slides, storageKey]);
  const slidesRef = useRef(slides);
  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  // @tagged cameos per slide, attached as extra references when that slide renders.
  const [castMap, setCastMap] = useState<Record<string, Mention[]>>({});
  const castMapRef = useRef(castMap);
  useEffect(() => { castMapRef.current = castMap; }, [castMap]);
  const setSlideCast = useCallback((id: string, cast: Mention[]) => {
    setCastMap((m) => ((m[id] ?? []).map((c) => c.token).join("|") === cast.map((c) => c.token).join("|") ? m : { ...m, [id]: cast }));
  }, []);

  const patchSlide = useCallback((id: string, patch: Partial<Slide>) => {
    setSlides((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  // ── History (KIE generations are recorded to the DB) ───────────────────────
  const history = useQuery(
    mintAddress ? api.carouselImages.listByMint : api.carouselImages.listBySession,
    mintAddress ? { mintAddress } : sessionId ? { sessionId } : "skip",
  ) as ImageRow[] | undefined;
  const rows = useMemo(() => history ?? [], [history]);

  const [genError, setGenError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // ── Ideation step ────────────────────────────────────────────────────────
  // Shown first on an empty canvas; toggled back on via "New idea" once slides
  // exist. Picking a concept pushes its slide prompts in as empty (un-rendered)
  // cards — generation still happens per-slide via the existing KIE flow below.
  const [showIdeation, setShowIdeation] = useState(slides.length === 0);
  const uploadReferenceImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const uploadUrl = await generateUploadUrl({});
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) return null;
      const { storageId } = (await res.json()) as { storageId: string };
      return (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
    } catch {
      return null;
    }
  }, [generateUploadUrl, resolveStorageUrl]);
  const useIdea = useCallback((idea: Idea) => {
    setSlides((prev) => [...prev, ...idea.slides.map((s) => ({ ...newSlide(), prompt: s.prompt }))]);
    setShowIdeation(false);
  }, []);

  // ── Post panel state ───────────────────────────────────────────────────────
  const [postTitle, setPostTitle] = useState("");
  const [postDescription, setPostDescription] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState<string>("PUBLIC_TO_EVERYONE");
  const [disableComment, setDisableComment] = useState(false);
  const [trendingAudio, setTrendingAudio] = useState(false);
  const [postInstagram, setPostInstagram] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<string | null>(null);

  // Pre-mint agents generate under their session key: /api/carousel/generate
  // treats an unknown `username` as a pre-mint agent (ownership check no-ops)
  // and the history rows are keyed by sessionId. Posting still needs a mint.
  const agentKey = mintAddress || sessionId || "";
  const canWrite = Boolean(agentKey && accessToken);
  const headers = useCallback(() => {
    return { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
  }, [accessToken]);

  // ── Canvas ops ─────────────────────────────────────────────────────────────
  const addSlide = useCallback(() => setSlides((prev) => [...prev, newSlide()]), []);
  const removeSlide = useCallback((id: string) => setSlides((prev) => prev.filter((s) => s.id !== id)), []);
  const duplicateSlide = useCallback((id: string) => {
    setSlides((prev) => {
      const s = prev.find((x) => x.id === id);
      if (!s) return prev;
      return [...prev, { ...s, id: makeId(), prompt: s.prompt, generating: false, error: undefined }];
    });
  }, []);
  const moveSlide = useCallback((id: string, dir: -1 | 1) => {
    setSlides((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const generateSlide = useCallback(async (id: string) => {
    const s = slidesRef.current.find((x) => x.id === id);
    if (!s) return;
    const p = s.prompt.trim();
    if (!p || !canWrite) return;
    const cast = castMapRef.current[id] ?? [];
    const tagNote = cast.length ? `\n\nReferences: ${cast.map((c, i) => `@${c.token} is extra reference image ${i + 1}`).join("; ")}.` : "";
    patchSlide(id, { generating: true, error: undefined });
    setGenError(null);
    try {
      const res = await fetch("/api/carousel/generate", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          username: agentKey,
          sessionId: sessionId || mintAddress,
          prompt: `${p}${tagNote}`,
          engineId: s.engineId,
          aspectRatio: s.aspectRatio,
          ...(cast.length ? { extraReferenceImageUrls: cast.map((c) => c.avatarUrl) } : {}),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; imageUrl?: string; rowId?: string };
      if (!res.ok || !j.ok) {
        patchSlide(id, { generating: false, error: j.error ?? `Generation failed (HTTP ${res.status})` });
        return;
      }
      patchSlide(id, { generating: false, imageUrl: j.imageUrl ?? "", rowId: j.rowId, source: "generated" });
    } catch (e) {
      patchSlide(id, { generating: false, error: e instanceof Error ? e.message : "network error" });
    }
  }, [canWrite, headers, agentKey, sessionId, patchSlide]);

  const uploadFiles = useCallback(async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) { setGenError("Pick image files (.jpg/.png/.webp)."); return; }
    const tooBig = imgs.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) { setGenError(`${tooBig.name} is ${(tooBig.size / 1048576).toFixed(0)}MB, keep each under 50MB.`); return; }
    setUploading(true);
    setGenError(null);
    try {
      const added: Slide[] = [];
      for (const file of imgs) {
        const uploadUrl = await generateUploadUrl({});
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error(`upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: string };
        const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
        if (publicUrl) added.push({ ...newSlide(), imageUrl: publicUrl, source: "uploaded" });
      }
      if (added.length) setSlides((prev) => [...prev, ...added]);
      else setGenError("No images could be stored.");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }, [generateUploadUrl, resolveStorageUrl]);

  const addFromHistory = useCallback((r: ImageRow) => {
    setSlides((prev) => [...prev, {
      ...newSlide(),
      prompt: r.prompt,
      imageUrl: r.imageUrl,
      rowId: r._id,
      source: r.status === "posted" ? "legacy" : "generated",
    }]);
  }, []);

  // ── Posting ────────────────────────────────────────────────────────────────
  const postCarousel = useCallback(async () => {
    const imgs = slidesRef.current.filter((s) => s.imageUrl).map((s) => s.imageUrl);
    const rowIds = slidesRef.current.filter((s) => s.rowId).map((s) => s.rowId!) as string[];
    const platforms = ["tiktok", ...(postInstagram ? ["instagram"] : [])];
    if (!mintAddress || imgs.length === 0 || posting) {
      if (imgs.length === 0) setPostMsg("Add at least one image to the canvas first.");
      return;
    }
    setPosting(true);
    setPostMsg(null);
    try {
      const res = await fetch("/api/social/post", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          username: mintAddress,
          platforms,
          type: "photo",
          title: postTitle.trim() || "New photo carousel",
          description: postDescription.trim() || undefined,
          mediaUrls: imgs,
          // Trending audio ⇒ send to the TikTok inbox (MEDIA_UPLOAD) so the
          // operator picks the trending sound in-app; auto_add_music ON.
          // Otherwise DIRECT_POST publishes immediately.
          postMode: trendingAudio ? "MEDIA_UPLOAD" : "DIRECT_POST",
          autoAddMusic: trendingAudio,
          privacyLevel,
          disableComment,
          photoCoverIndex: 0,
          mediaType: "IMAGE",
          carouselImageIds: rowIds,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; posted?: string[]; skipped?: string[]; error?: string };
      if (res.ok && j.ok) {
        const where = (j.posted ?? platforms).join(", ");
        setPostMsg(
          trendingAudio
            ? `✅ Sent ${imgs.length} images to your TikTok inbox (draft)${postInstagram ? ` + ${j.posted?.filter((p) => p !== "tiktok").join(", ") ?? "Instagram"}` : ""}. Open the app to add the trending sound + caption.`
            : `✅ Posted ${imgs.length}-image carousel to ${where}.`,
        );
      } else {
        setPostMsg(`Post failed: ${j.error ?? `HTTP ${res.status}`}`);
      }
    } catch (e) {
      setPostMsg(`Post failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setPosting(false);
    }
  }, [mintAddress, posting, headers, postTitle, postDescription, trendingAudio, postInstagram, privacyLevel, disableComment]);

  const slidesWithImage = slides.filter((s) => s.imageUrl).length;

  if (showIdeation) {
    return (
      <CarouselIdeationPanel
        mintAddress={mintAddress}
        headers={headers}
        onUseIdea={useIdea}
        onSkip={() => setShowIdeation(false)}
        uploadImage={uploadReferenceImage}
      />
    );
  }

  return (
    <div className="min-h-full px-8 py-8">
      <motion.div
        className="mx-auto max-w-[1100px]"
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >

        {/* ── Canvas toolbar ──────────────────────────────────────────────────── */}
        <motion.div
          className="mt-4 flex flex-wrap items-center gap-2.5"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.06 }}
        >
          <button type="button" onClick={() => setShowIdeation(true)} className="inline-flex items-center gap-1.5 rounded-2xl bg-[#D4F53C] px-4 py-2.5 text-sm font-bold text-black shadow-[0_4px_0_0_#9cb524] transition-all hover:-translate-y-px active:translate-y-0.5 active:shadow-[0_2px_0_0_#9cb524]">
            <Sparkles className="size-4 fill-black" /> New idea
          </button>
          <button type="button" onClick={addSlide} className={`${CHIP} px-3.5 py-2 text-[13px]`}>
            <Plus className="size-4" /> Add slide
          </button>
          <label className={`${CHIP} cursor-pointer px-3.5 py-2 text-[13px]`}>
            <Upload className="size-4" />
            {uploading ? "Uploading…" : "Upload images"}
            <input type="file" accept="image/*" multiple className="hidden" disabled={uploading}
              onChange={(e) => { const fs = e.target.files ? Array.from(e.target.files) : []; if (fs.length) void uploadFiles(fs); e.target.value = ""; }} />
          </label>
          <div className="ml-auto text-[12px] text-zinc-500">
            {slidesWithImage} of {slides.length} slide{slides.length === 1 ? "" : "s"} ready
          </div>
        </motion.div>
        <AnimatePresence>
          {genError && (
            <motion.p
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 text-[12px] text-red-400"
            >
              {genError}
            </motion.p>
          )}
        </AnimatePresence>

        {/* ── Canvas: cards ─────────────────────────────────────────────────── */}
        {slides.length === 0 ? (
          <motion.div
            className="mt-5 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center"
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.1 }}
          >
            <GalleryHorizontal className="mx-auto size-8 text-zinc-400" />
            <p className="mt-2 text-sm font-medium text-zinc-400">Your canvas is empty.</p>
            <p className="mt-1 text-[12px] text-zinc-500">Add a slide to write a prompt + generate, or upload a few photos at once.</p>
          </motion.div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {slides.map((s, i) => {
              const engine = carouselEngines.find((e) => e.id === s.engineId);
              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={reduceMotion ? false : { opacity: 0, y: 14, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.4, ease: EASE, delay: Math.min(i, 8) * 0.05 }}
                  whileHover={reduceMotion ? undefined : { y: -3 }}
                  className={`flex flex-col ${PANEL} transition-colors ${s.imageUrl ? "hover:border-white/25" : "hover:border-white/20"}`}>
                  {/* Card header: slide number + actions */}
                  <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
                    <span className="text-[12px] font-bold text-zinc-300">Slide {i + 1}</span>
                    {i === 0 && slidesWithImage > 0 && (
                      <span className="rounded-full bg-lime-500 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white">Cover</span>
                    )}
                    {s.source === "generated" && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-400">KIE</span>}
                    {s.source === "uploaded" && <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">Uploaded</span>}
                    <div className="ml-auto flex items-center gap-0.5 text-zinc-500">
                      <button type="button" title="Move up" onClick={() => moveSlide(s.id, -1)} className="rounded p-1 hover:bg-white/10 hover:text-white" disabled={i === 0}>
                        <ChevronUp className="size-4" />
                      </button>
                      <button type="button" title="Move down" onClick={() => moveSlide(s.id, 1)} className="rounded p-1 hover:bg-white/10 hover:text-white" disabled={i === slides.length - 1}>
                        <ChevronDown className="size-4" />
                      </button>
                      <button type="button" title="Duplicate" onClick={() => duplicateSlide(s.id)} className="rounded p-1 hover:bg-white/10 hover:text-white">
                        <Copy className="size-3.5" />
                      </button>
                      <button type="button" title="Remove" onClick={() => removeSlide(s.id)} className="rounded p-1 transition-colors hover:bg-red-500/10 hover:text-red-400">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="flex aspect-[9/16] items-center justify-center overflow-hidden border-b border-white/10 bg-white/[0.03]">
                    {s.generating ? (
                      <div className="flex flex-col items-center gap-2 px-4 text-center text-zinc-400">
                        <Loader2 className="size-6 animate-spin" />
                        <span className="text-[11px]">Rendering… (30s-3m)</span>
                      </div>
                    ) : s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.imageUrl} alt={s.prompt} className="h-full w-full object-contain" />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 px-4 text-center text-zinc-400">
                        <ImageIcon className="size-6" />
                        <span className="text-[11px]">Empty slide, generate or upload an image.</span>
                      </div>
                    )}
                  </div>

                  {/* Controls */}
                  <div className="space-y-2 p-3">
                    <MentionTextarea
                      value={s.prompt}
                      onChange={(v) => patchSlide(s.id, { prompt: v })}
                      onCast={(c) => setSlideCast(s.id, c)}
                      selfMint={mintAddress}
                      selfName={agentName}
                      selfImage={avatarUrl}
                      placeholder="Prompt. Type @ to bring in another agent, e.g. a flat-lay of skincare products, pastel bg…"
                      rows={3}
                      textClass="text-[13px] leading-[1.5]"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <ChipSelect className="min-w-0 flex-1" value={s.engineId} onChange={(v) => patchSlide(s.id, { engineId: v })} title="Image model"
                        options={carouselEngines.map((e) => ({ value: e.id, label: e.label }))} />
                      <ChipSelect className="w-[84px]" value={s.aspectRatio} onChange={(v) => patchSlide(s.id, { aspectRatio: v })} title="Aspect ratio"
                        options={ASPECT_RATIOS.map((r) => ({ value: r, label: r }))} />
                    </div>
                    <PriceButton className="w-full justify-center" disabled={!canWrite || s.generating || !s.prompt.trim()} busy={s.generating}
                      onClick={() => void generateSlide(s.id)} priceUsd={engine ? imageRetailPriceUsd(engine) : null}
                      label={s.generating ? `Rendering on ${engine?.label ?? "model"}…` : "Generate"} />
                    {engine && (
                      <p className="text-[10.5px] leading-tight text-zinc-500">
                        {engine.blurb}{" "}
                        {engine.acceptsReferences
                          ? "Your agent's stills are sent as reference, the slide keeps the influencer's look."
                          : "No character reference, slides won't match the agent's face."}
                      </p>
                    )}
                    {s.error && <p className="text-[11px] text-red-400">{s.error}</p>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* ── Post panel ─────────────────────────────────────────────────────── */}
        <AnimatePresence>
        {slidesWithImage > 0 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4"
          >
            <div className="flex items-center gap-2">
              <h3 className="font-sans text-[17px] font-semibold text-white">Post carousel</h3>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">{slidesWithImage} image{slidesWithImage === 1 ? "" : "s"} · {slidesWithImage > 0 && slides.length > 1 ? `slides 1-${slides.length}` : ""}</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input value={postTitle} onChange={(e) => setPostTitle(e.target.value)} placeholder="Caption / title"
                className="rounded-xl bg-white/[0.04] backdrop-blur-xl px-3 py-2 text-sm text-white placeholder:text-zinc-400 focus:border-white/10 focus:outline-none" />
              <select value={privacyLevel} onChange={(e) => setPrivacyLevel(e.target.value)}
                className="rounded-xl bg-white/[0.04] backdrop-blur-xl px-3 py-2 text-sm text-white focus:border-white/10 focus:outline-none">
                {PRIVACY_LEVELS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <textarea value={postDescription} onChange={(e) => setPostDescription(e.target.value)} placeholder="Description (optional)" rows={2}
                className="rounded-xl bg-white/[0.04] backdrop-blur-xl px-3 py-2 text-sm text-white placeholder:text-zinc-400 focus:border-white/10 focus:outline-none sm:col-span-2" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-[13px] font-medium transition-colors ${trendingAudio ? "border-lime-400 bg-lime-400/10 text-lime-200" : "border-white/10 bg-white/[0.03] text-zinc-300"}`}>
                <input type="checkbox" checked={trendingAudio} onChange={(e) => setTrendingAudio(e.target.checked)} className="size-4" />
                <Music className="size-4" />
                Add trending audio
              </label>
              <label className="inline-flex items-center gap-2 text-[13px] text-zinc-300">
                <input type="checkbox" checked={disableComment} onChange={(e) => setDisableComment(e.target.checked)} className="size-4" />
                Disable comments
              </label>
              <label className="inline-flex items-center gap-2 text-[13px] text-zinc-300">
                <input type="checkbox" checked={postInstagram} onChange={(e) => setPostInstagram(e.target.checked)} className="size-4" />
                Also post to Instagram
              </label>
            </div>
            {trendingAudio && (
              <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-300">
                Draft mode (MEDIA_UPLOAD): the carousel goes to your TikTok inbox so you can pick the <b>trending sound</b> in-app, TikTok doesn&apos;t allow the caption/settings via the API in draft mode.
              </p>
            )}
            <div className="mt-4 flex items-center gap-3">
              <button type="button" disabled={!canWrite || posting} onClick={() => void postCarousel()}
                className="inline-flex items-center gap-2 rounded-xl bg-lime-500 px-5 py-2.5 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_#4d7c0f] transition-[transform,box-shadow] duration-100 hover:brightness-105 active:translate-y-[3px] active:shadow-[0_1px_0_#4d7c0f] disabled:pointer-events-none disabled:opacity-40 disabled:shadow-[0_4px_0_#4d7c0f]">
                {posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {posting ? "Posting…" : trendingAudio ? "Send to TikTok inbox (add trending audio)" : `Post carousel (${slidesWithImage} images)`}
              </button>
              {postMsg && <span className="text-[13px] text-zinc-400">{postMsg}</span>}
            </div>
          </motion.div>
        )}
        </AnimatePresence>

        {/* ── History gallery (KIE generations saved to the DB) ───────────────── */}
        <div className="mt-6">
          <ResultHeading title="My Carousels" description="Click any past generation to add it back to the canvas." />
          {rows.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center text-sm text-zinc-500">
              No generations yet, generate a slide above and it&apos;s saved here.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {rows.map((r, i) => (
                <motion.button
                  key={r._id}
                  type="button"
                  onClick={() => addFromHistory(r)}
                  title="Click to add to canvas"
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE, delay: Math.min(i, 12) * 0.03 }}
                  whileHover={reduceMotion ? undefined : { y: -3 }}
                  className="group relative overflow-hidden rounded-xl border border-white/10 text-left transition-colors hover:border-white/25">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.imageUrl} alt={r.prompt} className="aspect-[9/16] w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                    <p className="text-[9.5px] leading-tight text-white">{r.engineLabel} · {timeAgo(r._creationTime)}</p>
                  </div>
                  {r.status === "posted" && (
                    <span className="absolute right-1 top-1 rounded-full bg-lime-500 px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wide text-white">Posted</span>
                  )}
                  <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-zinc-900/70 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Sparkles className="size-3" />
                  </span>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
