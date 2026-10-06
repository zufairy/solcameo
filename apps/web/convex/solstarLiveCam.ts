import { v } from "convex/values";
import { query } from "./_generated/server";

const media = (value: unknown): string | null => typeof value === "string" && (/^https:\/\//.test(value) || /^\/(?!\/)/.test(value)) ? value : null;

/** Public activity projection: no task inputs, provider IDs, errors or private prompts. */
export const state = query({
  args: { characterId: v.id("ssCharacters") },
  handler: async (ctx, { characterId }) => {
    const character = await ctx.db.get(characterId);
    if (character?.status !== "approved") return null;
    const token = await ctx.db.query("ssTokens").withIndex("by_character", q => q.eq("characterId", characterId)).first();
    const [tasks, rounds, messages, jobs, episodes] = await Promise.all([
      ctx.db.query("agentTasks").withIndex("by_mint", q => q.eq("mintAddress", characterId)).order("desc").take(30),
      ctx.db.query("ssCommunityRounds").withIndex("by_character_window", q => q.eq("characterId", characterId)).order("desc").take(5),
      ctx.db.query("ssCommunityMessages").withIndex("by_character_created", q => q.eq("characterId", characterId)).order("desc").take(4),
      token ? ctx.db.query("ssContentJobs").withIndex("by_token", q => q.eq("tokenId", token._id)).order("desc").take(5) : [],
      token ? ctx.db.query("ssEpisodes").withIndex("by_token", q => q.eq("tokenId", token._id)).order("desc").take(20) : [],
    ]);
    const videos = episodes.flatMap(episode => {
      const url = episode.source === "generated" ? media(episode.videoUrl) : null;
      return url ? [{ url, poster: media(episode.posterUrl), title: episode.title, createdAt: episode.createdAt }] : [];
    });
    for (const job of jobs) if (job.status === "complete" && media(job.videoUrl)) videos.push({ url: media(job.videoUrl)!, poster: null, title: "Latest finished video", createdAt: job.updatedAt });
    for (const task of tasks) {
      if (task.type !== "create_video" || task.status !== "succeeded" || !task.output) continue;
      try {
        const output = JSON.parse(task.output);
        const url = media(output.videoUrl);
        if (url) videos.push({ url, poster: media(output.posterUrl), title: "Latest finished video", createdAt: task.completedAt ?? task._creationTime });
      } catch { /* An incomplete output cannot become a playable video. */ }
    }
    const latestVideo = videos.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    const job = jobs.find(item => ["reserved", "submitting", "running", "unknown"].includes(item.status));
    const task = tasks.find(item => item.status === "running");
    const reading = rounds.find(round => round.status === "running" && round.leaseUntil > Date.now());
    const queued = tasks.find(item => ["pending", "awaiting_approval"].includes(item.status));
    let activity: { kind: string; label: string; until: number | null };
    if (job) activity = { kind: job.status === "unknown" ? "attention" : "generating", label: job.status === "unknown" ? "Checking render status" : job.status === "reserved" ? "Preparing video" : "Generating video", until: null };
    else if (task) activity = { kind: task.type === "create_video" ? "generating" : "working", label: task.type === "create_video" ? "Generating video" : task.type === "post_content" ? "Publishing content" : "Working on a task", until: null };
    else if (reading) activity = { kind: "reading", label: "Reading community chat", until: reading.leaseUntil };
    else if (queued) activity = { kind: "waiting", label: queued.status === "awaiting_approval" ? "Waiting for approval" : "Task queued", until: null };
    else activity = { kind: latestVideo ? "video" : "idle", label: latestVideo ? "Latest finished video" : "Waiting for the next task", until: null };
    return { activity, latestVideo, messages: messages.reverse().map(message => ({ id: message._id, body: message.body.slice(0, 160), role: message.role })) };
  },
});
