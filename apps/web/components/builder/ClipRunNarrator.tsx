"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { isClipActive } from "@/lib/builder/clipPhase";

// One human line per pipeline stage. Keys match clipJobs.status transitions
// (clipJobs.process: downloading→transcribing→analyzing→clipping→posting→completed/error).
const STAGE_LINE: Record<string, string> = {
  downloading: "⬇️ Downloading the source video…",
  transcribing: "🗣️ Transcribing the audio…",
  analyzing: "🔍 Finding the most viral moments…",
  clipping: "✂️ Cutting vertical 9:16 clips…",
  posting: "📤 Auto-posting the best clips…",
  completed: "✅ Clipping complete, clips are in your Clips queue.",
  // Generic ONLY when the job carries no error text — the effect below prefers the
  // job's actual (now-actionable) `error` so the chat shows what to DO.
  error: "⚠ Clipping failed, try again, or use a Google Drive / .mp4 source.",
};

/**
 * Streams clip-run progress into the chat as discrete AI messages. Subscribes to
 * the agent's newest clipJobs row (reactive, no polling) and emits exactly one
 * line per NEW status via onStage. Renders nothing.
 */
export default function ClipRunNarrator({
  mintAddress,
  onStage,
}: {
  mintAddress?: string;
  onStage: (key: string, text: string) => void;
}) {
  const jobs = useQuery(api.clipJobs.listJobsByMint, mintAddress ? { mintAddress } : "skip");
  const clips = useQuery(api.clipJobs.listClipsByMint, mintAddress ? { mintAddress } : "skip") ?? [];
  // Track (jobId, lastStatus) so each stage of each job announces exactly once.
  const seenRef = useRef<{ jobId: string | null; status: string | null }>({ jobId: null, status: null });
  const lastReadyRef = useRef<number>(-1);

  const job = jobs?.[0];

  useEffect(() => {
    if (!job) return;
    const jobId = String(job._id);
    // New job → reset the per-job de-dupe state.
    if (seenRef.current.jobId !== jobId) {
      seenRef.current = { jobId, status: null };
      lastReadyRef.current = -1;
    }
    if (seenRef.current.status !== job.status) {
      seenRef.current.status = job.status;
      let line = STAGE_LINE[job.status];
      // On failure, narrate the job's ACTUAL error (clipJobs now stores an
      // actionable, mapped reason via lib/clip/failure) instead of a generic
      // pointer — fall back to the short generic only when the error is empty.
      if (job.status === "error") {
        const err = (job as { error?: string }).error?.trim();
        if (err) line = `⚠ Clipping failed: ${err}`;
      }
      if (line) onStage(`${jobId}:${job.status}`, line);
    }
  }, [job, onStage]);

  // Per-clip cut progress: announce "Cut N/total" as each clip turns ready while
  // the job is in the active cutting phase (matches ClipJobProgress's ready bar).
  useEffect(() => {
    if (!job || !isClipActive(job.status) || job.status !== "clipping") return;
    const jobClips = clips.filter((c: Doc<"clips">) => c.jobId === job._id);
    const total = jobClips.length;
    const ready = jobClips.filter((c: Doc<"clips">) => c.status === "ready" || c.status === "posted").length;
    if (total > 0 && ready > 0 && ready !== lastReadyRef.current) {
      lastReadyRef.current = ready;
      onStage(`${String(job._id)}:cut:${ready}`, `✂️ Cut ${ready}/${total} clips.`);
    }
  }, [job, clips, onStage]);

  return null;
}
