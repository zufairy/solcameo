import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { jobArgs } from "./videoJobArgs";

/**
 * Latest *generated* videos (real MP4 renders, not YouTube links) for the
 * landing-page showcase. The comprehensive source is every succeeded
 * `create_video` task across ALL agents — its `output` JSON carries the rendered
 * `videoUrl`, the real `topic`, and a `storyboardImageUrl` poster. We also fold
 * in `videoRenderJobs` / `scheduledContent` for completeness, join each clip with
 * the agent that made it, dedupe by URL, and return the newest first — spread
 * across agents so the grid showcases the whole roster.
 */
export const listShowcaseVideos = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const max = limit ?? 6;

    type Raw = {
      mint: string;
      videoUrl: string;
      posterUrl?: string;
      topic?: string;
      createdAt: number;
    };
    const raws: Raw[] = [];

    // Primary source — succeeded create_video tasks (the full history, all agents).
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_status", (q) => q.eq("status", "succeeded"))
      .order("desc")
      .take(400);
    for (const t of tasks) {
      if (t.type !== "create_video" || !t.output) continue;
      let out: Record<string, unknown> | null = null;
      try { out = JSON.parse(t.output) as Record<string, unknown>; } catch { continue; }
      const videoUrl = typeof out?.videoUrl === "string" ? out.videoUrl : "";
      if (!videoUrl) continue;
      raws.push({
        mint: t.mintAddress,
        videoUrl,
        posterUrl: typeof out?.storyboardImageUrl === "string" ? out.storyboardImageUrl : undefined,
        topic: typeof out?.topic === "string" ? out.topic : undefined,
        createdAt: t.completedAt ?? t._creationTime,
      });
    }

    // Supplementary — durable render jobs + posted scheduled clips.
    const renders = await ctx.db.query("videoRenderJobs").order("desc").take(120);
    const scheduled = await ctx.db.query("scheduledContent").order("desc").take(120);
    for (const r of renders) {
      if (r.phase === "done" && r.videoUrl) {
        raws.push({ mint: r.mintAddress, videoUrl: r.videoUrl, posterUrl: r.storyboardImageUrl, topic: r.statusMessage, createdAt: r.updatedAt });
      }
    }
    for (const s of scheduled) {
      if (s.videoUrl) {
        raws.push({ mint: s.mintAddress, videoUrl: s.videoUrl, posterUrl: s.storyboardImageUrl, topic: s.topic, createdAt: s.postedAt ?? s.createdAt });
      }
    }

    raws.sort((a, b) => b.createdAt - a.createdAt);

    // Resolve the agent profile once per mint.
    const agentCache = new Map<
      string,
      { name: string; avatarUrl: string; handle: string; niche: string; agentType?: string; description?: string } | null
    >();
    const getAgent = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const a = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
        .first();
      const lite = a
        ? {
            name: a.name,
            avatarUrl: a.avatarUrl,
            handle: a.handle,
            niche: a.niche,
            agentType: a.agentType,
            description: a.description,
          }
        : null;
      agentCache.set(mint, lite);
      return lite;
    };

    // Build a card for every distinct generated clip (dedupe by video URL only).
    // We pass over the clips twice: first one-per-agent for a spread of creators,
    // then fill the rest with the remaining clips so a single prolific agent can
    // still fill the grid when few agents have rendered.
    const seenVideos = new Set<string>();
    const built: {
      row: {
        mint: string; name: string; handle: string; avatarUrl: string; niche: string;
        agentType: string; agentBio: string; videoUrl: string; posterUrl: string;
        topic: string; createdAt: number;
      };
      mint: string;
    }[] = [];
    for (const r of raws) {
      if (seenVideos.has(r.videoUrl)) continue;
      const agent = await getAgent(r.mint);
      if (!agent) continue;
      seenVideos.add(r.videoUrl);
      built.push({
        mint: r.mint,
        row: {
          mint: r.mint,
          name: agent.name,
          handle: agent.handle,
          avatarUrl: agent.avatarUrl,
          niche: agent.niche,
          agentType: agent.agentType ?? agent.niche ?? "creator",
          agentBio: agent.description ?? "",
          videoUrl: r.videoUrl,
          posterUrl: r.posterUrl ?? "",
          topic: r.topic ?? "",
          createdAt: r.createdAt,
        },
      });
    }

    const out: (typeof built)[number]["row"][] = [];
    const usedIdx = new Set<number>();
    const seenAgents = new Set<string>();
    // Pass 1 — one clip per agent.
    built.forEach((b, i) => {
      if (out.length >= max || seenAgents.has(b.mint)) return;
      seenAgents.add(b.mint);
      usedIdx.add(i);
      out.push(b.row);
    });
    // Pass 2 — fill remaining slots with leftover clips.
    built.forEach((b, i) => {
      if (out.length >= max || usedIdx.has(i)) return;
      out.push(b.row);
    });
    return out;
  },
});

// ─── Background video job ────────────────────────────────────────────────────
// The builder's create_video task generates a script synchronously (fast) then
// hands the slow storyboard → clips → stitch pipeline here. A 60s stitched
// video takes several minutes — longer than the 300s HTTP request limit — so it
// runs in a Convex action (10-minute budget, videoJobsGenerate.ts). The
// reactive `agentTasks` record drives the builder UI: it stays "running" until
// that job marks it succeeded/failed with the finished video URL.

/**
 * Public mutation called by /api/agents/run-task — schedules the video job to
 * run immediately in the background. Returns right away so the HTTP request
 * doesn't block on the multi-minute render.
 */
export const enqueue = mutation({
  args: jobArgs,
  handler: async (ctx, args) => {
    // The actual render lives in videoJobsGenerate.ts (a separate "use node"
    // file — generateVideoFromScript needs real Node APIs for ffmpeg exec,
    // which Convex only allows in a file carrying that directive).
    await ctx.scheduler.runAfter(0, internal.videoJobsGenerate.generate, args);
    return null;
  },
});
