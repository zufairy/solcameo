import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Caps bound the doc size: 200 messages × 2,000 chars ≈ 400 KB for ASCII
// content (the dominant case). All-4-byte Unicode could reach ~1.5 MB and
// fail the 1 MB doc limit — acceptable for fire-and-forget telemetry; a
// hardening pass could trim by byte count instead of char count.
export const MAX_MESSAGES = 200;
export const MAX_CONTENT_CHARS = 2_000;

/**
 * Upsert a builder chat transcript, keyed by sessionId. Called (debounced,
 * fire-and-forget) from /builder whenever a wallet is connected. Follows the
 * same public-mutation-keyed-by-sessionId trust model as agentKnowledge.
 */
export const sync = mutation({
  args: {
    sessionId: v.string(),
    wallet: v.string(),
    agentType: v.optional(v.string()),
    projectName: v.optional(v.string()),
    mintAddress: v.optional(v.string()),
    messages: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      at: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    if (args.messages.length === 0) return { ok: true as const }; // nothing to persist

    const trimmed = args.messages.slice(-MAX_MESSAGES).map((m) => ({
      role: m.role,
      content: m.content.slice(0, MAX_CONTENT_CHARS),
      at: m.at,
    }));
    const lastActivityAt = trimmed[trimmed.length - 1].at;

    const existing = await ctx.db
      .query("builderSessions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (existing) {
      // Sync is fire-and-forget from the browser. A slower, older request can
      // arrive after a newer one; never let that stale snapshot remove the
      // user's latest message or the AI reply that followed it.
      if (args.messages.length < existing.messageCount) {
        await ctx.db.patch(existing._id, {
          wallet: args.wallet === "anonymous" && existing.wallet && existing.wallet !== "anonymous"
            ? existing.wallet
            : args.wallet,
          agentType: args.agentType ?? existing.agentType,
          projectName: args.projectName ?? existing.projectName,
          mintAddress: args.mintAddress ?? existing.mintAddress,
        });
        return { ok: true as const };
      }
      await ctx.db.patch(existing._id, {
        // Pre-connect syncs send "anonymous" — never downgrade a real wallet
        // we already captured for this session.
        wallet: args.wallet === "anonymous" && existing.wallet && existing.wallet !== "anonymous"
          ? existing.wallet
          : args.wallet,
        // A later sync omitting these must not erase what we know.
        agentType: args.agentType ?? existing.agentType,
        projectName: args.projectName ?? existing.projectName,
        mintAddress: args.mintAddress ?? existing.mintAddress,
        messages: trimmed,
        messageCount: args.messages.length,
        lastActivityAt,
      });
      return { ok: true as const };
    }

    await ctx.db.insert("builderSessions", {
      sessionId: args.sessionId,
      wallet: args.wallet,
      agentType: args.agentType,
      projectName: args.projectName,
      mintAddress: args.mintAddress,
      messages: trimmed,
      messageCount: args.messages.length,
      startedAt: args.messages[0].at,
      lastActivityAt,
    });
    return { ok: true as const };
  },
});
