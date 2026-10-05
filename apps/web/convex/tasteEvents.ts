import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { normalizeShowBible } from "../lib/builder/showBible";
import { formatById } from "../lib/builder/formatCatalog";

/** Shared helper — other mutations (contentIdeas feedback/edits/expiry) log
 *  taste signals through this so the pipeline's updater can fold them into the
 *  agent's taste-profile prose. Same-transaction insert, never a runMutation. */
export async function appendTasteEvent(
  ctx: MutationCtx,
  args: { mintAddress: string; kind: string; detail: string; weight: number },
): Promise<void> {
  await ctx.db.insert("tasteEvents", {
    mintAddress: args.mintAddress,
    kind: args.kind,
    detail: args.detail.slice(0, 300),
    weight: args.weight,
    consumed: false,
    createdAt: Date.now(),
  });
}

/** Pop up to 20 unconsumed events (marks them consumed). Secret-gated — called
 *  by the Next idea pipeline before ideation. */
export const takeUnconsumed = mutation({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const rows = await ctx.db.query("tasteEvents")
      .withIndex("by_mint_consumed", (q) => q.eq("mintAddress", mintAddress).eq("consumed", false))
      .take(20);
    // The idea pipeline only folds feedback into the taste-profile prose when it
    // has >=3 events (ideaPipeline.ts: `if (events.length >= 3)`). Marking fewer
    // than that "consumed" here would silently discard them — they'd never be
    // folded (the pipeline drops a <3 batch) and never be seen again (consumed =
    // excluded from every future take). Leave them unconsumed so they accumulate
    // across heartbeats until there's enough to fold.
    if (rows.length < 3) return [];
    for (const r of rows) await ctx.db.patch(r._id, { consumed: true });
    return rows.map((r) => ({ kind: r.kind, detail: r.detail, weight: r.weight }));
  },
});

/** Operator rated a rendered video (👍/👎). Two effects in ONE transaction:
 *  a taste event (folded into the taste-profile prose by the idea pipeline's
 *  existing updater) and a rotation-weight nudge on the rated format's
 *  videoStyles entry so 👍 formats come up more and 👎 formats less.
 *  Secret-gated: the Next route proves agent ownership then injects the secret. */
export const recordVideoFeedback = mutation({
  args: {
    mintAddress: v.string(),
    verdict: v.union(v.literal("up"), v.literal("down")),
    formatId: v.optional(v.string()),
    reason: v.optional(v.string()),
    videoTitle: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, verdict, formatId: formatIdIn, reason, videoTitle, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    // Cap defensively before it ever touches a detail string or a lookup key —
    // an unbounded client-supplied formatId could otherwise inflate the taste
    // event detail (already capped at 300 by appendTasteEvent, but cheaper to
    // never build the oversized string) or, more importantly, guarantee a
    // catalog miss below for what should have been a normal id.
    const formatId = formatIdIn ? formatIdIn.slice(0, 80) : undefined;
    const detail = [
      verdict === "up" ? "operator liked the video" : "operator disliked the video",
      videoTitle ? `"${videoTitle.slice(0, 120)}"` : null,
      formatId ? `format: ${formatId}` : null,
      reason ? `what's off: ${reason.slice(0, 40)}` : null,
    ].filter(Boolean).join(" — ");
    await appendTasteEvent(ctx, { mintAddress, kind: verdict === "up" ? "video_up" : "video_down", detail, weight: verdict === "up" ? 2 : 3 });

    // Weight nudge — only when the rated format is BOTH a known catalog format
    // (formatById) AND a rotation style already on this agent's bible. An
    // unknown/garbage formatId (typo, stale id from a removed catalog entry, or
    // a hostile client) still logs the taste event above but never touches
    // showBible — event only.
    let weightChange: string | undefined;
    if (formatId && formatById(formatId)) {
      const agent = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).first();
      const bible = agent ? normalizeShowBible(agent.showBible) : null;
      const styles = bible?.videoStyles ?? [];
      const idx = styles.findIndex((s) => s.id === formatId);
      if (agent && bible && idx >= 0) {
        const cur = styles[idx].weight ?? 1;
        const next = verdict === "up" ? Math.min(10, cur + 1) : Math.max(1, cur - 1);
        if (next !== cur) {
          styles[idx] = { ...styles[idx], weight: next };
          const merged = { ...bible, videoStyles: styles };
          const normalizedMerged = normalizeShowBible(merged);
          if (normalizedMerged) {
            // Bump `version` past the stored one, same as influencers.setShowBible
            // (convex/influencers.ts:414-416) — every showBible write goes through
            // this same monotonic-version contract, direct patch or not.
            const prevVersion = Number((agent.showBible as { version?: number } | undefined)?.version ?? 0);
            normalizedMerged.version = Math.max(normalizedMerged.version, prevVersion + 1);
            await ctx.db.patch(agent._id, { showBible: normalizedMerged, updatedAt: Date.now() });
            weightChange = `${formatId} weight ${cur} → ${next}`;
          }
        }
      }
    }
    return { ok: true as const, ...(weightChange ? { weightChange } : {}) };
  },
});

/** Server-side event append (secret-gated) — for performance signals written
 *  from Next routes (posted-video view syncs, clip deletions). */
export const appendPublic = mutation({
  args: { mintAddress: v.string(), kind: v.string(), detail: v.string(), weight: v.number(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, kind, detail, weight, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    await appendTasteEvent(ctx, { mintAddress, kind, detail, weight: Math.max(1, Math.min(5, weight)) });
    return null;
  },
});
