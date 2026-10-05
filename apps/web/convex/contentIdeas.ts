import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendTasteEvent } from "./tasteEvents";

const MACHINE_STATUSES = new Set(["producing", "produced", "expired"]);
const USER_STATUSES = new Set(["approved", "rejected", "proposed"]);
const SOURCES = new Set(["news", "evergreen", "series", "user"]);
const INTENTS = new Set(["entertain", "value", "promo"]);

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function nearDuplicate(a: string, b: string): boolean {
  const ka = normalizeKey(a), kb = normalizeKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}
function requireSecret(authSecret: string | undefined) {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

async function expireStaleForMint(ctx: MutationCtx, mintAddress: string): Promise<number> {
  const now = Date.now();
  const proposed = await ctx.db.query("contentIdeas")
    .withIndex("by_mint_status", (q) => q.eq("mintAddress", mintAddress).eq("status", "proposed"))
    .take(100);
  let expired = 0;
  for (const row of proposed) {
    if (row.expiresAt && row.expiresAt <= now) {
      await ctx.db.patch(row._id, { status: "expired" });
      // Repeatedly letting ideas expire unpicked is a mild disinterest signal.
      await appendTasteEvent(ctx, {
        mintAddress, kind: "idea_expired", detail: row.headline, weight: 1,
      });
      expired++;
    }
  }
  return expired;
}

/** Insert a batch of idea candidates (from ideation or the copilot), skipping
 *  near-duplicate headlines vs the last 14 days. User-pitched ideas arrive
 *  pre-approved — the operator asked for them explicitly. */
export const insertBatch = mutation({
  args: { mintAddress: v.string(), ideas: v.array(v.any()), authSecret: v.string() },
  handler: async (ctx, { mintAddress, ideas, authSecret }) => {
    requireSecret(authSecret);
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    const recent = await ctx.db.query("contentIdeas")
      .withIndex("by_mint_created", (q) => q.eq("mintAddress", mintAddress).gte("createdAt", cutoff))
      .take(200);
    const existingHeads = recent.map((r) => r.headline);
    let inserted = 0;
    for (const rawIdea of ideas.slice(0, 12)) {
      const r = (rawIdea && typeof rawIdea === "object" ? rawIdea : {}) as Record<string, unknown>;
      const headline = String(r.headline ?? "").trim().slice(0, 160);
      const angle = String(r.angle ?? "").trim().slice(0, 500);
      const source = SOURCES.has(String(r.source)) ? String(r.source) : "evergreen";
      if (!headline || !angle) continue;
      if (existingHeads.some((h) => nearDuplicate(h, headline))) continue;
      await ctx.db.insert("contentIdeas", {
        mintAddress, headline, angle,
        whyNow: typeof r.whyNow === "string" && r.whyNow.trim() ? r.whyNow.slice(0, 300) : undefined,
        source,
        sourceRefs: Array.isArray(r.sourceRefs) ? (r.sourceRefs as unknown[]).map(String).slice(0, 5) : undefined,
        newsFacts: Array.isArray(r.newsFacts) ? (r.newsFacts as unknown[]).map(String).slice(0, 8) : undefined,
        referenceImageUrl: typeof r.referenceImageUrl === "string" && /^https?:\/\//i.test(r.referenceImageUrl) ? r.referenceImageUrl : undefined,
        format: String(r.format ?? "talking-head").slice(0, 60) || "talking-head",
        ...(typeof r.styleId === "string" && r.styleId.trim() ? { styleId: r.styleId.trim().slice(0, 60) } : {}),
        intent: INTENTS.has(String(r.intent)) ? String(r.intent) : "entertain",
        ...(typeof r.campaignId === "string" && r.campaignId.trim()
          ? { campaignId: r.campaignId.trim().slice(0, 80), campaignTitle: String(r.campaignTitle ?? "").slice(0, 120) || undefined }
          : {}),
        suggestedDurationSec: Math.max(5, Math.min(60, Math.round(Number(r.suggestedDurationSec ?? 24)) || 24)),
        score: Math.max(0, Math.min(100, Math.round(Number(r.score ?? 50)) || 0)),
        status: source === "user" ? "approved" : "proposed",
        expiresAt: typeof r.expiresAt === "number" ? r.expiresAt : (source === "news" ? Date.now() + 24 * 3600 * 1000 : undefined),
        createdAt: Date.now(),
      });
      existingHeads.push(headline);
      inserted++;
    }
    return { inserted };
  },
});

/** Full queue for the Ideas tab, newest first. */
export const listForMint = query({
  args: { mintAddress: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { mintAddress, limit }) => {
    return await ctx.db.query("contentIdeas")
      .withIndex("by_mint_created", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .take(limit ?? 50);
  },
});

/** Producible pool: approved first (operator's word, FIFO downstream), then
 *  proposed by score. Expired ideas never appear. */
export const listFreshProposed = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const now = Date.now();
    const rows: Doc<"contentIdeas">[] = [];
    for (const status of ["approved", "proposed"]) {
      const batch = await ctx.db.query("contentIdeas")
        .withIndex("by_mint_status", (q) => q.eq("mintAddress", mintAddress).eq("status", status))
        .take(50);
      rows.push(...batch.filter((r) => !r.expiresAt || r.expiresAt > now));
    }
    return rows.sort((a, b) =>
      (a.status === "approved" ? 0 : 1) - (b.status === "approved" ? 0 : 1) || b.score - a.score);
  },
});

export const setFeedback = mutation({
  args: { ideaId: v.id("contentIdeas"), feedback: v.string() },
  handler: async (ctx, { ideaId, feedback }) => {
    if (feedback !== "up" && feedback !== "down") throw new Error("invalid feedback");
    await ctx.db.patch(ideaId, { feedback });
    const idea = await ctx.db.get(ideaId);
    if (idea) {
      await appendTasteEvent(ctx, {
        mintAddress: idea.mintAddress,
        kind: feedback === "up" ? "idea_up" : "idea_down",
        detail: `${idea.headline} — ${idea.angle}`,
        weight: 2,
      });
    }
    return null;
  },
});

/** Status transitions. Machine statuses (producing/produced/expired) are
 *  secret-gated; user statuses (approved/rejected/proposed) are the Ideas tab's
 *  one-tap actions. */
export const setStatus = mutation({
  args: {
    ideaId: v.id("contentIdeas"),
    status: v.string(),
    authSecret: v.optional(v.string()),
    producedTaskId: v.optional(v.string()),
  },
  handler: async (ctx, { ideaId, status, authSecret, producedTaskId }) => {
    const isMachine = MACHINE_STATUSES.has(status);
    if (isMachine) requireSecret(authSecret);
    else if (!USER_STATUSES.has(status)) throw new Error("invalid status");
    const idea = await ctx.db.get(ideaId);
    await ctx.db.patch(ideaId, {
      status,
      ...(producedTaskId ? { producedTaskId } : {}),
    });
    // A user approval ("make next" / 👍-approve) is a strong taste signal.
    if (!isMachine && status === "approved" && idea && idea.status !== "approved") {
      await appendTasteEvent(ctx, {
        mintAddress: idea.mintAddress,
        kind: "idea_made_now",
        detail: `${idea.headline} — ${idea.angle}`,
        weight: 3,
      });
    }
    return null;
  },
});

export const updateAngle = mutation({
  args: { ideaId: v.id("contentIdeas"), headline: v.optional(v.string()), angle: v.optional(v.string()) },
  handler: async (ctx, { ideaId, headline, angle }) => {
    await ctx.db.patch(ideaId, {
      ...(headline?.trim() ? { headline: headline.trim().slice(0, 160) } : {}),
      ...(angle?.trim() ? { angle: angle.trim().slice(0, 500) } : {}),
      editedByUser: true,
    });
    const idea = await ctx.db.get(ideaId);
    if (idea && (headline?.trim() || angle?.trim())) {
      await appendTasteEvent(ctx, {
        mintAddress: idea.mintAddress,
        kind: "idea_edited",
        detail: `edited to: ${headline?.trim() || idea.headline} — ${angle?.trim() || idea.angle}`,
        weight: 2,
      });
    }
    return null;
  },
});

/** Flip past-TTL proposed ideas to "expired". Internal (Convex-side callers). */
export const expireStale = internalMutation({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    return { expired: await expireStaleForMint(ctx, mintAddress) };
  },
});

/** Same as expireStale, callable from the Next idea pipeline (public + secret). */
export const expireStalePublic = mutation({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }) => {
    requireSecret(authSecret);
    return { expired: await expireStaleForMint(ctx, mintAddress) };
  },
});
