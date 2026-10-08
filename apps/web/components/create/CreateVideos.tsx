"use client";
/* eslint-disable @next/next/no-img-element -- remote avatars and a local preview of the uploaded reference */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { AlertCircle, ArrowUpRight, Clapperboard, Compass, Download, ImagePlus, Loader2, RotateCcw, Plus, UserRound, Wand2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { payAndPost } from "@/lib/client/walletPaid";
import { MAX_REFERENCE_IMAGES } from "@/lib/explore/referenceImages";
import { AgentOption } from "@/components/explore/AgentOption";
import { BlurRevealVideo, RenderProgress } from "@/components/explore/RenderProgress";
import { FundAgentDialog } from "@/components/builder/FundAgentDialog";
import { AgentPayStatus } from "@/components/builder/AgentPayStatus";
import { MentionTextarea, type Mention } from "@/components/builder/generate/MentionTextarea";
import { DirectorPicker } from "./DirectorPicker";
import { CHIP, ChipSelect, PriceButton } from "@/components/builder/generate/ui";
import {
  pickableVideoEngine, getVideoEngine, selectableVideoEngines, videoCostForLength, videoLengthOptions, type VideoEngineId,
} from "@/lib/builder/agentTypes";
import { KIE_VIDEO_PRICING, type VideoQuality } from "@/lib/builder/kieVideoPricing";
import { aspectFor, aspectsForEngine, type VideoAspect } from "@/lib/builder/videoAspects";
import { formatRetailUsd } from "@/lib/pricing/retail";

type Status = Record<string, { status: string; videoUrl?: string; error?: string; paid?: boolean }>;

/** The "no influencer" choice: the video is paid for from the viewer's own wallet. */
const NONE = "__none__";

function NoInfluencerOption() {
  return (
    <span className="flex items-center gap-3">
      <span className="grid size-16 shrink-0 place-items-center rounded-[10px] border border-white/15 bg-white/[0.06]"><UserRound className="size-5 text-white/70" /></span>
      <span className="min-w-0 text-left"><span className="block text-sm font-semibold">No influencer</span><span className="block text-[11px] text-zinc-500">Pay from your wallet</span></span>
    </span>
  );
}

/** Rounded frosted-glass surface shared by the page's cards and panels. */
const GLASS = "rounded-3xl border border-white/[0.12] bg-[linear-gradient(145deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl";

/**
 * Create videos without opening the builder. The prompt is sent exactly as typed and the render is paid from the chosen
 * agent's wallet, up front, on-chain. Two other doors sit beside it: copy a video from the library (Explore), or become
 * a director and let an influencer run itself from its Director tab.
 */
export function CreateVideos() {
  const { profile } = useSupabaseAuth();
  const wallets = useMemo(() => [...new Set([...(profile?.walletAddresses ?? []), profile?.walletAddress].filter((w): w is string => !!w))], [profile]);
  const agents = useQuery(api.influencers.listByCreators, wallets.length ? { creatorWallets: wallets, liveNetwork: "mainnet" } : "skip");

  const [directorOpen, setDirectorOpen] = useState(false);
  const [picked, setPicked] = useState("");
  // Anyone's influencer can be used: yours bill the agent's own wallet, anyone else's (or none) is paid from your wallet.
  const everyone = useQuery(api.influencers.listSearchable, { liveNetwork: "mainnet" });
  const owned = new Set((agents ?? []).map((a) => a.mintAddress));
  const others = (everyone ?? []).filter((a) => !owned.has(a.mintAddress) && a.avatarUrl).slice(0, 300);
  const cameo = picked && picked !== NONE && !owned.has(picked) ? others.find((a) => a.mintAddress === picked) : undefined;
  const noInfluencer = picked === NONE || (agents !== undefined && !agents.length && !cameo);
  /** Paid from the viewer's own wallet: no influencer, or one they do not own. */
  const walletPaid = noInfluencer || !!cameo;
  const mint = noInfluencer || cameo ? "" : picked || agents?.[0]?.mintAddress || "";
  const agent = agents?.find((a) => a.mintAddress === mint);
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const paidSig = useRef<string | undefined>(undefined);
  const [prompt, setPrompt] = useState("");
  const [cast, setCast] = useState<Mention[]>([]);
  const [engineOverride, setEngineOverride] = useState<VideoEngineId | null>(null);
  const [qualityOverride, setQualityOverride] = useState<VideoQuality | null>(null);
  const [secondsOverride, setSecondsOverride] = useState<number | null>(null);
  const [aspectPick, setAspectPick] = useState<VideoAspect>("9:16");

  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  // Several reference images: the first is the main subject, the others add looks, products or scenes.
  const [attachedList, setAttachedList] = useState<string[]>([]);
  const attached = attachedList[0] ?? null;
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [task, setTask] = useState<Id<"agentTasks"> | null>(null);
  const [payNote, setPayNote] = useState("");
  const [fundOpen, setFundOpen] = useState(false);

  const engineId = engineOverride ?? pickableVideoEngine(walletPaid ? undefined : agent?.videoEngine);
  const pricingSpec = KIE_VIDEO_PRICING[engineId];
  const aspect = aspectFor(engineId, aspectPick);
  const quality: VideoQuality = qualityOverride && pricingSpec?.qualities.includes(qualityOverride) ? qualityOverride : (pricingSpec?.defaultQuality ?? "720p");
  const lengths = videoLengthOptions(engineId);
  const seconds = secondsOverride && lengths.includes(secondsOverride) ? secondsOverride : (lengths[0] ?? 5);
  // The prompt goes out as written, with no storyboard step, so the price shown is the render price alone.
  const priceUsd = videoCostForLength(getVideoEngine(engineId), seconds, quality);

  // The paying wallet, read live so the balance is never stale.
  const wallet = agent?.agentWallet ?? undefined;
  const [unit, setUnit] = useState<"usdc" | "sol">("usdc");
  const [funds, setFunds] = useState<{ usdc: number; sol: number } | null>(null);
  useEffect(() => {
    if (!wallet) { setFunds(null); return; } // eslint-disable-line react-hooks/set-state-in-effect
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/agent-wallet-balance?wallet=${encodeURIComponent(wallet)}&fresh=1`, { cache: "no-store" });
        const data = (await res.json()) as { ok?: boolean; usdc?: number; sol?: number };
        if (live && data.ok) setFunds({ usdc: data.usdc ?? 0, sol: data.sol ?? 0 });
      } catch { /* keep the last figure */ }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    window.addEventListener("solcameo:trade-confirmed", load);
    return () => { live = false; clearInterval(timer); window.removeEventListener("solcameo:trade-confirmed", load); };
  }, [wallet]);

  const status = useQuery(api.agentTasks.generationStatus, task ? { ids: [task] } : "skip") as Status | undefined;
  const state = task ? status?.[task] : undefined;
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

  async function attachImages(files: File[]) {
    setUploading(true); setError("");
    try {
      for (const file of files) {
        const res = await fetch(await generateUploadUrl({}), { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: string };
        const url = (await resolveStorageUrl({ storageId: storageId as unknown as never })) as string;
        if (!url) throw new Error("Could not store the image.");
        setAttachedList((prev) => (prev.length >= MAX_REFERENCE_IMAGES || prev.includes(url) ? prev : [...prev, url]));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  }

  /** No influencer, or someone else's: price it, pay Solcameo from your own wallet, then render once it is verified. */
  async function generateWalletPaid(text: string) {
    if (!cameo && !attachedList.length) throw new Error("Add at least one reference image first: a face, product or scene to build the video from.");
    const data = await payAndPost<{ taskId?: string }>({
      url: "/api/explore/describe", publicKey, signTransaction, pending: paidSig, onStatus: setPayNote,
      payload: { prompt: text, videoEngine: engineId, quality, seconds, aspect, referenceImageUrls: attachedList, ...(cast.length ? { castMentions: cast.filter((c) => !c.self).map((c) => ({ token: c.token, imageUrl: c.avatarUrl })).slice(0, 5) } : {}), ...(cameo ? { cameoMint: cameo.mintAddress } : {}) },
    });
    if (!data.taskId) throw new Error("The video could not start.");
    paidSig.current = undefined; // the render has started; this payment is spent
    setTask(data.taskId as Id<"agentTasks">);
  }

  async function generate() {
    const text = prompt.trim();
    if (!text || (!mint && !walletPaid) || running) return;
    setError(""); setTask(null); setStarting(true);
    const taggedOthers = cast.filter((c) => !c.self);
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
            topic: taggedOthers.length ? `${text}\n\nTagged agents (extra character references): ${taggedOthers.map((c) => `@${c.token}`).join(", ")}.` : text,
            ...(taggedOthers.length ? { mentionRefImageUrls: taggedOthers.map((c) => c.avatarUrl).slice(0, 2), mentionCast: taggedOthers.map((c) => ({ token: c.token, imageUrl: c.avatarUrl })).slice(0, 5) } : {}),
            ...(attached ? { referenceImageUrl: attached, ...(attachedList.length > 1 ? { referenceImageUrls: attachedList.slice(1) } : {}) } : {}),
            videoEngine: engineId,
            aspectRatio: aspect,
            durationSeconds: seconds,
            ...(pricingSpec ? { videoResolution: quality } : {}),
            skipStoryboard: true,
            // Exactly the typed text, nothing added, no burned overlays.
            noPersona: true,
            exactOutput: true,
          },
          triggeredBy: "create_videos",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string; message?: string; code?: string };
      if (data.code === "needs_funding" || data.error === "insufficient_funds") {
        setFundOpen(true);
        throw new Error(`This video needs ${formatRetailUsd(priceUsd)} in ${agent?.name ?? "the agent"}'s wallet. Fund it, then try again.`);
      }
      if (!res.ok || !data.taskId) throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
      setTask(data.taskId as Id<"agentTasks">);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start the render"); }
    finally { setStarting(false); }
  }
  const reset = () => { setTask(null); setError(""); };
  const lowBalance = funds != null && funds.usdc < priceUsd && funds.sol <= 0.03;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <header>
        <h1 className="text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-white">Make a video in one prompt</h1>
        <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-zinc-400">No builder, no setup, and no influencer needed. Describe the video, add up to {MAX_REFERENCE_IMAGES} reference images, pick a size and length. Pay from your agent&apos;s wallet, or from your own wallet for anyone else.</p>
      </header>

      {/* Three ways in: type a prompt here, copy something from the library, or put an influencer in the director's chair. */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-3xl border border-[#d7ff00]/50 bg-[linear-gradient(145deg,rgba(215,255,0,0.12),rgba(215,255,0,0.03))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl">
          <div className="flex items-center justify-between">
            <span className="grid size-9 place-items-center rounded-xl border border-[#d7ff00]/40 bg-black/20 text-[#d7ff00]"><Wand2 className="size-4" /></span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[#d7ff00]">Fastest</span>
          </div>
          <p className="mt-3 text-[14.5px] font-semibold text-white">Just a prompt</p>
          <p className="mt-1 text-[12px] leading-5 text-zinc-300">Type what you want, with or without an influencer. It is sent exactly as written: no persona, no rewrite, no extras.</p>
        </div>
        <Link href="/explore" className={`${GLASS} group flex flex-col p-4 transition-all hover:-translate-y-0.5 hover:border-white/30`}>
          <div className="flex items-center justify-between">
            <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-white/[0.05] text-zinc-200"><Compass className="size-4" /></span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-zinc-500">Explore</span>
          </div>
          <p className="mt-3 flex items-center gap-1 text-[14.5px] font-semibold text-white">Copy from library <ArrowUpRight className="size-3.5 text-zinc-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></p>
          <p className="mt-1 text-[12px] leading-5 text-zinc-400">Browse thousands of viral clips and recreate the motion with your influencer.</p>
        </Link>
        <button type="button" onClick={() => setDirectorOpen(true)} className={`${GLASS} group flex flex-col p-4 text-left transition-all hover:-translate-y-0.5 hover:border-white/30`}>
          <div className="flex items-center justify-between">
            <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-white/[0.05] text-zinc-200"><Clapperboard className="size-4" /></span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-zinc-500">Autopilot</span>
          </div>
          <p className="mt-3 flex items-center gap-1 text-[14.5px] font-semibold text-white">Become a director <ArrowUpRight className="size-3.5 text-zinc-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></p>
          <p className="mt-1 text-[12px] leading-5 text-zinc-400">Set the scenes, cast and style once, then let your influencer plan, make and post videos on its own.</p>
        </button>
      </div>

      {(
        <section className={`${GLASS} mt-6 p-4 sm:p-6`} aria-label="Video prompt">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Influencer
              <Select value={noInfluencer ? NONE : cameo ? cameo.mintAddress : mint} onValueChange={(v) => { setPicked(v ?? ""); setEngineOverride(null); paidSig.current = undefined; reset(); }}>
                <SelectTrigger size="auto" aria-label="Agent" className="mt-1.5 min-h-[96px] w-full rounded-2xl border-white/10 bg-white/5 px-3 text-white">
                  <SelectValue placeholder={agents === undefined ? "Loading…" : "Choose an influencer"}>
                    {(value: string | null) => { if (value === NONE) return <NoInfluencerOption />; const o = others.find((x) => x.mintAddress === value); if (o) return <AgentOption xl name={o.name} ticker={o.ticker} avatarUrl={o.avatarUrl} />; const a = agents?.find((x) => x.mintAddress === value); return a ? <AgentOption xl name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /> : "Choose an influencer"; }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} sideOffset={8} className="max-h-[min(42rem,var(--available-height))] border-white/10 bg-[#14171a]/95 p-1.5 text-white">
                  <SelectItem value={NONE} className="min-h-[96px] py-3.5 pl-2.5"><NoInfluencerOption /></SelectItem>
                  {!!agents?.length && <SelectGroup><SelectLabel className="px-2 pt-1 text-[11px] text-zinc-500">Yours · paid from the agent&apos;s wallet</SelectLabel>
                    {agents.map((a) => (
                      <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-[96px] py-3.5 pl-2.5"><AgentOption xl name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /></SelectItem>
                    ))}</SelectGroup>}
                  {others.length > 0 && <SelectGroup><SelectLabel className="px-2 pt-2 text-[11px] text-zinc-500">Anyone else · you pay from your wallet</SelectLabel>
                    {others.map((a) => (
                      <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-[96px] py-3.5 pl-2.5"><AgentOption xl name={a.name} ticker={a.ticker} avatarUrl={a.avatarUrl} /></SelectItem>
                    ))}</SelectGroup>}
                </SelectContent>
              </Select>
            </label>
            {walletPaid && (
              <div className="text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Paid from</p>
                <p className="mt-0.5 text-[13px] font-semibold text-white">Your wallet</p>
                <p className="text-[10.5px] text-zinc-500">USDC, approved when you generate</p>
              </div>
            )}
            {!walletPaid && wallet && (
              <div className="text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white">Wallet</p>
                <p className="mt-2 flex items-center justify-end gap-1.5 text-[15px] font-semibold tabular-nums text-white">
                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />{funds ? (unit === "sol" ? `${funds.sol.toFixed(3)} SOL` : `$${funds.usdc.toFixed(2)}`) : "···"}
                  <button type="button" onClick={() => setFundOpen(true)}
                    className="ml-1.5 inline-flex h-6 origin-right scale-90 items-center gap-1 rounded-full border border-white/25 bg-white/[0.09] px-2 text-[10px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),inset_0_-1px_0_rgba(255,255,255,0.04),0_8px_22px_-10px_rgba(215,255,0,0.45)] backdrop-blur-xl transition-all hover:border-[#d7ff00]/50 hover:bg-white/[0.15] active:scale-95 focus-visible:outline-2 focus-visible:outline-[#d7ff00]">
                    <span className="grid size-3.5 place-items-center rounded-full bg-[#d7ff00] text-black"><Plus className="size-2.5" strokeWidth={3} /></span>Fund
                  </button>
                </p>
                <span role="group" aria-label="Wallet currency" className="mt-1.5 inline-flex rounded-[6px] border border-white/[0.14] bg-white/[0.05] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-xl">
                  {(["usdc", "sol"] as const).map((u) => (
                    <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}
                      className={`h-6 rounded-[4px] px-2.5 text-[10.5px] font-semibold uppercase tracking-wide transition-all active:scale-95 ${unit === u ? "bg-gradient-to-b from-white/[0.28] to-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" : "text-zinc-500 hover:text-zinc-200"}`}>{u}</button>
                  ))}
                </span>
              </div>
            )}
          </div>

          <div className="mt-4">
            <MentionTextarea
              value={prompt}
              onChange={setPrompt}
              onCast={setCast}
              selfMint={mint}
              selfName={agent?.name}
              selfImage={agent?.avatarUrl}
              placeholder="Describe the video exactly as you want it. Type @ to bring in another agent."
              rows={5}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" disabled={uploading || running || attachedList.length >= MAX_REFERENCE_IMAGES}
                onChange={(e) => { const picked = Array.from(e.target.files ?? []).slice(0, Math.max(0, MAX_REFERENCE_IMAGES - attachedList.length)); if (picked.length) void attachImages(picked); e.target.value = ""; }} />
              {cameo && <img src={cameo.avatarUrl} alt={`${cameo.name} portrait`} title={`${cameo.name} is the face of this video`} className="size-8 shrink-0 rounded-lg border border-white/15 object-cover" />}
              {attachedList.map((url, i) => (
                <span key={url} className="relative inline-flex size-8 shrink-0 overflow-hidden rounded-lg border border-white/15" title={i === 0 && !cameo ? "Main reference" : "Extra reference"}>
                  <img src={url} alt={`Reference ${i + 1}`} className="size-full object-cover" />
                  <button type="button" aria-label="Remove image" onClick={() => setAttachedList((prev) => prev.filter((u) => u !== url))} className="absolute inset-0 grid place-items-center bg-black/60 text-white opacity-0 transition-opacity hover:opacity-100"><X className="size-3.5" /></button>
                </span>
              ))}
              {attachedList.length < MAX_REFERENCE_IMAGES && (
                <button type="button" aria-label="Add reference images" title={`Add reference images (up to ${MAX_REFERENCE_IMAGES}): faces, products or scenes to build the video from`} onClick={() => fileRef.current?.click()} disabled={uploading || running}
                  className={`${CHIP} h-8 justify-center gap-1 ${attachedList.length ? "px-2" : "size-8 !p-0"} disabled:opacity-40`}>
                  {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                  {attachedList.length > 0 && <span className="text-[11px] tabular-nums">{attachedList.length}/{MAX_REFERENCE_IMAGES}</span>}
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
              <PriceButton className="ml-auto" disabled={!prompt.trim() || (!mint && !walletPaid) || (noInfluencer && !attachedList.length) || running} busy={running} onClick={() => void generate()} priceUsd={null} priceText={formatRetailUsd(priceUsd)}
                title={running ? "Rendering…" : walletPaid ? "You pay this in USDC from your own wallet before the render starts. Includes the Solcameo fee." : "Paid from the agent's wallet before the render starts. Includes the Solcameo fee."} />
            </div>
            {!walletPaid && mint && wallet && !running && <AgentPayStatus mintAddress={mint} wallet={wallet} priceUsd={priceUsd} onFund={() => setFundOpen(true)} />}
            {failure && <p role="alert" className="mt-3 flex items-start gap-2 text-[12px] text-red-300"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{failure}</p>}
          </div>

          <p className="mt-4 border-t border-white/[0.07] pt-3 text-[11.5px] leading-5 text-zinc-500">
            Your prompt is sent exactly as written, with no persona and no storyboard. {walletPaid ? (cameo ? <>The video uses {cameo.name}&apos;s portrait{attachedList.length ? ` plus your ${attachedList.length} image${attachedList.length === 1 ? "" : "s"}` : ""}. You pay from your own wallet, Solcameo gets the video fee.</> : <>With no influencer, add one to {MAX_REFERENCE_IMAGES} reference images: the first is the main subject. You pay from your own wallet.</>) : <>The video uses {attached ? (attachedList.length > 1 ? `the ${attachedList.length} images you added` : "the image you added") : <>{agent?.name ?? "your agent"}&apos;s face as the subject. Add images to use something else</>}.</>} {!walletPaid && lowBalance ? <span className="text-amber-300/90">This wallet has less than the price: fund it first.</span> : null}
          </p>
        </section>
      )}

      {(running && !videoUrl) && (
        <div className="mt-5">
          <RenderProgress stage={starting || (waitingOnPayment && !payGaveUp) ? "paying" : "rendering"} amount={formatRetailUsd(priceUsd)} agentName={agent?.name ?? cameo?.name} payer={walletPaid ? "you" : "agent"} note={walletPaid && starting ? payNote : undefined} onClose={reset} />
        </div>
      )}
      {videoUrl && (
        <div className="mt-5 space-y-3">
          <BlurRevealVideo src={videoUrl} className="mx-auto max-w-sm" />
          <div className="flex flex-wrap items-center justify-center gap-2">
            {walletPaid
              ? <a href={videoUrl} download target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 bg-[#d7ff00] px-4 text-[13px] font-semibold text-black hover:bg-[#e4ff59]"><Download className="size-3.5" /> Download</a>
              : <Link href="/control" className="inline-flex h-9 items-center bg-[#d7ff00] px-4 text-[13px] font-semibold text-black hover:bg-[#e4ff59]">Open My agents</Link>}
            <button type="button" onClick={() => { reset(); setPrompt(""); }} className={`${CHIP} h-9 px-3.5`}><RotateCcw className="size-3.5" /> Make another</button>
          </div>
        </div>
      )}

      <DirectorPicker open={directorOpen} onOpenChange={setDirectorOpen} agents={agents} />
      <FundAgentDialog open={fundOpen} onOpenChange={setFundOpen} mintAddress={mint} agentWallet={wallet} agentName={agent?.name} suggestedUsdc={+priceUsd.toFixed(2)} />
    </div>
  );
}
