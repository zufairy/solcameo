"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Loader2, PlayCircle, RefreshCw, AlertTriangle, Sparkles, Clock, Film, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { getVideoEngine, videoCostForLength, VIDEO_STORYBOARD_COST_USDC, clipsForLength, type VideoEngineId } from "@/lib/builder/agentTypes";
import { formatRetailUsd } from "@/lib/pricing/retail";
import { useAgentWallet } from "@/components/builder/useAgentWallet";
import { FundAgentDialog } from "@/components/builder/FundAgentDialog";
import { CONNECT_BUTTON_CLASS } from "@/components/builder/connectButton";
import { formatById } from "@/lib/builder/formatCatalog";

/** Sample gate — the wizard's step 6. Renders ONE real sample video against
 *  the just-saved show bible (via /api/agents/run-task create_video, with
 *  `sample: true` so the run-task auto-post guard skips scheduling/posting)
 *  and asks "Looks right?" before the agent goes live. Up to 3 regenerations
 *  via the adjustment chips, then the wizard's plan stands as saved. Mirrors
 *  the wizard's dark-glass surface (OnboardingWizard.tsx GLASS_BG / chip
 *  classes from steps.tsx). */

export type AdjustChip = "style" | "pace" | "topic" | "voice" | "length";

// Total sample RENDERS allowed for one onboarding setup — the initial render
// plus 3 regenerations. Adjusting a sample regenerates it via the wizard
// (onAdjust routes back to an earlier step, then forward to step 6 again — a
// fresh SampleGate mount), so this has to be a LAUNCH counter (bumped every
// time launch() actually fires, auto or manual) persisted per-mint, not a
// per-mount ref or a count of adjust-chip clicks — those undercounted the
// true cost: a Back/Next 5↔6 cycle with no chip click still fires a fresh
// paid render every time the component remounts.
const MAX_LAUNCHES = 4;

export function launchKey(mintAddress: string): string {
  return `vello-onboarding-sample-launches-${mintAddress}`;
}

function loadLaunchCount(mintAddress: string): number {
  try {
    const raw = window.localStorage.getItem(launchKey(mintAddress));
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

const ADJUST_CHIPS: { id: AdjustChip; label: string }[] = [
  { id: "style", label: "Style" },
  { id: "pace", label: "Pace" },
  { id: "topic", label: "Topic" },
  { id: "voice", label: "Voice" },
  { id: "length", label: "Length" },
];

interface TaskState {
  paid?: boolean;
  status: string;
  videoUrl?: string;
  posterUrl?: string;
  note?: string;
  error?: string;
}

export default function SampleGate({
  mintAddress,
  formatId,
  topicHint,
  videoEngine,
  durationSeconds,
  onApprove,
  onAdjust,
}: {
  mintAddress: string;
  formatId: string;
  topicHint?: string;
  /** The wizard's Step 2 engine pick — sent as an explicit per-call override so
   *  the sample can NEVER render on a different engine than the dropdown said,
   *  even if the agent-doc save hasn't landed yet. */
  videoEngine?: string;
  /** The wizard's Step 3 length slider for this format — explicit so the script
   *  is written (and fitted) to the chosen seconds, not a bible fallback range. */
  durationSeconds?: number;
  onApprove: () => void;
  onAdjust: (chip: AdjustChip) => void;
}) {
  const { ensureSiwsSession } = useSiwsSession();
  const [taskId, setTaskId] = useState<Id<"agentTasks"> | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchCount, setLaunchCount] = useState(() => loadLaunchCount(mintAddress));
  const [adjustOpen, setAdjustOpen] = useState(false);
  // The preview container was hardcoded to a small 280px 9:16 portrait box
  // regardless of what the sample actually rendered at — a real 16:9 landscape
  // sample got squeezed/letterboxed into that portrait frame instead of
  // showing at a real, larger size. Detected from the video's own decoded
  // dimensions (not the wizard's draft aspect setting) so it's always right
  // even if a format/engine combo renders a different ratio than requested.
  const [sampleIsLandscape, setSampleIsLandscape] = useState(false);
  const launchedRef = useRef(false);
  // The agent pays for its own render from its wallet, so show that wallet and let the operator top it up right here.
  const agentDoc = useQuery(api.influencers.getByMint, { mintAddress }) as { agentWallet?: string; name?: string } | null | undefined;
  const agentWallet = useAgentWallet({ address: agentDoc?.agentWallet, mintAddress, ready: agentDoc !== undefined });
  const [fundOpen, setFundOpen] = useState(false);

  const launch = async () => {
    // Bump the persisted launch counter BEFORE the request — this call is a
    // real paid render attempt regardless of whether it succeeds, and the
    // counter has to survive the remount a Back/Next or adjust-chip cycle
    // causes (see MAX_LAUNCHES comment above).
    const next = loadLaunchCount(mintAddress) + 1;
    setLaunchCount(next);
    try {
      window.localStorage.setItem(launchKey(mintAddress), String(next));
    } catch {
      // ignore — cap just won't survive a refresh
    }
    setLaunchError(null);
    setTaskId(null);
    try {
      await ensureSiwsSession();
      const res = await fetch("/api/agents/run-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress,
          taskType: "create_video",
          title: "Sample video",
          input: {
            topic: (topicHint ?? "").trim(),
            formatId,
            // run-task's bible-directives fallback (route.ts ~line 1076) pins
            // the rotation to this exact videoStyle via input.styleId — without
            // it, the sample renders whatever the rotation has advanced to,
            // which can drift from the format the operator just picked.
            styleId: formatId,
            ...(videoEngine ? { videoEngine } : {}),
            ...(durationSeconds && durationSeconds > 0 ? { durationSeconds } : {}),
            sample: true,
          },
          triggeredBy: "onboarding_sample",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { taskId?: string; error?: string; message?: string };
      if (!res.ok || !data.taskId) throw new Error(data.message ?? data.error ?? `Render failed (${res.status})`);
      setTaskId(data.taskId as Id<"agentTasks">);
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Couldn't start the sample render");
    }
  };

  // NO auto-launch: a sample render is a real paid generation, so the page
  // first shows a summary (format · engine · length · estimated cost) and
  // renders only after the operator explicitly clicks Generate. This also
  // kills the accidental-spend of a Back/Next 5↔6 remount cycle, which used
  // to fire a fresh render on every mount.
  const [confirmed, setConfirmed] = useState(false);
  const [launchStartedAt, setLaunchStartedAt] = useState<number | null>(null);
  const startLaunch = () => {
    if (launchedRef.current || loadLaunchCount(mintAddress) >= MAX_LAUNCHES) return;
    launchedRef.current = true;
    setConfirmed(true);
    setLaunchStartedAt(Date.now());
    void launch();
  };

  // Render-plan summary + cost estimate (same math run-task bills with:
  // $0.04 script/storyboard floor + per-clip Kie generation price).
  const engineOpt = getVideoEngine(videoEngine as VideoEngineId | undefined);
  const planSeconds = durationSeconds && durationSeconds > 0 ? durationSeconds : 24;
  const planClips = clipsForLength(engineOpt, planSeconds);
  const planUsd = VIDEO_STORYBOARD_COST_USDC + videoCostForLength(engineOpt, planSeconds);
  const walletUsdc = agentWallet.funds?.usdc;
  const walletShort = walletUsdc != null && walletUsdc + 0.005 < planUsd;
  const planFormatName = formatById(formatId)?.name ?? formatId;
  // Wall-clock estimate for the progress bar: planning/storyboard overhead +
  // a per-clip render allowance (sequential frame-chained engines take the
  // longest). Deliberately a touch generous — a bar that finishes early feels
  // fine, one that hangs at 100% feels broken.
  const estimateSeconds = useMemo(() => {
    const perClip = /seedance/i.test(engineOpt.kieModel) ? 110 : /veo/i.test(engineOpt.kieModel) ? 90 : 75;
    return 45 + planClips * perClip;
  }, [engineOpt.kieModel, planClips]);
  // Progress ticks toward 95% along the estimate while rendering; jumps to
  // 100% on success. 1s tick keeps it visibly alive on long renders.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!launchStartedAt) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [launchStartedAt]);

  const taskStates = useQuery(
    api.agentTasks.generationStatus,
    taskId ? { ids: [taskId] } : "skip",
  ) as Record<string, TaskState> | undefined;

  const state = taskId ? taskStates?.[taskId] : undefined;
  const refreshWallet = agentWallet.refresh;
  useEffect(() => {
    if (state?.paid) {
      void refreshWallet();
      window.dispatchEvent(new Event("solcameo:trade-confirmed"));
    }
  }, [taskId, state?.paid, refreshWallet]);
  const isRunning = !!taskId && (!state || state.status === "pending" || state.status === "running");
  const isSucceeded = state?.status === "succeeded";
  const isFailed = state?.status === "failed";

  const capped = launchCount >= MAX_LAUNCHES;
  const regenerationsLeft = Math.max(0, MAX_LAUNCHES - launchCount);
  // True only when this mount never launched at all — landed here already
  // capped (a Back/Next 5↔6 cycle, or a fresh adjust-chip mount, after 4
  // total renders were already spent). Distinct from `capped` alone, which
  // also covers the mount that DID render the 4th/last sample.
  const neverLaunchedCapped = capped && !taskId && !launchError;

  const statusLine = useMemo(() => {
    if (launchError) return launchError;
    if (!taskId) return "Starting your sample render…";
    if (state?.status === "pending") return "Queued…";
    if (state?.status === "running") return state.paid ? "Rendering your sample…" : "Confirming payment from the agent wallet…";
    if (isFailed) return state?.error || "Something went wrong.";
    if (isSucceeded) return state?.note || "Sample ready.";
    return "Starting your sample render…";
  }, [launchError, taskId, state, isFailed, isSucceeded]);

  const handleAdjustPick = (chip: AdjustChip) => {
    if (capped) return;
    setAdjustOpen(false);
    onAdjust(chip);
  };

  const handleRetryFormat = () => {
    onAdjust("style"); // "Try another format" → wizard maps back to Step 2 (formats)
  };

  const elapsed = launchStartedAt ? (nowTick - launchStartedAt) / 1000 : 0;
  const progressPct = isSucceeded ? 100 : Math.min(95, Math.round((elapsed / estimateSeconds) * 100));
  const remainingSec = Math.max(0, Math.round(estimateSeconds - elapsed));
  const remainingLabel = remainingSec >= 60 ? `~${Math.ceil(remainingSec / 60)} min left` : remainingSec > 0 ? `~${remainingSec}s left` : "almost done…";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        {/* ── Confirm-before-generate: summary + cost, render only on click ── */}
        {!confirmed && !neverLaunchedCapped && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <Sparkles className="size-7 text-lime-400" />
            <div>
              <p className="text-[15px] font-semibold text-white">Ready to render your sample?</p>
              <p className="mt-1 text-[12.5px] text-zinc-500">One real video from your new show plan, so you can check it before going live.</p>
            </div>
            <div className="grid w-full max-w-sm grid-cols-2 gap-2 text-left">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><Film className="size-3" /> Format</p>
                <p className="mt-0.5 truncate text-[12.5px] font-medium text-zinc-200">{planFormatName}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><Sparkles className="size-3" /> Engine</p>
                <p className="mt-0.5 truncate text-[12.5px] font-medium text-zinc-200">{engineOpt.label}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><Clock className="size-3" /> Length</p>
                <p className="mt-0.5 text-[12.5px] font-medium text-zinc-200">{planSeconds}s · {planClips} clip{planClips === 1 ? "" : "s"}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><Wallet className="size-3" /> Est. cost</p>
                <p className="mt-0.5 text-[12.5px] font-bold text-white">{formatRetailUsd(planUsd)}</p>
              </div>
            </div>
            {topicHint?.trim() && (
              <p className="max-w-sm truncate text-[11.5px] text-zinc-500">Topic: <span className="text-zinc-400">{topicHint.trim()}</span></p>
            )}
            {/* Charged to the agent wallet, with a one-tap top-up when it is short. */}
            <div className="flex w-full max-w-sm items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Paid from the agent wallet</p>
                <p className="mt-0.5 text-[12.5px] font-medium text-zinc-200 tabular-nums">
                  {walletUsdc != null ? `${formatRetailUsd(walletUsdc)} available` : agentWallet.setupFailed ? "Wallet setup failed" : "Loading balance…"}
                  {walletShort && <span className="ml-1.5 text-amber-300">· needs {formatRetailUsd(planUsd - walletUsdc!)} more</span>}
                </p>
              </div>
              <button type="button" onClick={() => setFundOpen(true)} className={`${CONNECT_BUTTON_CLASS} shrink-0`}>Add funds</button>
            </div>
            <div className="mt-1 flex items-center gap-2.5">
              <button
                type="button"
                onClick={startLaunch}
                className="flex items-center gap-2 rounded-lg bg-lime-500 px-5 py-2.5 text-[13px] font-bold text-black shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-lime-400"
              >
                <PlayCircle className="size-4" /> Generate sample · {formatRetailUsd(planUsd)}
              </button>
              <button
                type="button"
                onClick={onApprove}
                className="rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/10"
              >
                Skip, go live
              </button>
            </div>
            <p className="text-[11px] text-zinc-600">{regenerationsLeft} sample render{regenerationsLeft === 1 ? "" : "s"} available for this setup.</p>
          </div>
        )}

        {neverLaunchedCapped && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="size-8 text-amber-400" />
            <p className="text-[13px] text-zinc-300">You&apos;ve used all your sample renders for this setup.</p>
            <p className="max-w-md text-[12px] text-zinc-500">Your show plan is already saved, fine-tune it anytime in chat.</p>
            <button
              type="button"
              onClick={onApprove}
              className="mt-2 rounded-lg bg-lime-500 px-5 py-2.5 text-[13px] font-bold text-black shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-lime-400"
            >
              Continue
            </button>
          </div>
        )}

        {confirmed && !neverLaunchedCapped && (isRunning || launchError) && !isFailed && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            {!launchError && <Loader2 className="size-8 animate-spin text-lime-400" />}
            {launchError && <AlertTriangle className="size-8 text-amber-400" />}
            <p className="text-[13px] text-zinc-300">{statusLine}</p>
            {!launchError && (
              <div className="w-full max-w-sm">
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-lime-500 to-lime-300 transition-[width] duration-1000 ease-linear"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{progressPct}%</span>
                  <span>{remainingLabel}</span>
                </div>
              </div>
            )}
            {launchError && (
              <button
                type="button"
                onClick={() => void launch()}
                className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3.5 py-2 text-[12.5px] font-medium text-zinc-200 transition-colors hover:bg-white/10"
              >
                <RefreshCw className="size-3.5" /> Try again
              </button>
            )}
          </div>
        )}

        {isFailed && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertTriangle className="size-8 text-red-400" />
            <p className="text-[13px] text-zinc-300">The sample render failed.</p>
            <p className="max-w-md text-[12px] text-zinc-500">{state?.error || "Unknown error."}</p>
            <div className="mt-3 flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleRetryFormat}
                className="rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] font-medium text-zinc-200 transition-colors hover:bg-white/10"
              >
                Try another format
              </button>
              <button
                type="button"
                onClick={onApprove}
                className="rounded-lg bg-lime-500 px-4 py-2.5 text-[13px] font-bold text-black transition-colors hover:bg-lime-400"
              >
                Save plan anyway
              </button>
            </div>
          </div>
        )}

        {isSucceeded && state?.videoUrl && (
          <div className="space-y-5">
            <div className={`mx-auto overflow-hidden rounded-xl border border-white/10 ${sampleIsLandscape ? "w-full max-w-2xl" : "max-w-[280px]"}`}>
              <video
                src={state.videoUrl}
                poster={state.posterUrl}
                controls
                playsInline
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth > 0 && v.videoHeight > 0) setSampleIsLandscape(v.videoWidth > v.videoHeight);
                }}
                className={`w-full bg-black ${sampleIsLandscape ? "aspect-video" : "aspect-[9/16]"}`}
              />
            </div>
            {state.note && <p className="text-center text-[12px] text-zinc-500">{state.note}</p>}

            {capped ? (
              <div className="flex flex-col items-center gap-3 border-t border-white/10 pt-4 text-center">
                <p className="text-[13px] text-zinc-400">Fine-tune later in chat, your plan is saved.</p>
                <button
                  type="button"
                  onClick={onApprove}
                  className="rounded-lg bg-lime-500 px-5 py-2.5 text-[13px] font-bold text-black shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-lime-400"
                >
                  Continue
                </button>
              </div>
            ) : !adjustOpen ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-[13px] font-medium text-zinc-300">Looks right?</p>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={onApprove}
                    className="flex items-center gap-2 rounded-lg bg-lime-500 px-5 py-2.5 text-[13px] font-bold text-black shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-lime-400"
                  >
                    <PlayCircle className="size-4" /> Yes, go live
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustOpen(true)}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-white/10"
                  >
                    Something&apos;s off
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 border-t border-white/10 pt-4">
                <p className="text-center text-[12.5px] text-zinc-500">
                  What should change? ({regenerationsLeft} regeneration{regenerationsLeft === 1 ? "" : "s"} left)
                </p>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {ADJUST_CHIPS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleAdjustPick(c.id)}
                      className="rounded-lg border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-[12px] font-medium text-zinc-300 transition-colors hover:border-lime-400/60 hover:bg-lime-400/[0.14] hover:text-lime-300"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <FundAgentDialog open={fundOpen} onOpenChange={setFundOpen} agentWallet={agentWallet.wallet} agentName={agentDoc?.name} suggestedUsdc={walletShort ? planUsd - (walletUsdc ?? 0) : planUsd} />
    </div>
  );
}
