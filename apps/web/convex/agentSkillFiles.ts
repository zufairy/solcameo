import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// RESIDUAL — the mutations below (upsert / setConfig / setWired / remove) are left
// public and ungated by design. They are called DIRECTLY from the clip canvas + skills
// marketplace (browser useMutation), so they cannot carry INTERNAL_CRON_SECRET, and
// there is no forgeable-proof-free ownership signal at the Convex layer (Convex has no
// native auth). Rows are keyed by the opaque client-generated sessionId (a capability
// token an attacker can't enumerate); the only cross-tenant vector is the PUBLIC
// mintAddress path, but a minted agent is LEGITIMATELY reconfigured from a different
// browser session, so a sessionId-match check would break that supported flow. Blast
// radius is limited to an agent's own generated-content skill config, which its owner
// reviews. Closing this properly requires SIWS session auth inside Convex (routing every
// canvas keystroke through a server endpoint) — deferred to keep the canvas working.

// List all skill MD files for a session
export const listBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("agentSkillFiles")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
  },
});

// List all skill MD files for a minted agent (used server-side at task time so
// the agent's authored skills drive script + storyboard generation).
export const listByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    return await ctx.db
      .query("agentSkillFiles")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
  },
});

// Get one skill MD by sessionId + skillId
export const getOne = query({
  args: { sessionId: v.string(), skillId: v.string(), mintAddress: v.optional(v.string()) },
  handler: async (ctx, { sessionId, skillId, mintAddress }) => {
    if (mintAddress) {
      const byMint = await ctx.db
        .query("agentSkillFiles")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
        .collect();
      const minted = byMint.find((r) => r.skillId === skillId);
      if (minted) return minted;
    }
    return await ctx.db
      .query("agentSkillFiles")
      .withIndex("by_session_skill", (q) =>
        q.eq("sessionId", sessionId).eq("skillId", skillId),
      )
      .first();
  },
});

// Upsert a skill MD file
export const upsert = mutation({
  args: {
    sessionId: v.string(),
    mintAddress: v.optional(v.string()),
    skillId: v.string(),
    title: v.string(),
    markdown: v.string(),
  },
  handler: async (ctx, args) => {
    let existing = args.mintAddress
      ? (await ctx.db
          .query("agentSkillFiles")
          .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress))
          .collect()).find((r) => r.skillId === args.skillId) ?? null
      : null;
    if (!existing) {
      existing = await ctx.db
        .query("agentSkillFiles")
        .withIndex("by_session_skill", (q) =>
          q.eq("sessionId", args.sessionId).eq("skillId", args.skillId),
        )
        .first();
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionId: args.sessionId,
        title: args.title,
        markdown: args.markdown,
        updatedAt: Date.now(),
        ...(args.mintAddress ? { mintAddress: args.mintAddress } : {}),
      });
      return existing._id;
    }
    return await ctx.db.insert("agentSkillFiles", {
      sessionId: args.sessionId,
      mintAddress: args.mintAddress,
      skillId: args.skillId,
      title: args.title,
      markdown: args.markdown,
      updatedAt: Date.now(),
    });
  },
});

// Persist a clip skill node's inspector config (captionPreset / captionPrompt /
// hookDurationSec / hookTemplateId) onto its installed-skill row, so the CLOUD
// auto-clip path (clipJobs.process) can read + apply it — the canvas graph is
// localStorage-only, so this row is the only cloud-visible per-skill store.
// Patches the EXISTING row (the skill must already be installed); no-op when the
// skill isn't installed (the cloud wouldn't use it anyway).
export const setConfig = mutation({
  args: {
    sessionId: v.string(),
    skillId: v.string(),
    config: v.any(),
    mintAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Prefer the mint lookup (the key the cloud reads by) so a minted agent
    // reconfigured in a different browser session still patches the right row;
    // fall back to the session+skill key (pre-mint / same-session).
    let existing = args.mintAddress
      ? (await ctx.db
          .query("agentSkillFiles")
          .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress))
          .collect()).find((r) => r.skillId === args.skillId) ?? null
      : null;
    if (!existing) {
      existing = await ctx.db
        .query("agentSkillFiles")
        .withIndex("by_session_skill", (q) =>
          q.eq("sessionId", args.sessionId).eq("skillId", args.skillId),
        )
        .first();
    }
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      config: args.config,
      updatedAt: Date.now(),
      ...(args.mintAddress ? { mintAddress: args.mintAddress } : {}),
    });
    return existing._id;
  },
});

// Canvas-synced wired flag: true when a skill NODE exists on the graph for this
// skillId, false when removed. Patches the EXISTING installed row only (no-op if
// not installed — an uninstalled skill has nothing to flag). Mint-preferred
// lookup so a minted agent reconfigured in another session patches the right row.
export const setWired = mutation({
  args: {
    sessionId: v.string(),
    skillId: v.string(),
    wired: v.boolean(),
    mintAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let existing = args.mintAddress
      ? (await ctx.db
          .query("agentSkillFiles")
          .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress))
          .collect()).find((r) => r.skillId === args.skillId) ?? null
      : null;
    if (!existing) {
      existing = await ctx.db
        .query("agentSkillFiles")
        .withIndex("by_session_skill", (q) =>
          q.eq("sessionId", args.sessionId).eq("skillId", args.skillId),
        )
        .first();
    }
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      wired: args.wired,
      updatedAt: Date.now(),
      ...(args.mintAddress ? { mintAddress: args.mintAddress } : {}),
    });
    return existing._id;
  },
});

// Delete a skill MD
export const remove = mutation({
  args: { id: v.id("agentSkillFiles") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
