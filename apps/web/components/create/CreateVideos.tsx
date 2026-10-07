"use client";
/* eslint-disable @next/next/no-img-element -- remote avatars and a local preview of the uploaded reference */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "convex/react";
import { AlertCircle, ArrowUpRight, Clapperboard, ImagePlus, Loader2, RotateCcw, Sparkles, Plus, UserRound, Wand2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgentOption } from "@/components/explore/AgentOption";
import { BlurRevealVideo, RenderProgress } from "@/components/explore/RenderProgress";
import { FundAgentDialog } from "@/components/builder/FundAgentDialog";
import { MentionTextarea, type Mention } from "@/components/builder/generate/MentionTextarea";
import { CHIP, ChipCheck, ChipSelect, PANEL, PriceButton } from "@/components/builder/generate/ui";
import {
  pickableVideoEngine, VIDEO_STORYBOARD_COST_USDC, getVideoEngine, selectableVideoEngines, videoCostForLength, videoLengthOptions, type VideoEngineId,
} from "@/lib/builder/agentTypes";
import { KIE_VIDEO_PRICING, type VideoQuality } from "@/lib/builder/kieVideoPricing";
import { aspectFor, aspectsForEngine, type VideoAspect } from "@/lib/builder/videoAspects";
import { formatRetailUsd } from "@/lib/pricing/retail";

type Mode = "quick" | "agent";
type Status = Record<string, { status: string; videoUrl?: string; error?: string; paid?: boolean }>;

const MODES: ReadonlyArray<{ id: Mode; title: string; tag: string; blurb: string; icon: typeof Wand2 }> = [
  { id: "quick", title: "Just a prompt", tag: "Fastest", icon: Wand2, blurb: "Type what you want. It is sent exactly as written: no persona, no rewrite, no extras." },
  { id: "agent", title: "With my agent", tag: "Fast", icon: UserRound, blurb: "Your agent's character, voice and style shape the video. Still one prompt, no setup." },
];

/**
 * Create videos without opening the builder. "Just a prompt" sends the text exactly as typed; "With my agent" lets the agent's
 * character and style shape it. Either way the render is paid from the chosen agent's wallet, up front, on-chain. A storyline
 * with scenes and a recurring cast lives in the agent's Director tab, which is one click away.
 */
export function CreateVideos() {
  const { profile } = useSupabaseAuth();
  const wallets = useMemo(() => [...new Set([...(profile?.walletAddresses ?? []), profile?.walletAddress].filter((w): w is string => !!w))], [profile]);
  const agents = useQuery(api.influencers.listByCreators, wallets.length ? { creatorWallets: wallets } : "skip");

  const [mode, setMode] = useState<Mode>("quick");
  const [picked, setPicked] = useState("");
  const mint = picked || agents?.[0]?.mintAddress || "";
  const agent = agents?.find((a) => a.mintAddress === mint);
  const [prompt, setPrompt] = useState("");
  const [cast, setCast] = useState<Mention[]>([]);
  const [engineOverride, setEngineOverride] = useState<VideoEngineId | null>(null);
  const [qualityOverride, setQualityOverride] = useState<VideoQuality | null>(null);
  const [secondsOverride, setSecondsOverride] = useState<number | null>(null);
  const [aspectPick, setAspectPick] = useState<VideoAspect>("9:16");
  const [storyboard, setStoryboard] = useState(false);

  const generateUploadUrl = useMutation(api.clipStorage.generateUploadUrl);
  const resolveStorageUrl = useMutation(api.clipStorage.resolveStorageUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [task, setTask] = useState<Id<"agentTasks"> | null>(null);
  const [fundOpen, setFundOpen] = useState(false);

  const engineId = engineOverride ?? pickableVideoEngine(agent?.videoEngine);
  const pricingSpec = KIE_VIDEO_PRICING[engineId];
  const aspect = aspectFor(engineId, aspectPick);
  const quality: VideoQuality = qualityOverride && pricingSpec?.qualities.includes(qualityOverride) ? qualityOverride : (pricingSpec?.defaultQuality ?? "720p");
  const lengths = videoLengthOptions(engineId);
  const seconds = secondsOverride && lengths.includes(secondsOverride) ? secondsOverride : (lengths[0] ?? 5);
  // Quick mode never writes a storyboard; agent mode does when asked. The price shown is the price charged.
  const skipStoryboard = mode === "quick" || !storyboard;
  const priceUsd = (skipStoryboard ? 0 : VIDEO_STORYBOARD_COST_USDC) + videoCostForLength(getVideoEngine(engineId), seconds, quality);

  // The paying wallet, read live so the balance is never stale.
  const wallet = agent?.agentWallet ?? undefined;
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
    const others = cast.filter((c) => !c.self);
    try {
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: mint,
          taskType: "create_video",
          title: `Video: ${text.slice(0, 60)}`,
          input: {
            topic: others.length ? `${text}\n\nTagged agents (extra character references): ${others.map((c) => `@${c.token}`).join(", ")}.` : text,
            ...(others.length ? { mentionRefImageUrls: others.map((c) => c.avatarUrl).slice(0, 2), mentionCast: others.map((c) => ({ token: c.token, imageUrl: c.avatarUrl })).slice(0, 5) } : {}),
            ...(attached ? { referenceImageUrl: attached } : {}),
            videoEngine: engineId,
            aspectRatio: aspect,
            durationSeconds: seconds,
            ...(pricingSpec ? { videoResolution: quality } : {}),
            ...(skipStoryboard ? { skipStoryboard: true } : {}),
            // "Just a prompt": exactly the typed text, nothing added, no burned overlays.
            ...(mode === "quick" ? { noPersona: true, exactOutput: true } : {}),
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
        <p className="inline-flex items-center gap-2 border border-white/15 bg-white/[0.04] px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-[#d7ff00]"><Clapperboard className="size-3" /> Create videos</p>
        <h1 className="mt-4 text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-white">Make a video in one prompt</h1>
        <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-zinc-400">No builder, no setup. Describe the video, pick a size and length, and it is paid up front from your agent&apos;s wallet and rendered.</p>
      </header>

      {/* Three ways to make a video: two live here, the third opens the Director. */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3" role="tablist" aria-label="How to create">
        {MODES.map((m) => {
          const Icon = m.icon;
          const on = mode === m.id;
          return (
            <button key={m.id} type="button" role="tab" aria-selected={on} onClick={() => setMode(m.id)}
              className={`group relative overflow-hidden border p-4 text-left transition-colors ${on ? "border-[#d7ff00]/60 bg-[#d7ff00]/[0.07]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}>
              <div className="flex items-center justify-between">
                <span className={`grid size-8 place-items-center border ${on ? "border-[#d7ff00]/50 text-[#d7ff00]" : "border-white/15 text-zinc-300"}`}><Icon className="size-4" /></span>
                <span className={`font-mono text-[9.5px] uppercase tracking-[0.18em] ${on ? "text-[#d7ff00]" : "text-zinc-500"}`}>{m.tag}</span>
              </div>
              <p className="mt-3 text-[14.5px] font-semibold text-white">{m.title}</p>
              <p className="mt-1 text-[12px] leading-5 text-zinc-400">{m.blurb}</p>
              {on && <motion.span layoutId="mode-underline" className="absolute inset-x-0 bottom-0 h-px bg-[#d7ff00]" />}
            </button>
          );
        })}
        <Link href={mint ? `/builder?type=influencer&mint=${encodeURIComponent(mint)}&tab=director` : "/control"}
          className="group relative flex flex-col overflow-hidden border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-white/25">
          <div className="flex items-center justify-between">
            <span className="grid size-8 place-items-center border border-white/15 text-zinc-300"><Sparkles className="size-4" /></span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-zinc-500">Storyline</span>
          </div>
          <p className="mt-3 flex items-center gap-1 text-[14.5px] font-semibold text-white">With a storyline <ArrowUpRight className="size-3.5 text-zinc-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></p>
          <p className="mt-1 text-[12px] leading-5 text-zinc-400">Scenes, a recurring cast, formats and style. Opens My Director{agent ? ` for ${agent.name}` : ""}.</p>
        </Link>
      </div>

      {agents !== undefined && agents.length === 0 ? (
        <div className={`${PANEL} mt-6 p-6 text-center`}>
          <p className="text-[14px] font-semibold text-white">You need an agent to pay from</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-5 text-zinc-400">Every video is paid from an agent&apos;s own wallet, up front and on-chain. Creating an agent is free and takes a minute. You do not have to use its character.</p>
          <Link href="/create" className="mt-4 inline-flex h-9 items-center gap-1.5 bg-[#d7ff00] px-4 text-[13px] font-semibold text-black hover:bg-[#e4ff59]"><Plus className="size-3.5" /> Create an agent</Link>
        </div>
      ) : (
        <section className={`${PANEL} mt-6 p-4 sm:p-5`} aria-label="Video prompt">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              {mode === "quick" ? "Pay from" : "Agent"}
              <Select value={mint} onValueChange={(v) => { setPicked(v ?? ""); setEngineOverride(null); reset(); }}>
                <SelectTrigger aria-label="Agent" className="mt-1.5 h-12 w-full border-white/10 bg-white/5 px-2.5 text-white">
                  <SelectValue placeholder={agents === undefined ? "Loading…" : "Choose an agent"}>
                    {(value: string | null) => { const a = agents?.find((x) => x.mintAddress === value); return a ? <AgentOption name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /> : "Choose an agent"; }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} sideOffset={8} className="max-h-[min(22rem,var(--available-height))] border-white/10 bg-[#17191d] p-1.5 text-white">
                  {agents?.map((a) => (
                    <SelectItem key={a.mintAddress} value={a.mintAddress} className="min-h-14 py-1.5 pl-2"><AgentOption name={a.name} ticker={a.coinTicker} avatarUrl={a.avatarUrl} /></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {wallet && (
              <div className="text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Wallet</p>
                <p className="mt-0.5 flex items-center justify-end gap-1.5 text-[15px] font-semibold tabular-nums text-white">
                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />{funds ? `$${funds.usdc.toFixed(2)}` : "···"}
                  <button type="button" onClick={() => setFundOpen(true)} className="ml-1 inline-flex h-6 items-center gap-1 border border-white/20 px-1.5 text-[10.5px] font-semibold text-zinc-200 hover:bg-white/10"><Plus className="size-3" />Fund</button>
                </p>
                {funds && funds.sol > 0 && <p className="text-[10.5px] tabular-nums text-zinc-500">+ {funds.sol.toFixed(3)} SOL, swapped to USDC when needed</p>}
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
              placeholder={mode === "quick" ? "Describe the video exactly as you want it. Type @ to bring in another agent." : "What should your agent make? Its character and style are applied. Type @ to bring in another agent."}
              rows={5}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" disabled={uploading || running}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachImage(f); e.target.value = ""; }} />
              {attached ? (
                <span className="relative inline-flex size-8 shrink-0 overflow-hidden rounded-lg border border-white/15">
                  <img src={attached} alt="Reference" className="size-full object-cover" />
                  <button type="button" aria-label="Remove image" onClick={() => setAttached(null)} className="absolute inset-0 grid place-items-center bg-black/60 text-white opacity-0 transition-opacity hover:opacity-100"><X className="size-3.5" /></button>
                </span>
              ) : (
                <button type="button" aria-label="Add a reference image" title="Add a reference image: a face, a product or a scene to build the video from" onClick={() => fileRef.current?.click()} disabled={uploading || running}
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
              {mode === "agent" && <ChipCheck checked={storyboard} onChange={setStoryboard} label="Storyboard" title={`Plan the shots with a storyboard image first (+${formatRetailUsd(VIDEO_STORYBOARD_COST_USDC)})`} />}
              <PriceButton className="ml-auto" disabled={!prompt.trim() || !mint || running} busy={running} onClick={() => void generate()} priceUsd={null} priceText={formatRetailUsd(priceUsd)}
                title={running ? "Rendering…" : "Paid from the agent's wallet before the render starts. Includes the Solcameo fee."} />
            </div>
            {failure && <p role="alert" className="mt-3 flex items-start gap-2 text-[12px] text-red-300"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{failure}</p>}
          </div>

          <p className="mt-4 border-t border-white/[0.07] pt-3 text-[11.5px] leading-5 text-zinc-500">
            {mode === "quick"
              ? <>Your prompt is sent exactly as written, with no persona and no storyboard. The video uses {attached ? "the image you added" : <>{agent?.name ?? "your agent"}&apos;s face as the subject. Add an image to use something else</>}. {lowBalance ? <span className="text-amber-300/90">This wallet has less than the price: fund it first.</span> : null}</>
              : <>{agent?.name ?? "Your agent"}&apos;s character, voice and style are applied, plus its Director settings such as captions. Want scenes and a recurring cast? <Link href={mint ? `/builder?type=influencer&mint=${encodeURIComponent(mint)}&tab=director` : "/control"} className="font-semibold text-[#d7ff00] underline underline-offset-2">Open My Director</Link>.</>}
          </p>
        </section>
      )}

      {(running && !videoUrl) && (
        <div className="mt-5">
          <RenderProgress stage={starting || (waitingOnPayment && !payGaveUp) ? "paying" : "rendering"} amount={formatRetailUsd(priceUsd)} agentName={agent?.name} onClose={reset} />
        </div>
      )}
      {videoUrl && (
        <div className="mt-5 space-y-3">
          <BlurRevealVideo src={videoUrl} className="mx-auto max-w-sm" />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/control" className="inline-flex h-9 items-center bg-[#d7ff00] px-4 text-[13px] font-semibold text-black hover:bg-[#e4ff59]">Open My agents</Link>
            <button type="button" onClick={() => { reset(); setPrompt(""); }} className={`${CHIP} h-9 px-3.5`}><RotateCcw className="size-3.5" /> Make another</button>
          </div>
        </div>
      )}

      <FundAgentDialog open={fundOpen} onOpenChange={setFundOpen} mintAddress={mint} agentWallet={wallet} agentName={agent?.name} suggestedUsdc={+priceUsd.toFixed(2)} />
    </div>
  );
}
