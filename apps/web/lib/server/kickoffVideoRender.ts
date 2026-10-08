import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { selfLoopbackBase } from "@/lib/server/fetchInternal";

export type RenderAutoPost = {
  platforms: string[];
  campaignId?: string;
  submissionId?: string;
  contentRewardId?: string;
  ownerWallet?: string;
  caption?: string;
};

/**
 * Kick off the Vercel-safe CHUNKED video render: create the durable render job
 * (phase "storyboard") and fire the first `render-step`. The render-step chain
 * then renders ONE Veo clip per ≤300s invocation and extends to the FULL script
 * length, persisting `veoTaskId`/`clipIndex` between steps.
 *
 * This replaces the old `videoJobs.enqueue` single Convex action, which ran every
 * clip inside ONE ~560s budget and broke early (≈clip 3 / 24s) on a longer video,
 * and — running in Convex cloud — couldn't reach the dev server to stitch or post.
 * render-step runs entirely in the Next runtime, so it reaches Kie + auto-posts
 * even on localhost, and marks the agentTask succeeded/failed when done.
 *
 * Fire-and-forget by design (mirrors render-step's own `fireNextStep`); the
 * stale-task reaper is the backstop if this initial kick is ever dropped.
 */
export async function kickoffVideoRender(args: {
  convex: ConvexHttpClient;
  origin: string;
  taskId: Id<"agentTasks">;
  mintAddress: string;
  sessionId: string;
  /** Kie model id (e.g. "veo3_fast"). The chain renders one clip per invocation. */
  kieModel: string;
  /** GenerateVideoArgs-compatible render payload (+ optional `overlays`). */
  renderArgs: Record<string, unknown>;
  autoPost?: RenderAutoPost;
  /** Idempotency key tying this render to its payment (e.g. a hire tx signature). */
  renderKey?: string;
  /** Explore cameo: the influencer featured when someone else paid, so the video shows under that influencer. */
  cameoMint?: string;
}): Promise<Id<"videoRenderJobs">> {
  // Unguessable per-job credential — the render-step chain authenticates with it,
  // so the chain never stalls on a missing shared env secret.
  const driveToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");

  // Carry the catalog format id (lib/builder/formatCatalog.ts) alongside the
  // renderArgs JSON — the idea pipeline stamps it onto deferVideo's `formatId`
  // when it pre-composed a formatPrompt (see run-task's deferVideo build). Stamping
  // it here (instead of leaving callers to parse renderArgs) is the one spot every
  // kickoffVideoRender caller already passes through.
  const formatIdIn = args.renderArgs.formatId;
  const formatId = typeof formatIdIn === "string" && formatIdIn.trim() ? formatIdIn.trim() : undefined;

  const jobId = (await args.convex.mutation(api.videoRenderJobs.create, {
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    taskId: args.taskId,
    mintAddress: args.mintAddress,
    ...(args.cameoMint ? { cameoMint: args.cameoMint } : {}),
    sessionId: args.sessionId || args.mintAddress,
    driveToken,
    kieModel: args.kieModel,
    renderArgs: JSON.stringify(args.renderArgs),
    autoPost: args.autoPost,
    ...(args.renderKey ? { renderKey: args.renderKey } : {}),
    ...(formatId ? { formatId } : {}),
  })) as Id<"videoRenderJobs">;

  // Fire the first render-step on LOOPBACK — a container often can't fetch its own
  // public URL ("fetch failed"), and render-step's later self-calls derive their
  // origin from THIS request, so they inherit the loopback base automatically.
  void fetch(`${selfLoopbackBase()}/api/video/render-step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, driveToken }),
  }).catch(() => { /* the failStaleTasks reaper is the backstop */ });

  return jobId;
}
