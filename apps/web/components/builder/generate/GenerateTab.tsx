"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { normalizeShowBible } from "@/lib/builder/showBible";
import {
  Upload, ImagePlus, Loader2, X, Download, Trash2, Plus, Check, Maximize2, RotateCcw, AlertCircle, Clapperboard,
} from "lucide-react";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { IMAGE_ENGINES, IMAGE_TO_IMAGE_REROUTE_IDS, imageRetailPriceUsd } from "@/lib/builder/imageEngines";
import { CHIP, ChipSelect, PANEL, PriceButton } from "./ui";
import { MentionTextarea, type Mention } from "./MentionTextarea";

import { useAgentLibrary } from "@/components/builder/useAgentLibrary";


// The engines offered on this tab.
const GENERATE_ENGINE_IDS = ["nano-banana-pro", "nano-banana-2", "gpt-image-2", "qwen-image-3"] as const;
const generateEngines = GENERATE_ENGINE_IDS
  .map((id) => IMAGE_ENGINES.find((e) => e.id === id))
  .filter((e): e is (typeof IMAGE_ENGINES)[number] => Boolean(e));
// Nano Banana Pro by default — best character-consistency + text rendering of
// the set, and the one every attached reference "just works" on (no reroute).
const DEFAULT_ENGINE_ID = generateEngines.find((e) => e.id === "nano-banana-pro")?.id
  ?? generateEngines.find((e) => e.acceptsReferences)?.id ?? generateEngines[0]?.id ?? IMAGE_ENGINES[0].id;

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_REFS = 4;
const DRAG_MIME = "application/x-vello-asset-id";

type Asset = {
  id: string;
  /** Empty while a generation is in flight — see `status`. */
  url: string;
  source: "uploaded" | "generated";
  prompt?: string;
  engineLabel?: string;
  createdAt: number;
  /** "pending" = card is showing the loading shimmer; "error" = generation
   *  failed (card stays with a retry/dismiss, not silently removed); undefined
   *  (all uploaded/history cards, and generated ones once done) = normal. Each
   *  generate() call gets its OWN pending card, so several can run at once. */
  status?: "pending" | "error";
  error?: string;
};

type HistoryRow = { _id: string; prompt: string; engineLabel: string; imageUrl: string; status: string; _creationTime: number };

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter}`;
}

/**
 * "Generate" tab (AI Influencer) — Google-Flow-style image studio: a prompt box
 * up top (model picker + attached-reference chips inline), a grid of the
 * operator's own uploaded/generated image CARDS below it. Any card can be
 * dragged into the prompt box (or just clicked) to attach it as a KIE
 * `image_input` reference — the point is "take THIS photo, render it in a
 * different style", not just a blind text-to-image box.
 */
export function GenerateTab({ mintAddress, sessionId, avatarUrl, agentName, characterImages }: { mintAddress?: string; sessionId?: string; avatarUrl?: string; agentName?: string; characterImages?: { url: string; label: string }[] }) {
  const { accessToken } = useSupabaseAuth();
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);

  const storageKey = useMemo(() => `vello.generate.${mintAddress || sessionId || "draft"}`, [mintAddress, sessionId]);
  const [assets, setAssets] = useState<Asset[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Asset[]) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try {
      // Never persist an in-flight/failed placeholder — a reload can't resume
      // a fetch, and a "pending" card frozen forever from a stale save is worse
      // than just losing it.
      const settled = assets.filter((a) => !a.status);
      window.localStorage.setItem(storageKey, JSON.stringify(settled));
    } catch { /* quota, ignore */ }
  }, [assets, storageKey]);

  // Every photo this agent makes/uploads is saved to the agent (R2), not just this browser.
  useAgentLibrary("photo", mintAddress, assets, setAssets);

  const history = useQuery(
    mintAddress ? api.carouselImages.listByMint : api.carouselImages.listBySession,
    mintAddress ? { mintAddress } : sessionId ? { sessionId } : "skip",
  ) as HistoryRow[] | undefined;

  // The pinned "use for videos" reference — read live so the badge stays in
  // sync if it's changed from elsewhere (e.g. cleared by the copilot).
  const influencerDoc = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { videoConfig?: { pinnedVideoReferenceUrl?: string }; avatarUrl?: string; avatarStills?: string[]; showBible?: unknown }
    | null
    | undefined;
  const pinnedVideoUrl = influencerDoc?.videoConfig?.pinnedVideoReferenceUrl || undefined;

  // The profile photos saved in the DB at profile creation: the display avatar
  // (prop, falling back to the stored doc) plus the still frames generated at
  // mint (`avatarStills`). All shown as non-removable cards in "My Images".
  const personaImages = useMemo(() => {
    const urls: string[] = [];
    const push = (u?: string) => { if (u && !urls.includes(u)) urls.push(u); };
    push(avatarUrl);
    push(influencerDoc?.avatarUrl);
    for (const s of influencerDoc?.avatarStills ?? []) push(s);
    // Show-Bible visual refs (uploaded/generated in the Director bible editor)
    // appear here too, so the operator can pin one as the video reference.
    {
      const bible = normalizeShowBible(influencerDoc?.showBible);
      for (const r of bible?.visualRefs ?? []) push(r.url);
    }
    return urls;
  }, [avatarUrl, influencerDoc?.avatarUrl, influencerDoc?.avatarStills, influencerDoc?.showBible]);
  // What create_video actually sends as the face reference RIGHT NOW: the pin if
  // set, else the agent's default persona photo — mirrors run-task's own
  // `pinnedRef ?? stills[0] ?? agent.avatarUrl` fallback closely enough to show
  // the operator the true current selection instead of nothing.
  const effectiveVideoRef = pinnedVideoUrl || avatarUrl || undefined;
  const [pinning, setPinning] = useState(false);
  const setVideoReference = useCallback(async (url: string | "") => {
    if (!mintAddress) return;
    setPinning(true);
    try {
      await fetch("/api/agents/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress, kind: "video", payload: { pinnedVideoReferenceUrl: url } }),
      });
    } catch { /* best-effort, the badge just won't update this time */ }
    finally { setPinning(false); }
  }, [mintAddress]);

  const [prompt, setPrompt] = useState("");
  const [engineId, setEngineId] = useState<string>(DEFAULT_ENGINE_ID);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [cast, setCast] = useState<Mention[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const canWrite = Boolean(mintAddress && accessToken);
  const headers = useCallback(
    () => ({ "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }),
    [accessToken],
  );

  const engine = generateEngines.find((e) => e.id === engineId);
  // The Character-tab influencer: selectable faces that attach like any other reference card.
  const characterAssets = useMemo<Asset[]>(
    () => (characterImages ?? []).map((c) => ({ id: `char:${c.url}`, url: c.url, source: "generated" as const, engineLabel: c.label, createdAt: 0 })),
    [characterImages],
  );
  const refs = useMemo(
    () => refIds.map((id) => assets.find((a) => a.id === id) ?? characterAssets.find((a) => a.id === id)).filter((a): a is Asset => Boolean(a)),
    [refIds, assets, characterAssets],
  );
  const pendingCount = useMemo(() => assets.filter((a) => a.status === "pending").length, [assets]);

  // "Select" (the Plus → Check toggle on a card) is the operator's obvious way
  // to say "this is the photo I mean" — it was only wired to attach the image as
  // an image-to-image reference for the NEXT generation, never to the video
  // pipeline, so a selected photo still lost to the default avatar at render
  // time. Selecting now ALSO pins it as the video reference (same call the
  // clapperboard button makes) — deselecting leaves the pin alone (no surprise
  // reset to the default avatar from an unrelated click).
  const toggleRef = useCallback((id: string) => {
    setRefIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_REFS) return prev;
      const asset = assets.find((a) => a.id === id);
      if (asset) void setVideoReference(asset.url);
      return [...prev, id];
    });
  }, [assets, setVideoReference]);

  const uploadFiles = useCallback(async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) { setError("Pick image files (.jpg/.png/.webp)."); return; }
    const tooBig = imgs.find((f) => f.size > MAX_IMAGE_BYTES);
    if (tooBig) { setError(`${tooBig.name} is ${(tooBig.size / 1048576).toFixed(0)}MB, keep each under 50MB.`); return; }
    setUploading(true);
    setError(null);
    try {
      const added: Asset[] = [];
      for (const file of imgs) {
        const uploadUrl = await generateUploadUrl({});
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error(`upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: string };
        const publicUrl = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
        if (publicUrl) added.push({ id: makeId(), url: publicUrl, source: "uploaded", createdAt: Date.now() });
      }
      if (added.length) {
        setAssets((prev) => [...added, ...prev]);
        // A freshly-uploaded photo is always the operator's "use THIS as my
        // persona" photo — pin it, overriding whatever was pinned before, so
        // the very next video render uses it instead of a stale reference.
        void setVideoReference(added[0].url);
      } else {
        setError("No images could be stored.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }, [generateUploadUrl, resolveStorageUrl, setVideoReference]);

  // Fires a generation WITHOUT blocking the prompt box — several can run at
  // once, each owning its own pending card (inserted immediately, patched in
  // place when it resolves), so the operator can queue up a batch instead of
  // waiting on one at a time.
  const generate = useCallback(() => {
    const p = prompt.trim();
    if (!p || !canWrite) return;
    const thisEngine = engineId;
    const thisEngineLabel = generateEngines.find((e) => e.id === thisEngine)?.label;
    const castUrls = cast.map((c) => c.avatarUrl);
    const thisRefs = [...refs.map((r) => r.url), ...castUrls].slice(0, MAX_REFS + 3);
    // Tell the model which reference picture each @tag points at.
    const tagNote = cast.length ? `\n\nReferences: ${cast.map((c, i) => `@${c.token} is reference image ${refs.length + i + 1}`).join("; ")}.` : "";
    const pendingId = makeId();
    setError(null);
    setAssets((prev) => [{ id: pendingId, url: "", source: "generated", prompt: p, engineLabel: thisEngineLabel, createdAt: Date.now(), status: "pending" }, ...prev]);

    void (async () => {
      try {
        const res = await fetch("/api/carousel/generate", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            username: mintAddress,
            sessionId: sessionId || mintAddress,
            prompt: `${p}${tagNote}`,
            engineId: thisEngine,
            referenceImageUrls: thisRefs,
          }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; imageUrl?: string; engineLabel?: string };
        if (!res.ok || !j.ok || !j.imageUrl) {
          const msg = j.error ?? `Generation failed (HTTP ${res.status})`;
          setAssets((prev) => prev.map((a) => (a.id === pendingId ? { ...a, status: "error", error: msg } : a)));
          return;
        }
        setAssets((prev) => prev.map((a) => (a.id === pendingId ? { ...a, url: j.imageUrl!, engineLabel: j.engineLabel ?? a.engineLabel, status: undefined, error: undefined } : a)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "network error";
        setAssets((prev) => prev.map((a) => (a.id === pendingId ? { ...a, status: "error", error: msg } : a)));
      }
    })();
  }, [prompt, canWrite, headers, mintAddress, sessionId, engineId, refs, cast]);

  const removeAsset = useCallback((id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    setRefIds((prev) => prev.filter((x) => x !== id));
  }, []);

  // Failed card → drop it and refill the prompt box so the operator can just
  // hit Generate again (same text, one click) instead of retyping.
  const retryAsset = useCallback((a: Asset) => {
    if (a.prompt) setPrompt(a.prompt);
    removeAsset(a.id);
  }, [removeAsset]);

  const addFromHistory = useCallback((r: HistoryRow) => {
    setAssets((prev) => (prev.some((a) => a.url === r.imageUrl) ? prev : [{ id: makeId(), url: r.imageUrl, source: "generated", prompt: r.prompt, engineLabel: r.engineLabel, createdAt: r._creationTime }, ...prev]));
  }, []);

  // Drop target = the prompt box: dropping a card attaches it as a reference.
  const onDropZone = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData(DRAG_MIME);
    if (id) setRefIds((prev) => (prev.includes(id) || prev.length >= MAX_REFS ? prev : [...prev, id]));
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="min-h-full px-8 py-8">
      <div className="mx-auto max-w-[1100px]">
        {/* ── Prompt box (Google-Flow style: model picker + ref chips inline) ── */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDropZone}
          className={`mt-6 mx-auto max-w-[640px] p-5 transition-colors ${dragOver ? "rounded-[10px] border border-lime-400 bg-lime-400/[0.06]" : PANEL}`}
        >
          {refs.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {refs.map((r) => (
                <div key={r.id} className="group relative size-14 overflow-hidden rounded-lg border-2 border-white/15">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="reference" className="size-full object-cover" />
                  <button type="button" onClick={() => toggleRef(r.id)} title="Remove reference"
                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                    <X className="size-4 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {characterAssets.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Your AI influencer</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {characterAssets.map((c) => {
                  const on = refIds.includes(c.id);
                  return (
                    <button key={c.id} type="button" title={on ? "Remove reference" : "Use this face as the reference"}
                      onClick={() => setRefIds((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : prev.length >= MAX_REFS ? prev : [...prev, c.id]))}
                      className={`relative size-14 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${on ? "border-lime-400" : "border-white/10 hover:border-white/30"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.url} alt={c.engineLabel} className="size-full object-cover" />
                      {on && <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-lime-500 text-[9px] font-black text-black">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <MentionTextarea
            value={prompt}
            onChange={setPrompt}
            onCast={setCast}
            selfMint={mintAddress}
            selfName={agentName}
            selfImage={avatarUrl}
            placeholder={dragOver ? "Drop to attach as a reference…" : "Describe the image. Type @ to bring in another agent, or drag a card below in as a reference…"}
            rows={3}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ChipSelect value={engineId} onChange={setEngineId} title="Image model"
              options={generateEngines.map((e) => ({ value: e.id, label: `${e.label} · $${imageRetailPriceUsd(e).toFixed(3)}` }))} />
            <label className={`${CHIP} cursor-pointer`}>
              {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
              {uploading ? "Uploading…" : "Upload"}
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" disabled={uploading}
                onChange={(e) => { const fs = e.target.files ? Array.from(e.target.files) : []; if (fs.length) void uploadFiles(fs); e.target.value = ""; }} />
            </label>
            {cast.length > 0 && (
              <div className="flex items-center gap-1.5" title="Tagged agents are sent as extra references">
                <div className="flex -space-x-2.5">
                  {cast.map((c) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={c.token} src={c.avatarUrl} alt={c.name} className="size-7 rounded-full border-2 border-lime-400/70 object-cover ring-2 ring-[#08090a]" />
                  ))}
                </div>
              </div>
            )}
            <PriceButton className="ml-auto" disabled={!canWrite || !prompt.trim()} onClick={generate} priceUsd={engine ? imageRetailPriceUsd(engine) : null} pending={pendingCount}
              title={pendingCount > 0 ? "Generations run in the background, queue another anytime" : undefined} />
          </div>
          {engine && refs.length > 0 && (
            <p className="mt-2 text-[10.5px] leading-tight text-zinc-500">
              {`Using ${refs.length} attached reference${refs.length === 1 ? "" : "s"}${IMAGE_TO_IMAGE_REROUTE_IDS.has(engine.id) ? ` (via ${engine.label}'s image-to-image model)` : ""}.`}
            </p>
          )}
          {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
        </div>

        {/* ── Asset grid: every uploaded / generated card, draggable + click-to-attach ── */}
        <div className="mt-6 flex items-center justify-between">
          <div>
            <h3 className="text-[26px] font-black uppercase leading-none tracking-[-0.01em] text-white" style={{ fontFamily: "Anton, 'Bebas Neue', Impact, sans-serif" }}>My Images</h3>
            <p className="text-[11.5px] text-zinc-500">Pin one as the video reference, every future video (manual and the agent&apos;s own scheduled runs) will match its look instead of the default avatar.</p>
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.04] backdrop-blur-xl px-3 py-1.5 text-[12px] font-semibold text-zinc-300 hover:bg-white/10">
            <Plus className="size-3.5" /> Add image
          </button>
        </div>
        {assets.length === 0 && personaImages.length === 0 ? (
          <div className="mt-3 rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
            <ImagePlus className="mx-auto size-8 text-zinc-400" />
            <p className="mt-2 text-sm font-medium text-zinc-400">No images yet.</p>
            <p className="mt-1 text-[12px] text-zinc-500">Upload a photo, or write a prompt above and generate one.</p>
          </div>
        ) : (
          // Masonry (CSS columns, not a grid) — each card keeps its own natural
          // aspect ratio and shows the FULL image (no square crop).
          <div className="mt-3 columns-2 gap-3 sm:columns-3 md:columns-4 lg:columns-5">
            {/* The profile photos saved at profile creation, the display avatar
                first ("Default"), then the mint still frames ("Profile"). Always
                shown, so there is ALWAYS a reference selected (the avatar, until
                something is pinned over it). Not removable/draggable, they're
                not stored assets, just the live persona create_video already uses. */}
            {personaImages.map((pUrl, i) => (
              <div key={pUrl} className={`vello-card-pop group relative mb-3 block w-full overflow-hidden rounded-xl border-2 backdrop-blur-xl transition-colors ${effectiveVideoRef === pUrl ? "border-lime-400" : "border-white/10 hover:border-white/25"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pUrl} alt={i === 0 ? "Default persona photo" : "Profile photo"} onClick={() => setLightbox(pUrl)} className="block w-full cursor-zoom-in" />
                <span className={`absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border ${effectiveVideoRef === pUrl ? "border-lime-400 bg-lime-500 text-white" : "border-white/30 bg-black/50 text-white/80"}`}>
                  {effectiveVideoRef === pUrl ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                </span>
                <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-zinc-200">{i === 0 ? "Default" : "Profile"}</span>
                {effectiveVideoRef === pUrl && (
                  <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-lime-500 px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wide text-black">
                    <Clapperboard className="size-2.5" /> Video ref
                  </span>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button type="button" disabled={pinning || !mintAddress || effectiveVideoRef === pUrl}
                    onClick={() => void setVideoReference(pUrl)}
                    title="Use for videos, every future video (manual + scheduled) matches this photo"
                    className="pointer-events-auto rounded p-1 text-white hover:bg-white/20 disabled:opacity-40">
                    <Clapperboard className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => setLightbox(pUrl)} title="View full size"
                    className="pointer-events-auto rounded p-1 text-white hover:bg-white/20">
                    <Maximize2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <AnimatePresence initial={false}>
              {assets.map((a) => {
                const attached = refIds.includes(a.id) || a.url === effectiveVideoRef;
                if (a.status === "pending") {
                  // Loading card: animated blur/shimmer placeholder, pops in the
                  // instant Generate is clicked — several can be showing at once,
                  // one per in-flight generation.
                  return (
                    <motion.div key={a.id} layout
                      initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="relative mb-3 block aspect-[3/4] w-full overflow-hidden rounded-xl border-2 border-white/10"
                    >
                      <motion.div
                        className="absolute inset-0"
                        style={{ background: "linear-gradient(120deg, rgba(255,255,255,0.03), rgba(190,255,120,0.12), rgba(255,255,255,0.03))", backgroundSize: "200% 200%", filter: "blur(14px)" }}
                        animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                        transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
                      />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/20 px-4 text-center backdrop-blur-sm">
                        <Loader2 className="size-5 animate-spin text-lime-300" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-300">{a.engineLabel ?? "Generating…"}</span>
                        {a.prompt && <span className="line-clamp-2 text-[10px] text-zinc-400">{a.prompt}</span>}
                      </div>
                    </motion.div>
                  );
                }
                if (a.status === "error") {
                  return (
                    <motion.div key={a.id} layout
                      initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      className="relative mb-3 flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-red-500/30 bg-red-500/[0.06] px-4 text-center"
                    >
                      <AlertCircle className="size-5 text-red-400" />
                      <span className="text-[10.5px] leading-snug text-red-300">{a.error ?? "Generation failed"}</span>
                      <div className="mt-1 flex gap-2">
                        <button type="button" onClick={() => retryAsset(a)}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold text-white hover:bg-white/20">
                          <RotateCcw className="size-3" /> Retry
                        </button>
                        <button type="button" onClick={() => removeAsset(a.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 text-[10.5px] font-semibold text-zinc-400 hover:bg-white/10">
                          Dismiss
                        </button>
                      </div>
                    </motion.div>
                  );
                }
                return (
                  <div key={a.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData(DRAG_MIME, a.id); e.dataTransfer.effectAllowed = "copy"; }}
                    title="Drag into the prompt box to use as a reference"
                    className={`vello-card-pop group relative mb-3 block w-full cursor-grab overflow-hidden rounded-xl border-2 backdrop-blur-xl transition-colors active:cursor-grabbing ${attached ? "border-lime-400" : "border-white/10 hover:border-white/25"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt={a.prompt || "uploaded"} onClick={() => setLightbox(a.url)}
                      className="block w-full cursor-zoom-in" />
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggleRef(a.id); }}
                      title={attached ? "Remove reference" : "Use as reference"}
                      className={`absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border transition-colors ${attached ? "border-lime-400 bg-lime-500 text-white" : "border-white/30 bg-black/50 text-white/80 hover:bg-black/70"}`}
                    >
                      {attached ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                    </button>
                    <span className={`absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide ${a.source === "uploaded" ? "bg-sky-400/80 text-white" : "bg-black/60 text-zinc-200"}`}>
                      {a.source === "uploaded" ? "Uploaded" : a.engineLabel ?? "Generated"}
                    </span>
                    {a.url === pinnedVideoUrl && (
                      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-lime-500 px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wide text-black">
                        <Clapperboard className="size-2.5" /> Video ref
                      </span>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button type="button" disabled={pinning || !mintAddress}
                        onClick={(e) => { e.stopPropagation(); void setVideoReference(a.url === pinnedVideoUrl ? "" : a.url); }}
                        title={a.url === pinnedVideoUrl ? "Unpin, future videos go back to the default avatar" : "Use for videos, every future video (manual + scheduled) matches this image"}
                        className={`pointer-events-auto rounded p-1 text-white hover:bg-white/20 disabled:opacity-40 ${a.url === pinnedVideoUrl ? "text-lime-300" : ""}`}>
                        <Clapperboard className="size-3.5" />
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setLightbox(a.url); }} title="View full size"
                        className="pointer-events-auto rounded p-1 text-white hover:bg-white/20">
                        <Maximize2 className="size-3.5" />
                      </button>
                      <a href={a.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open / download"
                        className="pointer-events-auto rounded p-1 text-white hover:bg-white/20">
                        <Download className="size-3.5" />
                      </a>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removeAsset(a.id); }} title="Remove"
                        className="pointer-events-auto rounded p-1 text-white hover:bg-red-500/40">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* ── History (server-recorded generations, click to pull back into the grid) ── */}
        {(history?.length ?? 0) > 0 && (
          <div className="mt-8">
            <h3 className="font-sans text-[15px] font-semibold text-white">History</h3>
            <p className="text-[12px] text-zinc-500">Past generations for this agent. Click a thumbnail to view it, use + to add it back to the grid above.</p>
            <div className="mt-3 columns-3 gap-2.5 sm:columns-5 md:columns-6 lg:columns-8">
              {history!.map((r) => (
                <div key={r._id} className="group relative mb-2.5 block w-full overflow-hidden rounded-lg border-2 border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.imageUrl} alt={r.prompt} onClick={() => setLightbox(r.imageUrl)} className="block w-full cursor-zoom-in" />
                  <button type="button" onClick={() => addFromHistory(r)} title="Add to grid above"
                    className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-zinc-900/70 text-white opacity-0 transition-opacity hover:bg-lime-500 group-hover:opacity-100">
                    <Plus className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Lightbox: click any image to view it full size ── */}
      {lightbox && (
        <div
          role="button"
          tabIndex={-1}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
        >
          <button type="button" onClick={() => setLightbox(null)} title="Close"
            className="absolute right-5 top-5 flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="full size" onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}
