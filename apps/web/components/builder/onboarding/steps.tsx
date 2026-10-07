"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Loader2, Upload, Check } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { videoCreditsForLength, VIDEO_ENGINES, selectableVideoEngines, HIDDEN_VIDEO_ENGINE_IDS, type VideoEngineOption } from "@/lib/builder/agentTypes";
import { clampWizardDuration, wizardDurationBounds, type VideoFormat } from "@/lib/builder/formatCatalog";
import type { OnboardingDraft } from "@/lib/builder/onboardingDraft";
import { MotionReferencePicker } from "./MotionReferencePicker";
import { WIZARD_FORMATS } from "@/lib/builder/onboardingDraft";

/** Onboarding wizard step components — pure `{ draft, onChange }` panels.
 *  Styling mirrors the builder's dark-glass control surface (see
 *  components/builder/VideoDirectorTab.tsx: GLASS_BG / labelCls / inputCls /
 *  chip classes / Section pattern) so the wizard reads as part of the same
 *  product, not a bolted-on modal. */

export const labelCls = "font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500";
export const inputCls =
  "h-11 w-full rounded-lg border border-white/10 bg-white/[0.05] backdrop-blur-xl px-3.5 text-[13px] text-white outline-none placeholder:text-zinc-500 focus-visible:border-lime-400/50 disabled:cursor-not-allowed disabled:opacity-40";
export const chipIdle = "border border-white/10 bg-white/[0.05] text-zinc-300 hover:bg-white/10";
export const chipActive = "border border-lime-400/60 bg-lime-400/[0.14] text-lime-300";

export interface StepProps {
  draft: OnboardingDraft;
  onChange: (draft: OnboardingDraft) => void;
}

export function Chips({
  options, selected, onToggle, disabled,
}: { options: string[]; selected: string[]; onToggle: (id: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(o)}
            aria-pressed={on}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition-colors active:scale-[0.97] disabled:opacity-40 ${on ? chipActive : chipIdle}`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/* ── Step 1: Premise ──────────────────────────────────────────────────── */

const ARCHETYPES = ["creator", "educator", "entertainer", "analyst", "advocate", "curator"];

export function StepPremise({ draft, onChange }: StepProps) {
  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>What is this agent about?</label>
        <p className="mt-1 text-[12px] text-zinc-500">One line: who it&apos;s for + what it posts.</p>
        <textarea
          rows={3}
          value={draft.premise}
          onChange={(e) => onChange({ ...draft, premise: e.target.value })}
          placeholder="e.g. A crypto-market recap show for retail traders who want the day's moves in under a minute"
          className="mt-2.5 w-full resize-none rounded-lg border border-white/10 bg-white/[0.05] backdrop-blur-xl px-3.5 py-3 text-[13px] text-white outline-none placeholder:text-zinc-500 focus-visible:border-lime-400/50"
        />
      </div>
      <div>
        <label className={labelCls}>Archetype</label>
        <div className="mt-2.5">
          <Chips
            options={ARCHETYPES}
            selected={draft.archetype ? [draft.archetype] : []}
            onToggle={(a) => onChange({ ...draft, archetype: draft.archetype === a ? "" : a })}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Step 2: Formats ──────────────────────────────────────────────────── */

const MAX_FORMATS = 3;

function FormatCard({ format, rank, onClick, disabled }: { format: VideoFormat; rank: number; onClick: () => void; disabled: boolean }) {
  const selected = rank > 0;
  const clip = format.exampleClipUrls[0];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex w-full flex-col overflow-hidden rounded-xl border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        selected ? "border-lime-400/60 bg-lime-400/[0.08]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
      }`}
    >
      {selected && (
        <span className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full bg-lime-400 text-[12px] font-bold text-zinc-950">
          {rank}
        </span>
      )}
      <div className="aspect-square w-full overflow-hidden bg-white/[0.04]">
        {clip ? (
          <video src={clip} muted loop autoPlay playsInline preload="metadata" className="size-full object-cover" />
        ) : (
          <div
            className="size-full"
            style={{ background: "linear-gradient(135deg, rgba(163,230,53,0.18), rgba(20,20,20,0.4))" }}
          />
        )}
      </div>
      <div className="p-3">
        <p className="text-[13px] font-semibold text-white">{format.name}</p>
        <p className="mt-1 text-[11.5px] leading-snug text-zinc-400">{format.blurb}</p>
        <p className="mt-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-zinc-500">
          {format.durationSec.min}-{format.durationSec.max}s
        </p>
      </div>
    </button>
  );
}

/* ── Step 2: Pick the face — the influencer's locked look ─────────────────
   Grid of the agent's minted avatar stills to choose from, plus an upload
   slot for a real photo. The pick is saved as the bible's primary locked
   visualRef (draftToBible), so every render, and Gemini Omni's image
   reference, anchors to this exact image. Optional: skipping keeps the
   minted avatar as the fallback reference. */
export function StepModel({ draft, onChange, mintAddress }: StepProps & { mintAddress: string }) {
  const agent = useQuery(api.influencers.getByMint, mintAddress ? { mintAddress } : "skip") as
    | { avatarStills?: string[]; avatarUrl?: string }
    | null
    | undefined;
  // The draft carries the REAL photos the user uploaded during avatar
  // generation (hosted likeness references) — first-class face options here.
  const nftDraft = useQuery(api.nftAgents.getDraftByMint, mintAddress ? { mintAddress } : "skip") as
    | { referencePhotoUrls?: string[]; avatarUrls?: string[] }
    | null
    | undefined;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isStill = (u: string) => /^https?:\/\//i.test(u) && !/\.gif(\?|#|$)/i.test(u);
  const userPhotos = Array.from(new Set((nftDraft?.referencePhotoUrls ?? []).filter(isStill)));
  const stills = Array.from(new Set([
    ...((agent?.avatarStills ?? []).filter(isStill)),
    ...((nftDraft?.avatarUrls ?? []).filter(isStill)),
    ...(agent?.avatarUrl && isStill(agent.avatarUrl) ? [agent.avatarUrl] : []),
  ])).filter((u) => !userPhotos.includes(u));
  // A one-off wizard upload isn't in either list — keep showing it as a tile.
  const savedSelection = draft.identityImageUrl && isStill(draft.identityImageUrl) && !userPhotos.includes(draft.identityImageUrl) && !stills.includes(draft.identityImageUrl)
    ? [{ url: draft.identityImageUrl, kind: draft.identityImageKind || "ai-sheet" as const }] : [];
  const tiles: { url: string; kind: "real-photo" | "ai-sheet" }[] = [
    ...userPhotos.map((url) => ({ url, kind: "real-photo" as const })),
    ...savedSelection,
    ...stills.map((url) => ({ url, kind: "ai-sheet" as const })),
  ];

  // Generated influencer portrait is the default; saved explicit picks win.
  const defaultUrl = agent?.avatarUrl && isStill(agent.avatarUrl) ? agent.avatarUrl : stills[0] ?? userPhotos[0];
  useEffect(() => {
    if (!draft.identityImageUrl && defaultUrl) {
      onChange({ ...draft, identityImageUrl: defaultUrl, identityImageKind: userPhotos.includes(defaultUrl) ? "real-photo" : "ai-sheet" });
    }
  }, [defaultUrl, draft, onChange, userPhotos]);

  const pick = (url: string, kind: "real-photo" | "ai-sheet") => {
    onChange({ ...draft, identityImageUrl: url, identityImageKind: kind });
  };

  const onFile = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Couldn't read the file"));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/upload-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64 }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`);
      onChange({ ...draft, identityImageUrl: data.url, identityImageKind: "real-photo" });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-zinc-500">
        This exact image becomes the face reference for every video, the render keeps the person, the room, and the light as they are in the photo. Skip to keep the minted avatar.
      </p>

      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
        {tiles.map(({ url, kind }) => {
          const on = draft.identityImageUrl === url;
          return (
            <button
              key={url}
              type="button"
              onClick={() => pick(url, kind)}
              aria-pressed={on}
              className={`group relative aspect-[9/16] overflow-hidden rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-lime-400/70 ${
                on ? "border-lime-400/80" : "border-white/10 hover:border-white/30"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" loading="lazy" className="size-full object-cover" />
              {on && (
                <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-lime-400 text-black">
                  <Check className="size-3.5" />
                </span>
              )}
              {kind === "real-photo" && (
                <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/80">
                  Your photo
                </span>
              )}
            </button>
          );
        })}

        {/* Upload slot */}
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="flex aspect-[9/16] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 text-zinc-400 outline-none transition-colors hover:border-lime-400/50 hover:text-lime-300 focus-visible:ring-2 focus-visible:ring-lime-400/70 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
          <span className="text-[11px] font-medium">{uploading ? "Uploading…" : "Upload photo"}</span>
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
      />

      {uploadError && <p className="text-[12px] text-red-400">{uploadError}</p>}
      {agent === undefined && <p className="text-[12px] text-zinc-500">Loading your avatars…</p>}
    </div>
  );
}

/** Suggested engine for the current selection — the top-ranked format's own
 *  preferred engine. Shown as the dropdown's default and its "(suggested)"
 *  row; the operator can still pick any engine. */
export function suggestedEngine(draft: OnboardingDraft): VideoEngineOption | null {
  for (const id of draft.formats) {
    const f = WIZARD_FORMATS.find((x) => x.id === id);
    if (!f) continue;
    const e = engineForFormat(f);
    if (e) return e;
  }
  return null;
}

/** The engine the wizard is effectively rendering with: the explicit pick,
 *  else the suggestion. */
export function effectiveEngine(draft: OnboardingDraft): VideoEngineOption | null {
  if (draft.engine) {
    const e = VIDEO_ENGINES.find((x) => x.id === draft.engine);
    if (e) return e;
  }
  return suggestedEngine(draft);
}

export function StepFormats({ draft, onChange }: StepProps) {
  const toggle = (id: string) => {
    const already = draft.formats.includes(id);
    if (already) {
      onChange({ ...draft, formats: draft.formats.filter((f) => f !== id) });
      return;
    }
    if (draft.formats.length >= MAX_FORMATS) return;
    onChange({ ...draft, formats: [...draft.formats, id] });
  };

  return (
    <div>
      <p className="mb-4 text-[12px] text-zinc-500">Pick up to {MAX_FORMATS} formats, this drives everything the agent produces.</p>
      {/* All formats visible at once: 6-across grid of real sample renders (9:16). */}
      <div className="grid grid-cols-3 gap-3 pb-2 sm:grid-cols-6">
        {WIZARD_FORMATS.map((f) => (
          <FormatCard
            key={f.id}
            format={f}
            rank={draft.formats.indexOf(f.id) + 1}
            onClick={() => toggle(f.id)}
            disabled={!draft.formats.includes(f.id) && draft.formats.length >= MAX_FORMATS}
          />
        ))}
      </div>

    </div>
  );
}

/** Output settings (video model + aspect ratio) — lives with the length sliders because the
    engine sets their bounds and the credit estimate. */
function OutputSettings({ draft, onChange }: StepProps) {
  const suggested = suggestedEngine(draft);
  return (
    <>
      {/* Video model + Aspect ratio — same row: both are per-project render
          settings (not per-format), so they read as one "output" group. */}
      <div className="grid grid-cols-1 gap-5 rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl sm:grid-cols-2">
        {/* Engine picker, defaults to the suggested engine for the top-ranked
            format, but any engine can be chosen; it drives Step 3's length
            bounds and the cost preview. */}
        <div>
          <label className={labelCls} htmlFor="wizard-engine">Video model</label>
          {draft.formats.includes("motion-swap") && <p className="mt-1 text-[11.5px] text-zinc-500">Motion Swap always renders on <span className="font-semibold text-lime-300">Genjutsu</span>; this model applies to your other formats.</p>}
          {suggested && (
            <p className="mt-1 text-[11.5px] text-zinc-500">
              Suggested for your picks: <span className="font-semibold text-lime-300">{suggested.label}</span> · {Math.round(suggested.pricePerMaxClipUsdc * 100)} credits per {suggested.maxClipSeconds}s segment
            </p>
          )}
          <select
            id="wizard-engine"
            value={draft.engine}
            onChange={(e) => onChange({ ...draft, engine: e.target.value })}
            className={`${inputCls} mt-2 cursor-pointer appearance-none [&>option]:bg-zinc-900`}
          >
            <option value="">{suggested ? `Auto, ${suggested.label} (suggested)` : "Auto, pick per format"}</option>
            {selectableVideoEngines().map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}{suggested?.id === e.id ? " (suggested)" : ""}, {Math.round(e.pricePerMaxClipUsdc * 100)} credits / {e.maxClipSeconds}s
              </option>
            ))}
          </select>
        </div>

        {/* Portrait vs landscape — mirrors VideoDirectorTab's ASPECT_OPTIONS
            picker so both Director UIs stay consistent and write the same
            videoConfig.aspectRatio field. */}
        <div>
          <label className={labelCls}>Aspect ratio</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                { id: "9:16" as const, label: "9:16", sub: "Portrait" },
                { id: "16:9" as const, label: "16:9", sub: "Landscape" },
              ]
            ).map((o) => {
              const on = draft.aspectRatio === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onChange({ ...draft, aspectRatio: o.id })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl px-3 py-3 text-center transition-colors ${on ? chipActive : chipIdle}`}
                >
                  <span
                    className={`rounded-[3px] border ${on ? "border-lime-300/70 bg-lime-300/10" : "border-zinc-500/60 bg-white/[0.03]"}`}
                    style={o.id === "9:16" ? { width: 18, height: 30 } : { width: 30, height: 18 }}
                  />
                  <span className="text-[12px] font-semibold">{o.label}</span>
                  <span className="text-[10.5px] text-zinc-500">{o.sub}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Step 3: Tunables ─────────────────────────────────────────────────── */

/** Resolve a format's preferred engine for the cost preview. formatCatalog's
 *  `engines` values should be canonical VIDEO_ENGINES ids, but tolerate
 *  legacy/kieModel-style slugs (underscore vs dash) defensively — try every
 *  entry in order, first resolvable wins. If NONE resolve, return null
 *  rather than guessing a default engine's price: an unpriced format should
 *  show no cost line, never a wrong-but-plausible-looking one. */
function engineForFormat(format: VideoFormat): VideoEngineOption | null {
  for (const raw of format.engines) {
    const norm = raw.replace(/_/g, "-");
    const byId = VIDEO_ENGINES.find((e) => e.id === raw || e.id === norm);
    // Never SUGGEST an engine that's hidden from the dropdown (Veo/Kling) —
    // the suggestion must always be pickable.
    if (byId && !HIDDEN_VIDEO_ENGINE_IDS.includes(byId.id)) return byId;
    const byModel = VIDEO_ENGINES.find((e) => e.kieModel === raw || e.kieModel.replace(/_/g, "-") === norm);
    if (byModel && !HIDDEN_VIDEO_ENGINE_IDS.includes(byModel.id)) return byModel;
  }
  return null; // e.g. documentary (no engines yet) or an unresolvable slug
}

/** Apple-style length slider: a filled lime track with a large white thumb, a
 *  value bubble that rides the thumb and springs on change, and smooth width
 *  animation on the fill. Native <input type=range> underneath for a11y. */
function LengthSlider({
  min, max, step, value, label, onValue,
}: { min: number; max: number; step: number; value: number; label: string; onValue: (v: number) => void }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="relative pt-7">
      {/* Value bubble riding the thumb */}
      <div
        className="pointer-events-none absolute top-0 -translate-x-1/2 transition-[left] duration-150 ease-out"
        style={{ left: `calc(${pct}% )` }}
      >
        <span
          key={value}
          className="inline-block rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums text-black shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
          style={{ animation: "wizBubblePop 0.18s ease-out" }}
        >
          {value}s
        </span>
      </div>
      <style>{`
        @keyframes wizBubblePop { 0% { transform: scale(0.85); } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
      `}</style>
      <div className="relative h-7">
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-lime-500 to-lime-300 transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Thumb */}
        <div
          className="pointer-events-none absolute top-1/2 size-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.45),inset_0_-1px_2px_rgba(0,0,0,0.12)] transition-[left] duration-150 ease-out"
          style={{ left: `${pct}%` }}
        />
        {/* Native input on top — invisible, drives everything, keyboard-friendly */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onValue(Number(e.target.value))}
          aria-label={label}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-medium tabular-nums text-zinc-600">
        <span>{min}s</span>
        <span>{max}s</span>
      </div>
    </div>
  );
}

/** Formats whose render actually leads with a rendered art-style keyframe
 *  (Seedance "storyboard" lead, see kie-video-pipeline.ts's seedanceStoryboardLead
 *  + run-task/route.ts's seedanceLead wiring) — an uploaded style board
 *  directly anchors what that keyframe looks like, unlike realistic
 *  on-camera formats which anchor to the operator's own face instead. */
const STYLE_REF_FORMATS = new Set(["cartoon", "anime"]);

export function StepTunables({ draft, onChange }: StepProps) {
  const selected = draft.formats.map((id) => WIZARD_FORMATS.find((f) => f.id === id)).filter((f): f is VideoFormat => !!f);
  const [styleUploading, setStyleUploading] = useState(false);
  const [styleUploadError, setStyleUploadError] = useState<string | null>(null);
  const styleFileRef = useRef<HTMLInputElement>(null);

  const onStyleFile = async (file: File) => {
    setStyleUploadError(null);
    setStyleUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Couldn't read the file"));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/upload-ref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64 }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? `Upload failed (${res.status})`);
      onChange({ ...draft, styleReferenceUrl: data.url });
    } catch (e) {
      setStyleUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setStyleUploading(false);
      if (styleFileRef.current) styleFileRef.current.value = "";
    }
  };

  if (selected.length === 0) {
    return <p className="text-[13px] text-zinc-500">Go back and pick a format first.</p>;
  }

  return (
    <div className="space-y-4">
      <OutputSettings draft={draft} onChange={onChange} />
      {selected.map((format) => {
        // Engine-aware bounds: Grok slides from 5s (cheap test renders),
        // Gemini Omni from 10s; everything caps at 30s.
        const engine = effectiveEngine(draft) ?? engineForFormat(format);
        const { min, max, step } = wizardDurationBounds(format, engine?.id);
        const seconds = clampWizardDuration(format.id, engine?.id, draft.perFormatDuration[format.id]);
        const cost = engine ? videoCreditsForLength(engine, seconds) : null;

        return (
          <div key={format.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl">
            <div className="flex items-baseline justify-between">
              <p className="text-[14px] font-semibold tracking-tight text-white">{format.name}</p>
              {cost !== null && (
                <span className="text-[11px] font-medium tabular-nums text-zinc-500">{cost.toLocaleString()} credits/video</span>
              )}
            </div>

            <div className="mt-3">
              <LengthSlider
                min={min}
                max={max}
                step={step}
                value={seconds}
                label={`${format.name} length`}
                onValue={(v) =>
                  onChange({
                    ...draft,
                    perFormatDuration: { ...draft.perFormatDuration, [format.id]: clampWizardDuration(format.id, engine?.id, v) },
                  })
                }
              />
            </div>

            {format.id === "motion-swap" && (
              <div className="mt-4 border-t border-white/[0.06] pt-4">
                <p className="text-[12px] font-medium text-zinc-400">Pick the move <span className="font-normal text-zinc-600">· renders on Genjutsu automatically</span></p>
                <p className="mb-3 mt-0.5 text-[11px] text-zinc-600">Your character performs this clip's motion. Browse the same Higgsfield library as Explore.</p>
                <MotionReferencePicker
                  value={draft.tunables[format.id]?.reference ?? ""}
                  onPick={(r) => onChange({ ...draft, tunables: { ...draft.tunables, [format.id]: { ...draft.tunables[format.id], reference: r.videoUrl, referenceTitle: r.title } } })}
                />
              </div>
            )}

            {format.tunables.length > 0 && (
              <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
                {format.tunables.map((t) => {
                  const current = draft.tunables[format.id]?.[t.key] ?? "";
                  return (
                    <div key={t.key} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-zinc-400">{t.label}</span>
                      {/* Packed segmented control — one connected pill group,
                          the active segment slides in as a solid white chip. */}
                      <div className="flex overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
                        {t.options.map((v) => {
                          const on = current === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                onChange({
                                  ...draft,
                                  tunables: {
                                    ...draft.tunables,
                                    [format.id]: { ...draft.tunables[format.id], [t.key]: on ? "" : v },
                                  },
                                })
                              }
                              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-all duration-150 active:scale-[0.96] ${
                                on ? "bg-white text-black shadow-sm" : "text-zinc-400 hover:text-white"
                              }`}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Art-style reference (Cartoon/Anime only) — a style board the
                render anchors its opening keyframe to, distinct from the
                Step 2 face upload. Optional: unset renders from text
                description alone (visualWorld.style + this format's
                tunable choices above). */}
            {STYLE_REF_FORMATS.has(format.id) && (
              <div className="mt-4 border-t border-white/[0.06] pt-4">
                <p className="text-[12px] font-medium text-zinc-400">Art style reference <span className="font-normal text-zinc-600">(optional)</span></p>
                <p className="mt-0.5 text-[11px] text-zinc-600">Upload an image showing the exact art style you want — every {format.name.toLowerCase()} render anchors its look to it.</p>
                <div className="mt-2 flex items-center gap-3">
                  {draft.styleReferenceUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.styleReferenceUrl} alt="Style reference" className="size-14 shrink-0 rounded-lg border border-white/10 object-cover" />
                  )}
                  <button
                    type="button"
                    disabled={styleUploading}
                    onClick={() => styleFileRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-2 text-[11.5px] font-medium text-zinc-400 transition-colors hover:border-lime-400/50 hover:text-lime-300 disabled:opacity-50"
                  >
                    {styleUploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                    {draft.styleReferenceUrl ? "Replace image" : "Upload image"}
                  </button>
                  {draft.styleReferenceUrl && !styleUploading && (
                    <button
                      type="button"
                      onClick={() => onChange({ ...draft, styleReferenceUrl: "" })}
                      className="text-[11px] font-medium text-zinc-500 hover:text-red-300"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  ref={styleFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onStyleFile(f); }}
                />
                {styleUploadError && <p className="mt-1 text-[11px] text-red-400">{styleUploadError}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Step 4: Voice ────────────────────────────────────────────────────── */

const TONES = ["casual", "professional", "hype", "deadpan", "heartfelt"];
const LANGUAGES = ["English", "Malay", "Manglish", "Indonesian"];
const ENERGIES = ["chill", "medium", "high"];

export function StepVoice({ draft, onChange }: StepProps) {
  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Tone</label>
        <div className="mt-2.5">
          <Chips options={TONES} selected={draft.tone ? [draft.tone] : []} onToggle={(t) => onChange({ ...draft, tone: draft.tone === t ? "" : t })} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Language</label>
        <input
          value={draft.language}
          onChange={(e) => onChange({ ...draft, language: e.target.value })}
          placeholder="English"
          className={`${inputCls} mt-2`}
        />
        <div className="mt-2">
          <Chips options={LANGUAGES} selected={draft.language ? [draft.language] : []} onToggle={(l) => onChange({ ...draft, language: l })} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Energy</label>
        <div className="mt-2.5">
          <Chips options={ENERGIES} selected={draft.energy ? [draft.energy] : []} onToggle={(en) => onChange({ ...draft, energy: draft.energy === en ? "" : en })} />
        </div>
      </div>
    </div>
  );
}

/* ── Step 5: Cadence ──────────────────────────────────────────────────── */

export function StepCadence({ draft, onChange }: StepProps) {
  const selected = draft.formats.map((id) => WIZARD_FORMATS.find((f) => f.id === id)).filter((f): f is VideoFormat => !!f);
  const perVideoCosts = selected
    .map((format) => {
      const engine = effectiveEngine(draft) ?? engineForFormat(format);
      if (!engine) return null;
      const seconds = clampWizardDuration(format.id, engine.id, draft.perFormatDuration[format.id]);
      return videoCreditsForLength(engine, seconds);
    })
    .filter((c): c is number => c !== null);
  const meanCost = perVideoCosts.length > 0 ? perVideoCosts.reduce((a, b) => a + b, 0) / perVideoCosts.length : 0;
  const perDay = draft.postsPerDay * meanCost;
  const perMonth = perDay * 30;

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className={labelCls}>Posts / day</label>
        <span className="text-[12px] font-bold tabular-nums text-white">{draft.postsPerDay}</span>
      </div>
      <input
        type="range"
        min={1}
        max={6}
        step={1}
        value={draft.postsPerDay}
        onChange={(e) => onChange({ ...draft, postsPerDay: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })}
        className="mt-2.5 w-full cursor-pointer accent-lime-500"
        aria-label="Posts per day"
      />
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.1em] text-zinc-600">
        <span>1/day</span>
        <span>6/day</span>
      </div>

      {meanCost > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Per day</p>
            <p className="mt-1 font-mono text-[17px] font-bold tabular-nums leading-none text-white">{Math.ceil(perDay).toLocaleString()} credits</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Per month</p>
            <p className="mt-1 font-mono text-[17px] font-bold tabular-nums leading-none text-white">{Math.ceil(perMonth).toLocaleString()} credits</p>
          </div>
        </div>
      )}
    </div>
  );
}
