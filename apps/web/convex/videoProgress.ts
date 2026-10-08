import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Live status of the videos an account's agents are making: what is rendering right now and what finished lately.
 * Reactive, so the header chip and the generations page move the instant a render advances.
 *
 * Reads are kept small on purpose: render jobs are large documents, so only the few active or recent ones are opened.
 */
const RECENT_MS = 24 * 3_600_000;
/** A render still "pending" or "running" after this long never reported back; it is not shown as live. */
const STALE_ACTIVE_MS = 2 * 24 * 3_600_000;
const MAX_AGENTS = 15;
const MAX_JOBS = 12;

export type VideoState = "queued" | "rendering" | "done" | "failed";

/** Rough position in the pipeline: storyboard, then one clip at a time, then posting. */
export function progressOf(job: { phase: string; clipIndex?: number; totalSegments?: number } | null, status: string): number {
  if (status === "succeeded") return 100;
  if (!job) return status === "pending" ? 2 : 5;
  if (job.phase === "done") return 100;
  if (job.phase === "storyboard") return 12;
  if (job.phase === "posting") return 94;
  const total = Math.max(1, job.totalSegments ?? 1), done = Math.min(total, Math.max(0, job.clipIndex ?? 0));
  return Math.round(16 + 76 * (done / total));
}

export const mine = query({
  args: { creatorWallets: v.array(v.string()) },
  handler: async (ctx, { creatorWallets }) => {
    const now = Date.now();
    const agents: { mint: string; name: string; avatar: string | null }[] = [];
    for (const wallet of [...new Set(creatorWallets.filter(Boolean))].slice(0, 8)) {
      const rows = await ctx.db.query("influencers").withIndex("by_creator", (q) => q.eq("creatorWallet", wallet)).take(20);
      for (const a of rows) agents.push({ mint: a.mintAddress, name: a.name, avatar: a.avatarUrl ?? null });
    }
    type Found = { id: string; taskId: Id<"agentTasks">; status: string; title: string; startedAt?: number; completedAt?: number; created: number; output?: string; errorMessage?: string; agent: (typeof agents)[number] };
    const tasks: Found[] = [];
    for (const agent of agents.slice(0, MAX_AGENTS)) {
      const live = (await Promise.all(["pending", "running"].map((status) =>
        ctx.db.query("agentTasks").withIndex("by_mint_status", (q) => q.eq("mintAddress", agent.mint).eq("status", status)).take(4)))).flat();
      const recent = await ctx.db.query("agentTasks").withIndex("by_mint", (q) => q.eq("mintAddress", agent.mint)).order("desc").take(8);
      const seen = new Set<string>();
      for (const t of [...live, ...recent]) {
        if (t.type !== "create_video" || seen.has(t._id)) continue;
        const active = t.status === "pending" || t.status === "running";
        const finished = t.status === "succeeded" || t.status === "failed";
        if (active && (t.startedAt ?? t._creationTime) < now - STALE_ACTIVE_MS) continue;
        if (!active && !(finished && (t.completedAt ?? t._creationTime) > now - RECENT_MS)) continue;
        seen.add(t._id);
        tasks.push({ id: t._id as string, taskId: t._id, status: t.status, title: t.title, startedAt: t.startedAt, completedAt: t.completedAt, created: t._creationTime, output: t.output, errorMessage: t.errorMessage, agent });
      }
    }
    tasks.sort((a, b) => (b.startedAt ?? b.created) - (a.startedAt ?? a.created));
    const out = [];
    for (const t of tasks.slice(0, MAX_JOBS)) {
      const active = t.status === "pending" || t.status === "running";
      const job = active ? await ctx.db.query("videoRenderJobs").withIndex("by_task", (q) => q.eq("taskId", t.taskId)).first() : null;
      let videoUrl: string | null = null, poster: string | null = job?.storyboardImageUrl ?? null;
      if (t.output) { try { const o = JSON.parse(t.output) as { videoUrl?: string; posterUrl?: string }; videoUrl = o.videoUrl ?? null; poster = o.posterUrl ?? poster; } catch { /* output is not JSON */ } }
      const state: VideoState = t.status === "succeeded" ? "done" : t.status === "failed" || t.status === "cancelled" ? "failed" : job && job.phase !== "failed" ? "rendering" : t.status === "pending" ? "queued" : "rendering";
      out.push({
        id: t.id, agentName: t.agent.name, agentAvatar: t.agent.avatar, mint: t.agent.mint, title: t.title, state,
        phase: job?.phase ?? (state === "done" ? "done" : "queued"),
        message: state === "failed" ? (t.errorMessage ?? "This video could not be finished.").slice(0, 140) : job?.statusMessage ?? (state === "queued" ? "Waiting to start" : "Starting up"),
        progress: progressOf(job ? { phase: job.phase, clipIndex: job.clipIndex, totalSegments: job.totalSegments } : null, t.status),
        startedAt: t.startedAt ?? t.created, updatedAt: job?.updatedAt ?? t.completedAt ?? t.startedAt ?? t.created,
        finishedAt: t.completedAt ?? null, videoUrl, poster,
      });
    }
    return out;
  },
});
