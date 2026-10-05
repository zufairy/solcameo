"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { clipPhaseState, isClipActive } from "@/lib/builder/clipPhase";
import { buildClipRunProgress, type ClipRunClip, type ClipRunJob } from "@/lib/builder/clip-run-progress";
import { Check, Loader2, Scissors, AlertCircle } from "lucide-react";
import { useClippingStore } from "@/components/builder/clipping-flow/store/clipping-store";

/**
 * Live clip-job progress, keyed by the agent's mint. Subscribes to clipJobs +
 * clips via Convex, so it re-renders on every server status change with no
 * polling. Dropped into the chat (compact) and the canvas (full).
 */
export default function ClipJobProgress({
  mintAddress,
  variant = "full",
  hideWhenIdle = false,
}: {
  mintAddress?: string;
  variant?: "compact" | "full";
  hideWhenIdle?: boolean;
}) {
  const savedJobs = useQuery(api.clipJobs.listJobsByMint, mintAddress ? { mintAddress } : "skip");
  const savedClips = useQuery(api.clipJobs.listClipsByMint, mintAddress ? { mintAddress } : "skip") ?? [];
  const runner = useClippingStore();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!mintAddress) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [mintAddress]);
  const localRun = runner.hydratedKey === mintAddress && runner.runMode === "local" && (runner.runStatus === "running" || !!runner.runError);
  const jobs = localRun ? [{
    _id: "local-run", sourceUrl: "", durationSeconds: undefined, status: runner.runError ? "error" : runner.runClips.length ? "clipping" : "analyzing",
    createdAt: runner.runLog[0]?.ts ?? now, updatedAt: now,
    clipsTotal: runner.draftMaxClips ?? runner.runClips.length, error: runner.runError ?? undefined,
    progressNote: runner.runProgress?.label,
  }] : savedJobs;
  const clips = localRun ? runner.runClips.map((clip, index) => ({
    _id: clip.id, jobId: "local-run", title: clip.title, status: clip.status, failReason: clip.failReason, createdAt: index,
  })) : savedClips;

  if (!mintAddress || jobs === undefined) {
    if (variant === "compact" || hideWhenIdle) return null;
    return (
      <div className="flex items-center gap-2 text-[12px] text-zinc-500">
        <Loader2 className="size-3.5 animate-spin" /> Loading clip jobs…
      </div>
    );
  }

  const job = jobs[0]; // newest first
  if (!job) {
    if (variant === "compact" || hideWhenIdle) return null;
    return <p className="text-[12px] text-zinc-500">No clips yet, paste a video URL and the agent will start clipping.</p>;
  }

  const phases = clipPhaseState(job.status);
  const active = isClipActive(job.status);
  const errored = job.status === "error";
  // A finished run clears itself off the canvas instead of leaving a stale
  // "Clipping complete" banner sitting above the clip gallery.
  if (job.status === "completed" && hideWhenIdle) return null;
  const jobClips = clips.filter((c) => c.jobId === job._id);
  const ready = jobClips.filter((c) => c.status === "ready" || c.status === "posted").length;
  // Failed clips carry a captured reason (clipJobs.process) — surface them in the
  // run card so a partial failure isn't silently hidden behind the ready count.
  const failedClips = jobClips.filter((c) => c.status === "failed");
  const firstFailReason = failedClips.find((c) => c.failReason)?.failReason;
  const compact = variant === "compact";
  const progress = buildClipRunProgress({
    startedAt: job.createdAt,
    now,
    target: job.clipsTotal ?? 0,
    job: job as unknown as ClipRunJob,
    clips: clips as unknown as ClipRunClip[],
  });

  return (
    <div className={`rounded-xl border border-white/[0.08] bg-white/[0.02] ${compact ? "p-3" : "p-4"}`}>
      {/* header */}
      <div className="flex items-center gap-2">
        <span className={`grid place-items-center rounded-lg bg-lime-400/15 text-lime-300 ${compact ? "size-6" : "size-7"}`}>
          <Scissors className={compact ? "size-3" : "size-3.5"} />
        </span>
        <span className={`font-semibold text-white truncate ${compact ? "text-[12px]" : "text-[13px]"}`}>
          {active ? "Clipping in progress" : errored ? "Clipping failed" : job.status === "completed" ? "Clipping complete" : "Clip job"}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-zinc-400">
          {active && <span className="size-1.5 rounded-full bg-lime-400 animate-pulse" />}
          {job.status}
        </span>
      </div>

      {/* stepper */}
      <div className={`mt-3 flex items-center ${compact ? "gap-1" : "gap-1.5"}`}>
        {phases.map((p, i) => (
          <div key={p.label} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full items-center">
              <span
                className={`grid place-items-center rounded-full shrink-0 transition-colors duration-500 ${compact ? "size-5" : "size-6"} ${
                  p.state === "done"
                    ? "bg-lime-400 text-lime-950"
                    : p.state === "active"
                    ? "bg-lime-400/20 text-lime-300 ring-1 ring-lime-400/50"
                    : "bg-white/[0.05] text-zinc-600"
                }`}
              >
                {p.state === "done" ? <Check className={compact ? "size-2.5" : "size-3"} />
                  : p.state === "active" ? <Loader2 className={`${compact ? "size-2.5" : "size-3"} animate-spin`} />
                  : <span className={`rounded-full bg-current ${compact ? "size-1" : "size-1.5"}`} />}
              </span>
              {i < phases.length - 1 && (
                <span className={`h-px flex-1 transition-colors duration-500 ${p.state === "done" ? "bg-lime-400/60" : "bg-white/[0.08]"}`} />
              )}
            </div>
            {!compact && (
              <span className={`text-[9px] text-center leading-tight ${p.state === "pending" ? "text-zinc-600" : "text-zinc-300"}`}>
                {p.label}
              </span>
            )}
          </div>
        ))}
      </div>

      {errored ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-2.5 py-1.5">
          <AlertCircle className="size-3.5 text-red-400 shrink-0 mt-0.5" />
          <span className="text-[11px] text-red-300">{job.error ?? "Something went wrong while clipping."}</span>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
            <span>{job.progressNote || (jobClips.length > 0 ? `${ready}/${jobClips.length} clips ready` : active ? "Finding the best moments…" : "Queued")}</span>
            {!compact && job.durationSeconds ? (
              <span className="font-mono">
                {Math.round(job.durationSeconds)}s source
                {job.durationSeconds > 60 && job.status === "clipping" && jobClips.length > 0
                  ? ` · ~${Math.max(1, Math.round(((jobClips.length - ready) * job.durationSeconds) / (jobClips.length * 30)))}min left`
                  : null}
              </span>
            ) : null}
          </div>
          {/* Per-clip failure summary, a clip can fail (render/meter/budget) while the
              job itself completes. Show the count + first captured reason instead of
              hiding it behind the ready count. Full reason on hover. */}
          {failedClips.length > 0 && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5" title={firstFailReason}>
              <AlertCircle className="size-3.5 text-rose-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-rose-300 line-clamp-2">
                {failedClips.length} clip{failedClips.length === 1 ? "" : "s"} failed
                {firstFailReason ? `, ${firstFailReason}` : ""}
              </span>
            </div>
          )}
          {active && (
            <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden" role="progressbar" aria-label="Clipping progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={localRun ? runner.runProgress?.pct ?? 1 : progress.progressPct}>
              <div
                className="h-full origin-left rounded-full bg-lime-400 motion-safe:transition-transform motion-safe:duration-500"
                style={{ transform: `scaleX(${Math.min(99, localRun ? runner.runProgress?.pct ?? 1 : progress.progressPct) / 100})` }}
              />
            </div>
          )}
          {/* The generation screen uses this full variant. It mirrors the
              Editor monitor: reserved slots appear before moment selection so
              a requested 15-clip run is visibly alive from the first second. */}
          {!compact && progress.total > 0 && active && (
            <div className="mt-3 border-t border-white/[0.08] pt-3">
              <div className="mb-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-500">
                <span>Render queue</span>
                <span>{progress.elapsedSeconds >= 60 ? `${Math.floor(progress.elapsedSeconds / 60)}m ${String(progress.elapsedSeconds % 60).padStart(2, "0")}s` : `${progress.elapsedSeconds}s`} elapsed · ~{progress.etaSeconds >= 60 ? `${Math.ceil(progress.etaSeconds / 60)}m` : `${progress.etaSeconds}s`} left</span>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {progress.items.map((item) => (
                  <div key={item.id} className={`flex min-h-8 items-center gap-2 rounded-md border px-2 text-[10.5px] ${item.state === "failed" ? "border-rose-500/25 bg-rose-500/[0.06] text-rose-200" : item.state === "ready" ? "border-lime-400/20 bg-lime-400/[0.05] text-lime-200" : "border-white/[0.07] bg-white/[0.025] text-zinc-300"}`}>
                    {item.state === "ready" ? <Check className="size-3 shrink-0 text-lime-300" />
                      : item.state === "failed" ? <AlertCircle className="size-3 shrink-0 text-rose-300" />
                      : item.state === "rendering" ? <Loader2 className="size-3 shrink-0 motion-safe:animate-spin text-lime-300" />
                      : <span className="size-1.5 shrink-0 rounded-full bg-zinc-500" />}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="shrink-0 text-[9px] uppercase tracking-wide opacity-70">{item.state}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
