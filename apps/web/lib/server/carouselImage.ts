import { createImageTask } from "@/lib/server/imagePost";
import { persistStill, pollNftTaskOnce, sleep, MAX_ATTEMPTS } from "@/lib/server/nftKie";
import type { ImageEngine } from "@/lib/builder/imageEngines";

/**
 * PHOTO CAROUSEL BUILDER — generate a single KIE image from a RAW operator prompt
 * on the CHOSEN engine, and persist it to a durable URL.
 *
 * The prompt is the operator's own text (no persona/LLM enrichment — this is a
 * direct tool, not an auto-post). Reuses createImageTask (model-agnostic KIE
 * createTask with retry) + pollNftTaskOnce + persistStill, so the flow is
 * identical to the avatar / image-post paths.
 *
 * REFERENCE IMAGES: the AI influencer's own generated stills are passed through
 * to KIE (`image_input` on the nano-banana engines) so every carousel slide keeps
 * the agent's look. They're best-effort — a missing/non-KIE-safe ref is dropped
 * and the prompt still renders.
 *
 * NODE-ONLY: pulls binary data + Supabase; import only from Next.js route
 * handlers on the Node runtime.
 */
export interface CarouselImageResult {
  imageUrl: string;
  engineId: string;
  engineLabel: string;
}

export async function generateCarouselImage(args: {
  prompt: string;
  engine: ImageEngine;
  /** KIE aspect_ratio (default "9:16" — TikTok photo carousels are vertical). */
  aspectRatio?: string;
  apiKey?: string;
  /** The agent's reference stills — passed to engines that accept them. */
  refImageUrls?: string[];
  /** Hard ceiling on the poll loop. */
  maxWaitMs?: number;
  /** A KIE task id persisted by an EARLIER run that timed out client-side —
   *  KIE keeps rendering after our poll deadline, so a retry first re-polls
   *  this task and only creates (and pays for) a fresh one if it truly
   *  failed. */
  resumeTaskId?: string;
  /** Called with each freshly created task id BEFORE polling starts, so the
   *  caller can persist it — a later retry can then resume instead of
   *  re-paying for a new generation. */
  onTaskCreated?: (taskId: string) => Promise<void> | void;
}): Promise<CarouselImageResult> {
  const aspectRatio = args.aspectRatio ?? "9:16";
  // AUTO-RETRY: a task can fail server-side (model overloaded, ref rejected) even
  // though createTask succeeded. Instead of surfacing the error immediately, we
  // re-create the task (same refs) up to MAX_ATTEMPTS before giving up. The poll
  // deadline is SHARED across attempts so retries can't blow the route's window.
  const deadline = Date.now() + (args.maxWaitMs ?? 180_000);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let taskId: string;
    const resuming = attempt === 1 && !!args.resumeTaskId;
    if (resuming) {
      // Credit-saving path: adopt the still-running (or already finished) task
      // from the previous timed-out run instead of creating a duplicate.
      taskId = args.resumeTaskId!;
    } else {
      taskId = await createImageTask({
        engine: args.engine,
        prompt: args.prompt,
        aspectRatio,
        refImageUrls: args.refImageUrls,
        apiKey: args.apiKey,
      });
      await args.onTaskCreated?.(taskId);
    }
    // An expired/unknown resumed task id polls as "pending" forever (KIE
    // returns an empty record, not an error) — give the resume a bounded
    // window, then fall through to a fresh paid task instead of burning the
    // whole deadline (and every future retry) on a ghost.
    const attemptDeadline = resuming ? Math.min(deadline, Date.now() + 60_000) : deadline;

    for (;;) {
      if (Date.now() > attemptDeadline) {
        if (resuming && attempt < MAX_ATTEMPTS && Date.now() < deadline) {
          console.warn(`[carouselImage] resumed task ${taskId} unresolved after 60s — creating a fresh task`);
          break; // outer loop creates a new task
        }
        throw new Error(`${args.engine.label} did not finish in time`);
      }
      await sleep(4000);
      const poll = await pollNftTaskOnce(taskId);
      if (poll.status === "fail") {
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[carouselImage] ${args.engine.label} attempt ${attempt} failed (${poll.error}), retrying…`);
          break; // outer loop re-creates the task
        }
        throw new Error(poll.error || `${args.engine.label} failed to render`);
      }
      if (poll.status !== "success") continue;
      const imageUrl = await persistStill(poll.url, 0);
      if (!imageUrl) throw new Error("could not store the generated image");
      return { imageUrl, engineId: args.engine.id, engineLabel: args.engine.label };
    }
  }
  throw new Error(`${args.engine.label} failed after ${MAX_ATTEMPTS} attempts`);
}
