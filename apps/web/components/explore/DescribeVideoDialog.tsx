"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { AlertCircle, ImagePlus, Loader2, RotateCcw, Wand2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentOption } from "./AgentOption";
import { BlurRevealVideo, RenderProgress } from "./RenderProgress";
import { FundAgentDialog } from "@/components/builder/FundAgentDialog";
import { MentionTextarea, type Mention } from "@/components/builder/generate/MentionTextarea";
import { CHIP, ChipCheck, ChipSelect, PANEL, PriceButton } from "@/components/builder/generate/ui";
import { pickableVideoEngine, VIDEO_STORYBOARD_COST_USDC, getVideoEngine, selectableVideoEngines, videoCostForLength, videoLengthOptions, type VideoEngineId } from "@/lib/builder/agentTypes";
import { KIE_VIDEO_PRICING, type VideoQuality } from "@/lib/builder/kieVideoPricing";
import { formatRetailUsd } from "@/lib/pricing/retail";
import { aspectFor, aspectsForEngine, type VideoAspect } from "@/lib/builder/videoAspects";

export type DescribeAgent = { mintAddress: string; name: string; coinTicker?: string; avatarUrl?: string; agentWallet?: string | null; videoEngine?: string };

type Status = Record<string, { status: string; videoUrl?: string; error?: string; paid?: boolean }>;

/** Explore's "Describe your video": pick an influencer, write a prompt, choose engine, quality and length, and render it from the agent's wallet. */
export function DescribeVideoDialog({ open, onOpenChange, agents, defaultMint }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: DescribeAgent[] | undefined;
  defaultMint?: string;
}) {
  const [picked, setPicked] = useState(defaultMint ?? "");
  const mint = picked || defaultMint || agents?.[0]?.mintAddress || "";
  const agent = agents?.find((a) => a.mintAddress === mint);
  const [prompt, setPrompt] = useState("");
  const [cast, setCast] = useState<Mention[]>([]);
  const [engineOverride, setEngineOverride] = useState<VideoEngineId | null>(null);
  const [qualityOverride, setQualityOverride] = useState<VideoQuality | null>(null);
  const [secondsOverride, setSecondsOverride] = useState<number | null>(null);
  // Default to exactly what was typed, at exactly the chosen length: no persona rewrite, no storyboard image.
  const [aspectPick, setAspectPick] = useState<VideoAspect>("9:16");
  const [skipStoryboard, setSkipStoryboard] = useState(true);
  const [noPersona, setNoPersona] = useState(true);
  // A picture to base the video on (a face, a product, a scene). Icon-only upload, stored the same way the builder stores its own.
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [task, setTask] = useState<Id<"agentTasks"> | null>(null);
  const [fundOpen, setFundOpen] = useState(false);
  const [fundWallet, setFundWallet] = useState<string | undefined>();

  const engineId = engineOverride ?? pickableVideoEngine(agent?.videoEngine);
  const pricingSpec = KIE_VIDEO_PRICING[engineId];
  const aspect = aspectFor(engineId, aspectPick);
  const quality: VideoQuality = qualityOverride && pricingSpec?.qualities.includes(qualityOverride) ? qualityOverride : (pricingSpec?.defaultQuality ?? "720p");
  const lengths = videoLengthOptions(engineId);
  const seconds = secondsOverride && lengths.includes(secondsOverride) ? secondsOverride : (lengths[0] ?? 5);
  // Provider price plus the Solcameo fee, plus the storyboard image unless skipped. The server bills the same numbers.
  const priceUsd = useMemo(() => (skipStoryboard ? 0 : VIDEO_STORYBOARD_COST_USDC) + videoCostForLength(getVideoEngine(engineId), seconds, quality), [engineId, seconds, quality, skipStoryboard]);

  const status = useQuery(api.agentTasks.generationStatus, task ? { ids: [task] } : "skip") as Status | undefined;
  const state = task ? status?.[task] : undefined;
  // "Paying" lasts until the payment is on record; a render with no payment record is treated as under way after 25 seconds.
  const waitingOnPayment = !!task && !!state && state.paid !== true && (state.status === "pending" || state.status === "running");
  const [payGaveUp, setPayGaveUp] = useState(false);
  useEffect(() => {
    if (!waitingOnPayment) { setPayGaveUp(false); return; } // eslint-disable-line react-hooks/set-state-in-effect
    const timer = setTimeout(() => setPayGaveUp(true), 25_000);
    return () => clearTimeout(timer);
  }, [waitingOnPayment]);
  const running = starting || (!!task && (!state || state.status === "pending" || state.status === "running"));
  const videoUrl = state?.status === "succeeded" ? state.videoUrl : undefined;
  const failure = error || (state?.status === "failed" ? state.error || "Generation failed" : "");

  async function attachImage(file: File) {
    setUploading(true); setError("");
    try {
      const res = await fetch(await generateUploadUrl({}), { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      const url = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
      if (!url) throw new Error("Could not store the image.");
      setAttached(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  }

  async function generate() {
    const text = prompt.trim();
    if (!text || !mint || running) return;
    setError(""); setTask(null); setStarting(true);
    try {
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: mint,
          taskType: "create_video",
          title: `Video: ${text.slice(0, 60)}`,
          input: {
            topic: cast.length ? `${text}\n\nTagged agents (extra character references): ${cast.map((c) => `@${c.token}`).join(", ")}.` : text,
            ...(cast.some((c) => !c.self) ? { mentionRefImageUrls: cast.filter((c) => !c.self).map((c) => c.avatarUrl).slice(0, 2), mentionCast: cast.filter((c) => !c.self).map((c) => ({ token: c.token, imageUrl: c.avatarUrl })).slice(0, 5) } : {}),
            ...(attached ? { referenceImageUrl: attached } : {}),
            videoEngine: engineId,
            aspectRatio: aspect,
            durationSeconds: seconds,
            ...(pricingSpec ? { videoResolution: quality } : {}),
            ...(skipStoryboard ? { skipStoryboard: true } : {}),
            ...(noPersona ? { noPersona: true } : {}),
            ...(noPersona && skipStoryboard ? { exactOutput: true } : {}),
          },
          triggeredBy: "explore",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string; message?: string; code?: string; agentWallet?: string };
      if (data.code === "needs_funding" || data.error === "insufficient_funds") {
        setFundWallet(data.agentWallet ?? agent?.agentWallet ?? undefined);
        setFundOpen(true);
        throw new Error(`This video needs ${formatRetailUsd(priceUsd)} in ${agent?.name ?? "the agent"}'s wallet. Fund it, then try again.`);
      }
      if (!res.ok || !data.taskId) throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
      setTask(data.taskId as Id<"agentTasks">);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the render");
    } finally {
      setStarting(false);
    }
  }
  const reset = () => { setTask(null); setError(""); };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!starting && !(waitingOnPayment && !payGaveUp)) onOpenChange(next); }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-white/15 bg-[#14161a]/95 p-6 text-white backdrop-blur-2xl sm:max-w-3xl">
          <div>
            <DialogTitle className="text-xl tracking-tight">Describe your video</DialogTitle>
            <DialogDescription className="mt-1 text-zinc-500">Tell your influencer what to film. It renders from the agent&apos;s own wallet, and the price is shown before you generate.</DialogDescription>
          </div>

          {agents === undefined ? (
            <p className="flex items-center gap-2 py-6 text-xs text-zinc-400"><Loader2 className="size-4 animate-spin" /> Loading your influencers…</p>
          ) : !agents.length ? (
            <div className="rounded-[10px] border border-white/10 bg-white/[0.03] p-6 text-center">
              <p className="text-sm text-zinc-300">You need an influencer to make a video.</p>
              <Link href="/create" className="mt-3 inline-flex h-9 items-center rounded-[3px] bg-[#d7ff00] px-4 text-sm font-semibold text-black hover:bg-[#e4ff59]">Create an influencer</Link>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block text-xs font-medium text-zinc-400">
                Influencer
                <Select value={mint} onValueChange={(v) => { setPicked(v ?? ""); setEngineOverride(null); reset(); }}>
                  <SelectTrigger aria-label="Your influencer" className="mt-2 h-14 w-full border-white/10 bg-white/5 px-2.5 text-white">
                    <SelectValue placeholder="Choose an influencer">
                      {(value: string | null) => { const a = agents.find((x) => x.mintAddress === value); return a ? <AgentOption name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /> : "Choose an influencer"; }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} sideOffset={8} className="max-h-[min(22rem,var(--available-height))] border-white/10 bg-[#17191d] p-1.5 text-white">
                    {agents.map((a) => (
                      <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-14 py-1.5 pl-2"><AgentOption name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <div className={`p-5 ${PANEL}`}>
                <MentionTextarea
                  value={prompt}
                  onChange={setPrompt}
                  onCast={setCast}
                  selfMint={mint}
                  selfName={agent?.name}
                  selfImage={agent?.avatarUrl}
                  placeholder="What should this video be about? Type @ to bring in another agent, e.g. reacting to a viral trend in my niche…"
                  rows={4}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" disabled={uploading || running}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachImage(f); e.target.value = ""; }} />
                  {attached ? (
                    <span className="relative inline-flex size-8 shrink-0 overflow-hidden rounded-lg border border-white/15">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the uploaded reference */}
                      <img src={attached} alt="Reference" className="size-full object-cover" />
                      <button type="button" aria-label="Remove image" onClick={() => setAttached(null)} className="absolute inset-0 grid place-items-center bg-black/60 text-white opacity-0 transition-opacity hover:opacity-100"><X className="size-3.5" /></button>
                    </span>
                  ) : (
                    <button type="button" aria-label="Add a reference image" title="Add a reference image" onClick={() => fileRef.current?.click()} disabled={uploading || running}
                      className={`${CHIP} size-8 justify-center !p-0 disabled:opacity-40`}>
                      {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                    </button>
                  )}
                  <ChipSelect value={engineId} onChange={(v) => { setEngineOverride(v as VideoEngineId); setQualityOverride(null); setSecondsOverride(null); }} title="Video engine"
                    options={selectableVideoEngines().map((e) => ({ value: e.id, label: e.label }))} />
                  {pricingSpec && (
                    <ChipSelect value={quality} onChange={(v) => setQualityOverride(v as VideoQuality)} title="Video quality, sets the exact price"
                      options={pricingSpec.qualities.map((q) => ({ value: q, label: q === "4k" ? "4K" : q }))} />
                  )}
                  <ChipSelect value={String(seconds)} onChange={(v) => setSecondsOverride(Number(v))} title="Video length, sets the exact price"
                    options={lengths.map((d) => ({ value: String(d), label: `${d}s` }))} />
                  <ChipSelect value={aspect} onChange={(v) => setAspectPick(v as VideoAspect)} title="Video size: portrait, landscape or square"
                    options={aspectsForEngine(engineId).map((a) => ({ value: a.value, label: a.label }))} />
                  <ChipCheck checked={skipStoryboard} onChange={setSkipStoryboard} label="Skip storyboard" title="Skip the multi-panel storyboard image and render straight from the reference" />
                  <ChipCheck checked={noPersona} onChange={setNoPersona} label="No persona" title="Send your prompt as-is, without the agent's persona and memories" />
                  <PriceButton className="ml-auto" disabled={!prompt.trim() || !mint || running} busy={running} onClick={() => void generate()} priceUsd={null} priceText={formatRetailUsd(priceUsd)}
                    title={running ? "Rendering…" : "Charged from the agent's wallet. Includes the Solcameo fee."} />
                </div>
                {failure && (
                  <p role="alert" className="mt-3 flex items-start gap-2 text-[12px] text-red-300"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{failure}</p>
                )}
              </div>

              {running && !videoUrl && (
                <RenderProgress stage={starting || (waitingOnPayment && !payGaveUp) ? "paying" : "rendering"} amount={formatRetailUsd(priceUsd)} agentName={agent?.name} onClose={() => onOpenChange(false)} />
              )}
              {videoUrl && (
                <div className="space-y-3">
                  <BlurRevealVideo src={videoUrl} className="mx-auto max-w-sm" />
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Link href={`/builder?type=influencer&mint=${encodeURIComponent(mint)}`} className="inline-flex h-9 items-center rounded-[3px] bg-[#d7ff00] px-4 text-sm font-semibold text-black hover:bg-[#e4ff59]">Open in builder</Link>
                    <button type="button" onClick={() => { reset(); setPrompt(""); }} className={`${CHIP} h-9 px-3.5`}><RotateCcw className="size-3.5" /> Describe another</button>
                  </div>
                </div>
              )}
              {!running && !videoUrl && !failure && <p className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Wand2 className="size-3" /> The price is charged from {agent?.name ?? "the agent"}&apos;s wallet when the render starts.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <FundAgentDialog open={fundOpen} onOpenChange={setFundOpen} mintAddress={mint} agentWallet={fundWallet ?? agent?.agentWallet ?? undefined} agentName={agent?.name} suggestedUsdc={+priceUsd.toFixed(2)} />
    </>
  );
}
