import { v } from "convex/values";
import { query } from "./_generated/server";

// ONE feed of everything the user has generated across the whole account:
//  - agent videos (create_video tasks on every agent they created),
//  - Content Swarm videos (tasks stamped sessionId "swarm:<privy id>"),
//  - Recreate videos (videoRecreateProjects by ownerId),
//  - Photo Carousels (carouselProjects by ownerId).
// Powers /generations. Read-only, bounded takes per source.

type Row = {
  id: string;
  kind: "agent" | "swarm" | "recreate" | "carousel" | "clip";
  title: string;
  videoUrl?: string;
  imageUrls?: string[];
  agentName?: string;
  createdAt: number;
  /** clip rows only: the source video this was cut from, so the UI can label
   *  it "Clip of <source>" instead of a bare unrelated "new video". */
  sourceUrl?: string;
};

function parseVideoOutput(output?: string): { videoUrl?: string; topic?: string; caption?: string } {
  if (!output) return {};
  try { return JSON.parse(output) as { videoUrl?: string; topic?: string; caption?: string }; } catch { return {}; }
}

export const listForUser = query({
  args: { creatorWallets: v.array(v.string()), privyUserId: v.string() },
  handler: async (ctx, { creatorWallets, privyUserId }) => {
    const rows: Row[] = [];
    const seenVideo = new Set<string>();
    const push = (r: Row) => {
      if (r.videoUrl) {
        if (seenVideo.has(r.videoUrl)) return;
        seenVideo.add(r.videoUrl);
      }
      rows.push(r);
    };

    // ── Own agents' generated videos ─────────────────────────────────────
    const wallets = [...new Set(creatorWallets.filter(Boolean))].slice(0, 8);
    const mints: { mintAddress: string; name: string }[] = [];
    for (const w of wallets) {
      const agents = await ctx.db
        .query("influencers")
        .withIndex("by_creator", (q) => q.eq("creatorWallet", w))
        .take(20);
      for (const a of agents) mints.push({ mintAddress: a.mintAddress, name: a.name });
    }
    for (const { mintAddress, name } of mints.slice(0, 15)) {
      const tasks = await ctx.db
        .query("agentTasks")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
        .order("desc")
        .take(80);
      for (const t of tasks) {
        if (t.type !== "create_video" || t.status !== "succeeded") continue;
        const o = parseVideoOutput(t.output);
        if (!o.videoUrl) continue;
        push({ id: t._id as string, kind: "agent", title: o.topic || o.caption || t.title || "Generated video", videoUrl: o.videoUrl, agentName: name, createdAt: t.completedAt ?? t._creationTime });
      }

      // ── Clips (clipping-pipeline output) ─────────────────────────────────
      // These are cut FROM a source video by clipJobs.jobId, not stand-alone
      // generations — tagged kind "clip" (with sourceUrl) instead of falling
      // through to "agent" so the feed doesn't show them as an unrelated new video.
      const clips = await ctx.db
        .query("clips")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
        .order("desc")
        .take(80);
      const jobIds = [...new Set(clips.filter((c) => c.status === "ready" || c.status === "posted" || c.status === "posting").map((c) => c.jobId))];
      const jobById = new Map<string, string | undefined>();
      for (const jobId of jobIds) {
        const job = await ctx.db.get(jobId);
        jobById.set(jobId as string, job?.sourceUrl);
      }
      for (const c of clips) {
        if (!c.clipUrl || (c.status !== "ready" && c.status !== "posted" && c.status !== "posting")) continue;
        push({ id: c._id as string, kind: "clip", title: c.title || c.captionText || "Clip", videoUrl: c.clipUrl, agentName: name, sourceUrl: jobById.get(c.jobId as string), createdAt: c.postedAt ?? c._creationTime });
      }
    }

    // ── Content Swarm videos ─────────────────────────────────────────────
    if (privyUserId) {
      const swarmTasks = await ctx.db
        .query("agentTasks")
        .withIndex("by_session", (q) => q.eq("sessionId", `swarm:${privyUserId}`))
        .order("desc")
        .take(200);
      for (const t of swarmTasks) {
        if (t.type !== "create_video" || t.status !== "succeeded") continue;
        const o = parseVideoOutput(t.output);
        if (!o.videoUrl) continue;
        push({ id: t._id as string, kind: "swarm", title: (t.title ?? "Swarm video").replace(/^Swarm: /, ""), videoUrl: o.videoUrl, createdAt: t.completedAt ?? t._creationTime });
      }

      // ── Recreate videos ────────────────────────────────────────────────
      const recreates = await ctx.db
        .query("videoRecreateProjects")
        .withIndex("by_owner", (q) => q.eq("ownerId", privyUserId))
        .order("desc")
        .take(40);
      for (const r of recreates) {
        if (r.phase !== "done" || !r.videoUrl) continue;
        push({ id: r._id as string, kind: "recreate", title: "Recreated video", videoUrl: r.videoUrl, createdAt: r.updatedAt ?? r._creationTime });
      }

      // ── Photo carousels ────────────────────────────────────────────────
      const carousels = await ctx.db
        .query("carouselProjects")
        .withIndex("by_owner", (q) => q.eq("ownerId", privyUserId))
        .order("desc")
        .take(40);
      for (const c of carousels) {
        const imgs = c.slides.map((s) => s.imageUrl).filter((u): u is string => !!u);
        if (imgs.length === 0) continue;
        push({ id: c._id as string, kind: "carousel", title: c.title || c.prompt.slice(0, 60), imageUrls: imgs, createdAt: c._creationTime });
      }
    }

    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 150);
  },
});
