/* Maps a clipJobs.status into a display stepper for the clip-progress UI.
   Pure + framework-free so it can be unit-tested without Convex/React. */

export const CLIP_PHASES = ["Download", "Transcribe", "Find moments", "Cut", "Post"] as const;
export type ClipPhaseLabel = (typeof CLIP_PHASES)[number];
export type PhaseState = "done" | "active" | "pending";

// clipJobs status → index of the phase currently in progress.
const STATUS_INDEX: Record<string, number> = {
  queued: 0,
  downloading: 0,
  transcribing: 1,
  analyzing: 2,
  clipping: 3,
  posting: 4,
};

// The skills that make up the clipping module (installed on clipping agents).
export const CLIP_MODULE_SKILLS = ["video.clip", "video.transcribe", "moment.select", "auto.post", "ai.reasoning"];

/** A clipping agent always has the module; any other agent must have video.clip installed. */
export function hasClipModule(agentType: string | undefined, installedSkills: string[] | undefined | null): boolean {
  if (agentType === "clipping") return true;
  return Array.isArray(installedSkills) && installedSkills.includes("video.clip");
}

const TERMINAL = new Set(["completed", "error", "skipped"]);

/** Is a job still moving through the pipeline (not finished, errored, or absent)? */
export function isClipActive(status: string | undefined | null): boolean {
  return typeof status === "string" && status.length > 0 && !TERMINAL.has(status);
}

/** Ordered phase model for the stepper, given the job's current status. */
export function clipPhaseState(status: string): { label: ClipPhaseLabel; state: PhaseState }[] {
  const done = status === "completed";
  const errored = status === "error";
  const idx = STATUS_INDEX[status] ?? 0;
  return CLIP_PHASES.map((label, i) => {
    let state: PhaseState;
    if (done) state = "done";
    else if (errored) state = "pending";
    else if (i < idx) state = "done";
    else if (i === idx) state = "active";
    else state = "pending";
    return { label, state };
  });
}
