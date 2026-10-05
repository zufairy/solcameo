export type ClipRunJob = {
  _id: string;
  sourceUrl: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  durationSeconds?: number;
  clipsTotal?: number;
  clipsReady?: number;
  progressPct?: number;
  progressNote?: string;
  error?: string;
};

export type ClipRunClip = {
  _id: string;
  jobId: string;
  title: string;
  status: string;
  failReason?: string;
  createdAt: number;
};

export type ClipRunItemState = "planning" | "rendering" | "ready" | "failed";

export type ClipRunItem = {
  id: string;
  label: string;
  state: ClipRunItemState;
  detail?: string;
};

const EDITOR_RUN_START_TOLERANCE_MS = 2_000;

/** Finds the cloud job created by one editor run without confusing it with prior clips. */
export function findEditorClipRun(
  jobs: ClipRunJob[],
  startedAt: number,
  sourceUrl: string | null,
  jobId?: string | null,
): ClipRunJob | null {
  if (jobId) return jobs.find((job) => job._id === jobId) ?? null;
  if (!startedAt || !sourceUrl) return null;
  // An active same-source job is reused by enqueue even if it predates this click.
  // Never attach an unrelated concurrent source merely because it is newer.
  return jobs.filter((job) => job.sourceUrl === sourceUrl && (
    (job.status !== "completed" && job.status !== "error") ||
    job.createdAt >= startedAt - EDITOR_RUN_START_TOLERANCE_MS
  )).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

function phaseProgress(job: ClipRunJob | null, settled: number, total: number): number {
  if (!job) return 1;
  if (job.status === "completed") return 100;
  if (job.status === "error") return 100;
  if (job.status === "queued") return 3;
  if (job.status === "downloading") return 5 + Math.round(Math.min(100, Math.max(0, job.progressPct ?? 0)) * 0.17);
  if (job.status === "transcribing") return 25 + Math.round(Math.min(100, Math.max(0, job.progressPct ?? 0)) * 0.25);
  if (job.status === "analyzing") return 52 + Math.round(Math.min(100, Math.max(0, job.progressPct ?? 0)) * 0.11);
  if (job.status === "clipping") return 65 + Math.round((total > 0 ? settled / total : 0) * 30);
  if (job.status === "posting") return 97;
  return 5;
}

function estimateSeconds(job: ClipRunJob | null, total: number): number {
  // One source pull + transcript/moment selection, then a modest per-clip render
  // allowance. It deliberately stays conservative; actual job updates always win.
  const sourceMinutes = Math.max(1, Math.ceil((job?.durationSeconds ?? 0) / 60));
  return Math.min(25 * 60, Math.max(90, 45 + sourceMinutes * 18 + total * 12));
}

function itemState(clip: ClipRunClip): ClipRunItemState {
  if (clip.status === "failed" || clip.status === "skipped") return "failed";
  if (clip.status === "ready" || clip.status === "posting" || clip.status === "posted" || clip.status === "completed") return "ready";
  return "rendering";
}

export function buildClipRunProgress({
  startedAt,
  now,
  target,
  job,
  clips,
}: {
  startedAt: number;
  now: number;
  target: number;
  job: ClipRunJob | null;
  clips: ClipRunClip[];
}) {
  const jobClips = job ? clips.filter((clip) => clip.jobId === job._id).sort((a, b) => a.createdAt - b.createdAt) : [];
  const total = Math.max(target, job?.clipsTotal ?? 0, jobClips.length);
  const ready = jobClips.filter((clip) => itemState(clip) === "ready").length;
  const failed = jobClips.filter((clip) => itemState(clip) === "failed").length;
  const settled = ready + failed;
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const terminal = job?.status === "completed" || job?.status === "error";
  const estimate = estimateSeconds(job, total);
  const etaSeconds = terminal ? 0 : Math.max(0, Math.round(Math.max(estimate, elapsedSeconds * 1.18) - elapsedSeconds));
  const isStale = !!job && !terminal && now - job.updatedAt > 2 * 60_000;
  const pendingState: ClipRunItemState = terminal ? "failed" : job?.status === "clipping" || job?.status === "posting" ? "rendering" : "planning";
  const items: ClipRunItem[] = [
    ...jobClips.map((clip) => ({
      id: clip._id,
      label: clip.title || "Untitled clip",
      state: itemState(clip),
      ...(clip.failReason ? { detail: clip.failReason } : {}),
    })),
    ...Array.from({ length: Math.max(0, total - jobClips.length) }, (_, index) => ({
      id: `pending-${index + jobClips.length + 1}`,
      label: `Clip ${index + jobClips.length + 1}`,
      state: pendingState,
      detail: terminal ? (job?.error || "No clip was produced for this slot") : pendingState === "rendering" ? "Rendering from the selected moment" : "Waiting for moment selection",
    })),
  ];

  return {
    total,
    ready,
    failed,
    settled,
    elapsedSeconds,
    etaSeconds,
    progressPct: phaseProgress(job, settled, total),
    isComplete: terminal || (total > 0 && settled >= total),
    isStale,
    items,
  };
}
