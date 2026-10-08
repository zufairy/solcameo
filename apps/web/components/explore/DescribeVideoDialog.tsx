"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { AlertCircle, Download, ImagePlus, Loader2, RotateCcw, UserRound, Wand2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentOption } from "./AgentOption";
import { BlurRevealVideo, RenderProgress } from "./RenderProgress";
import { FundAgentDialog } from "@/components/builder/FundAgentDialog";
import { AgentPayStatus } from "@/components/builder/AgentPayStatus";
import { MentionTextarea, type Mention } from "@/components/builder/generate/MentionTextarea";
import { CHIP, ChipCheck, ChipSelect, PANEL, PriceButton } from "@/components/builder/generate/ui";
import { pickableVideoEngine, VIDEO_STORYBOARD_COST_USDC, getVideoEngine, selectableVideoEngines, videoCostForLength, videoLengthOptions, type VideoEngineId } from "@/lib/builder/agentTypes";
import { KIE_VIDEO_PRICING, type VideoQuality } from "@/lib/builder/kieVideoPricing";
import { formatRetailUsd } from "@/lib/pricing/retail";
import { aspectFor, aspectsForEngine, type VideoAspect } from "@/lib/builder/videoAspects";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { payAndPost } from "@/lib/client/walletPaid";
import { MAX_REFERENCE_IMAGES } from "@/lib/explore/referenceImages";

/** The "no influencer" choice: the video is paid for straight from the user's own wallet. */
const NONE = "__none__";

export type DescribeAgent = { mintAddress: string; name: string; coinTicker?: string; avatarUrl?: string; agentWallet?: string | null; videoEngine?: string; connectedPlatforms?: string[] };

type Status = Record<string, { status: string; videoUrl?: string; error?: string; paid?: boolean }>;

function NoInfluencerOption() {
  return (
    <span className="flex items-center gap-3">
      <span className="grid size-16 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/[0.06]"><UserRound className="size-5 text-white/70" /></span>
      <span className="min-w-0 text-left"><span className="block text-sm font-semibold">No influencer</span><span className="block text-[11px] text-zinc-500">Pay from your wallet</span></span>
    </span>
  );
}

/** Explore's "Describe your video": pick an influencer, write a prompt, choose engine, quality and length, and render it from the agent's wallet. */
export function DescribeVideoDialog({ open, onOpenChange, agents, defaultMint }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: DescribeAgent[] | undefined;
  defaultMint?: string;
}) {
  const [picked, setPicked] = useState(defaultMint ?? "");
  // Anyone's influencer can be used: yours bill the agent's own wallet, anyone else's is paid for from the viewer's wallet.
  const everyone = useQuery(api.influencers.listSearchable, open ? { liveNetwork: "mainnet" } : "skip");
  const owned = new Set((agents ?? []).map((a) => a.mintAddress));
  const cameo = picked && picked !== NONE && !owned.has(picked) ? (everyone ?? []).find((a) => a.mintAddress === picked) : undefined;
  const noInfluencer = picked === NONE || (agents !== undefined && !agents.length && !cameo);
  /** Paid from the viewer's own wallet: no influencer, or one they do not own. */
  const walletPaid = noInfluencer || !!cameo;
  const mint = noInfluencer || cameo ? "" : picked || defaultMint || agents?.[0]?.mintAddress || "";
  const agent = agents?.find((a) => a.mintAddress === mint);
  const others = (everyone ?? []).filter((a) => !owned.has(a.mintAddress) && a.avatarUrl).slice(0, 300);
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  // Signature of a payment that was sent but not yet applied, so a retry reuses it instead of paying twice.
  const paidSig = useRef<string | undefined>(undefined);
  const [prompt, setPrompt] = useState("");
  const [cast, setCast] = useState<Mention[]>([]);
  const [engineOverride, setEngineOverride] = useState<VideoEngineId | null>(null);
  const [qualityOverride, setQualityOverride] = useState<VideoQuality | null>(null);
  const [secondsOverride, setSecondsOverride] = useState<number | null>(null);
  // Default to exactly what was typed, at exactly the chosen length: no persona rewrite, no storyboard image.
  const [aspectPick, setAspectPick] = useState<VideoAspect>("9:16");
  const [skipStoryboard, setSkipStoryboard] = useState(true);
  const [noPersona, setNoPersona] = useState(true);
  // Posting is a public act, so it is opt-in per video.
  const [postToX, setPostToX] = useState(false);
  const xConnected = !!agent?.connectedPlatforms?.includes("x");
  // Pictures to base the video on (faces, a product, a scene): up to five, all sent to the engine. Stored the same way the builder stores its own.
  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [task, setTask] = useState<Id<"agentTasks"> | null>(null);
  const [payNote, setPayNote] = useState("");
  const [fundOpen, setFundOpen] = useState(false);
  const [fundWallet, setFundWallet] = useState<string | undefined>();

  const engineId = engineOverride ?? pickableVideoEngine(walletPaid ? undefined : agent?.videoEngine);
  const pricingSpec = KIE_VIDEO_PRICING[engineId];
  const aspect = aspectFor(engineId, aspectPick);
  const quality: VideoQuality = qualityOverride && pricingSpec?.qualities.includes(qualityOverride) ? qualityOverride : (pricingSpec?.defaultQuality ?? "720p");
  const lengths = videoLengthOptions(engineId);
  const seconds = secondsOverride && lengths.includes(secondsOverride) ? secondsOverride : (lengths[0] ?? 5);
  // Provider price plus the Solcameo fee, plus the storyboard image unless skipped. The server bills the same numbers.
  const priceUsd = (skipStoryboard || walletPaid ? 0 : VIDEO_STORYBOARD_COST_USDC) + videoCostForLength(getVideoEngine(engineId), seconds, quality);

  const status = useQuery(api.agentTasks.generationStatus, task ? { ids: [task] } : "skip") as Status | undefined;
  const state = task ? status?.[task] : undefined;
  // Keep showing payment until it is recorded. The timer only enables closing the dialog.
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

  /** Upload several pictures at once; each one that stores fine is added, in the order picked, up to the limit. */
  async function attachImages(files: File[]) {
    const room = MAX_REFERENCE_IMAGES - attached.length;
    const picked = files.filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (!picked.length) { if (files.length) setError(room <= 0 ? `You can add up to ${MAX_REFERENCE_IMAGES} images.` : "Choose image files."); return; }
    setUploading(true); setError("");
    const stored = await Promise.all(picked.map(async (file) => {
      try {
        const res = await fetch(await generateUploadUrl({}), { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: string };
        const url = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
        if (!url) throw new Error("Could not store the image.");
        return url;
      } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); return null; }
    }));
    setAttached((prev) => [...new Set([...prev, ...stored.filter((u): u is string => !!u)])].slice(0, MAX_REFERENCE_IMAGES));
    setUploading(false);
  }

  /** No influencer, or someone else's: price it, send the USDC from the user's own wallet, then render once it is verified. */
  async function generateWalletPaid(text: string) {
    if (!cameo && !attached.length) throw new Error("Add a reference image first: a face, product or scene to build the video from.");
    const data = await payAndPost<{ taskId?: string }>({
      url: "/api/explore/describe", publicKey, signTransaction, pending: paidSig, onStatus: setPayNote,
      // Every face reaches the engine: the picked influencer (server side), anyone tagged in the prompt, and your own uploads.
      payload: { prompt: text, videoEngine: engineId, quality, seconds, aspect, referenceImageUrls: attached, ...(cast.length ? { castMentions: cast.filter((c) => !c.self).map((c) => ({ token: c.token, imageUrl: c.avatarUrl })).slice(0, 5) } : {}), ...(cameo ? { cameoMint: cameo.mintAddress } : {}) },
    });
    if (!data.taskId) throw new Error("The video could not start.");
    paidSig.current = undefined; // the render has started; this payment is spent
    setTask(data.taskId as Id<"agentTasks">);
  }

  async function generate() {
    const text = prompt.trim();
    if (!text || (!mint && !walletPaid) || running) return;
    setError(""); setTask(null); setStarting(true);
    try {
      if (walletPaid) { await generateWalletPaid(text); return; }
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: mint,
          taskType: "create_video",
          title: `Video: ${text.slice(0, 60)}`,
          input: {
            topic: cast.length ? `${text}\n\nTagged agents (extra character references): ${cast.map((c) => `@${c.token}`).join(", ")}.` : text,
            ...(cast.some((c) => !c.self) ? { mentionRefImageUrls: cast.filter((c) => !c.self).map((c) => c.avatarUrl).slice(0, 2), mentionCast: cast.filter((c) => !c.self).map((c) => ({ token: c.token, imageUrl: c.avatarUrl, ...(c.mintAddress ? { mintAddress: c.mintAddress } : {}) })).slice(0, 5) } : {}),
            // The influencer's own face stays the main reference; pictures you attach ride along as extra references.
            ...(attached.length ? { referenceImageUrls: attached } : {}),
            videoEngine: engineId,
            aspectRatio: aspect,
            durationSeconds: seconds,
            ...(pricingSpec ? { videoResolution: quality } : {}),
            ...(skipStoryboard ? { skipStoryboard: true } : {}),
            ...(noPersona ? { noPersona: true } : {}),
            ...(noPersona && skipStoryboard ? { exactOutput: true } : {}),
            ...(postToX && xConnected ? { autoPost: { platforms: ["x"] } } : {}),
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
            <DialogDescription className="mt-1 text-zinc-500">Pick an influencer to film it, or make a video without one. The price is shown before you generate.</DialogDescription>
          </div>

          {agents === undefined ? (
            <p className="flex items-center gap-2 py-6 text-xs text-zinc-400"><Loader2 className="size-4 animate-spin" /> Loading your influencers…</p>
          ) : (
            <div className="space-y-4">
              <label className="block text-xs font-medium text-zinc-400">
                Influencer
                <Select value={noInfluencer ? NONE : cameo ? cameo.mintAddress : mint} onValueChange={(v) => { setPicked(v ?? ""); setEngineOverride(null); paidSig.current = undefined; reset(); }}>
                  <SelectTrigger aria-label="Your influencer" className="mt-2 h-[88px] w-full border-white/10 bg-white/5 px-2.5 text-white">
                    <SelectValue placeholder="Choose an influencer">
                      {(value: string | null) => { if (value === NONE) return <NoInfluencerOption />; const o = (everyone ?? []).find((x) => x.mintAddress === value && !owned.has(x.mintAddress)); if (o) return <AgentOption xl name={o.name} ticker={o.ticker} avatarUrl={o.avatarUrl} />; const a = agents.find((x) => x.mintAddress === value); return a ? <AgentOption xl name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /> : "Choose an influencer"; }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} sideOffset={8} className="max-h-[min(34rem,var(--available-height))] border-white/10 bg-[#14171a]/95 p-1.5 text-white">
                    <SelectItem value={NONE} className="min-h-[88px] py-3 pl-2"><NoInfluencerOption /></SelectItem>
                    {agents.length > 0 && <SelectGroup><SelectLabel className="px-2 pt-1 text-[11px] text-zinc-500">Yours · paid from the agent&apos;s wallet</SelectLabel>
                      {agents.map((a) => (
                        <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-[88px] py-3 pl-2"><AgentOption xl name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /></SelectItem>
                      ))}</SelectGroup>}
                    {others.length > 0 && <SelectGroup><SelectLabel className="px-2 pt-2 text-[11px] text-zinc-500">Anyone else · you pay from your wallet</SelectLabel>
                      {others.map((a) => (
                        <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-[88px] py-3 pl-2"><AgentOption xl name={a.name} ticker={a.ticker} avatarUrl={a.avatarUrl} /></SelectItem>
                      ))}</SelectGroup>}
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
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" disabled={uploading || running}
                    onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void attachImages(files); e.target.value = ""; }} />
                  {cameo && (
                    // eslint-disable-next-line @next/next/no-img-element -- the chosen influencer's portrait
                    <img src={cameo.avatarUrl} alt={`${cameo.name} portrait`} title={`${cameo.name} is the face of this video`} className="size-8 shrink-0 rounded-lg border border-[#d7ff00]/50 object-cover" />
                  )}
                  {attached.map((url, i) => (
                    <span key={url} className="relative inline-flex size-8 shrink-0 overflow-hidden rounded-lg border border-white/15">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local preview of an uploaded reference */}
                      <img src={url} alt={`Reference ${i + 1}`} className="size-full object-cover" />
                      <button type="button" aria-label={`Remove image ${i + 1}`} disabled={running} onClick={() => setAttached((prev) => prev.filter((u) => u !== url))} className="absolute inset-0 grid place-items-center bg-black/60 text-white opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100"><X className="size-3.5" /></button>
                    </span>
                  ))}
                  {attached.length < MAX_REFERENCE_IMAGES && (
                    <button type="button" aria-label="Add reference images" title={`Add reference images: faces, a product or a scene (up to ${MAX_REFERENCE_IMAGES})`} onClick={() => fileRef.current?.click()} disabled={uploading || running}
                      className={`${CHIP} h-8 min-w-8 justify-center !px-2 disabled:opacity-40`}>
                      {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                      {attached.length > 0 && <span className="tabular-nums">{attached.length}/{MAX_REFERENCE_IMAGES}</span>}
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
                  {!walletPaid && <ChipCheck checked={skipStoryboard} onChange={setSkipStoryboard} label="Skip storyboard" title="Skip the multi-panel storyboard image and render straight from the reference" />}
                  {!walletPaid && <ChipCheck checked={noPersona} onChange={setNoPersona} label="No persona" title="Send your prompt as-is, without the agent's persona and memories" />}
                  {!walletPaid && xConnected && <ChipCheck checked={postToX} onChange={setPostToX} label="Post to X" title="When the video is ready, post it to your connected X account with a caption written to get replies and shares" />}
                  <PriceButton className="ml-auto" disabled={!prompt.trim() || (!mint && !walletPaid) || (noInfluencer && !attached.length) || running} busy={running} onClick={() => void generate()} priceUsd={null} priceText={formatRetailUsd(priceUsd)}
                    title={running ? "Rendering…" : walletPaid ? "You pay this in USDC from your own wallet. Includes the Solcameo fee." : "Charged from the agent's wallet. Includes the Solcameo fee."} />
                </div>
                {!walletPaid && mint && agent?.agentWallet && !running && !videoUrl && <AgentPayStatus mintAddress={mint} wallet={agent.agentWallet} priceUsd={priceUsd} onFund={() => { setFundWallet(agent.agentWallet ?? undefined); setFundOpen(true); }} />}
                {!walletPaid && mint && xConnected && !postToX && !running && !videoUrl && <p className="mt-2 text-[11.5px] text-zinc-500">X is connected: when this video is ready it joins the automatic schedule and posts to X 3 times a day, newest first.</p>}
                {noInfluencer && !attached.length && !failure && <p className="mt-3 text-[12px] text-zinc-400">Add a reference image with the picture button: the face, product or scene your video is built from.</p>}
                {failure && (
                  <p role="alert" className="mt-3 flex items-start gap-2 text-[12px] text-red-300"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{failure}</p>
                )}
              </div>

              {running && !videoUrl && (
                <RenderProgress stage={starting || !state || waitingOnPayment ? "paying" : "rendering"} amount={formatRetailUsd(priceUsd)} agentName={agent?.name} payer={walletPaid ? "you" : "agent"} note={walletPaid && starting ? payNote : undefined} onClose={() => onOpenChange(false)} />
              )}
              {videoUrl && (
                <div className="space-y-3">
                  <BlurRevealVideo src={videoUrl} className="mx-auto max-w-sm" />
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {walletPaid
                      ? <a href={videoUrl} download target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[3px] bg-[#d7ff00] px-4 text-sm font-semibold text-black hover:bg-[#e4ff59]"><Download className="size-3.5" /> Download</a>
                      : <Link href={`/builder?type=influencer&mint=${encodeURIComponent(mint)}`} className="inline-flex h-9 items-center rounded-[3px] bg-[#d7ff00] px-4 text-sm font-semibold text-black hover:bg-[#e4ff59]">Open in builder</Link>}
                    <button type="button" onClick={() => { reset(); setPrompt(""); }} className={`${CHIP} h-9 px-3.5`}><RotateCcw className="size-3.5" /> Describe another</button>
                  </div>
                </div>
              )}
              {!running && !videoUrl && !failure && <p className="flex items-center gap-1.5 text-[11px] text-zinc-500"><Wand2 className="size-3" /> {walletPaid ? `Your wallet asks you to approve the USDC payment${cameo ? ` for ${cameo.name}'s cameo` : ""}, then the render starts.` : `The price is charged from ${agent?.name ?? "the agent"}'s wallet when the render starts.`}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <FundAgentDialog open={fundOpen} onOpenChange={setFundOpen} mintAddress={mint} agentWallet={fundWallet ?? agent?.agentWallet ?? undefined} agentName={agent?.name} suggestedUsdc={+priceUsd.toFixed(2)} />
    </>
  );
}
