import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { formatAgentDescription } from "../lib/agentDescription";
import { consumeSignature } from "./lib/payments";
import { ensureAgentAccount } from "./agentAccount";
import { uniqueHandleLower } from "./influencers";
import { enqueueAgentAnnouncement } from "./contentControl";
import { assertMintCapacity } from "./mintFee";

/**
 * Atomically commit this builder session's mint-fee reservation to its terminal
 * "minted" state (and stamp the mintAddress) IN THE SAME mutation that creates the
 * agent. Previously the promotion was a SEPARATE best-effort HTTP call
 * (mintFee.markMintCharged) that the /api/nft/mint route wraps in try/catch and
 * swallows; if it failed (Convex network/timeout/OCC), the fee row stayed
 * "claimed" with no mintAddress, aged out of the freebie count after CLAIM_TTL,
 * and the SAME wallet's next mint was wrongly re-granted FREE — a lost $50 for a
 * successfully-created agent. Doing it here makes "agent exists" and "fee row
 * committed" a single transaction. Gated on an EXISTING reservation for this
 * session, so internal/non-mint callers (which never reserved) are untouched.
 * Idempotent — a resume just re-confirms the already-minted row.
 */
async function commitMintFeeRow(ctx: MutationCtx, sessionId: string, mintAddress: string) {
  const feeRow = await ctx.db
    .query("agentMintCharges")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .first();
  if (!feeRow) return; // non-mint caller — nothing was reserved for this session
  if (feeRow.status === "minted" && feeRow.mintAddress === mintAddress) return; // already committed
  await ctx.db.patch(feeRow._id, { status: "minted", mintAddress });
}

const QUESTIONNAIRE_SHAPE = {
  backstory: v.optional(v.string()),
  traits: v.optional(v.array(v.string())),
  beliefs: v.optional(v.array(v.string())),
  catchphrase: v.optional(v.string()),
  dreamCollab: v.optional(v.string()),
  contentPillars: v.optional(v.array(v.string())),
  voiceArchetype: v.optional(v.string()),
  language: v.optional(v.string()),
  avoidTopics: v.optional(v.array(v.string())),
  audience: v.optional(v.string()),
};

export const saveDraft = mutation({
  args: {
    sessionId: v.string(),
    creatorWallet: v.optional(v.string()),
    name: v.string(),
    handle: v.optional(v.string()),
    niche: v.string(),
    characterBible: v.optional(v.string()),
    avatarUrls: v.array(v.string()),
    referencePhotoUrls: v.optional(v.array(v.string())),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // SECRET-GATED: the sole caller is the /api/nft/save-draft server route (it
    // transcodes + caps the avatars, then forwards INTERNAL_CRON_SECRET). Ungated,
    // anyone with the Convex URL could spam/forge draft rows directly, bypassing the
    // route's upload caps. The destructure keeps `authSecret` out of the persisted row.
    const { authSecret, ...rest } = args;
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const existing = await ctx.db
      .query("nftDrafts")
      .withIndex("by_session", (q) => q.eq("sessionId", rest.sessionId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, rest);
      return existing._id.toString();
    }
    const id = await ctx.db.insert("nftDrafts", {
      ...rest,
      questionnaire: {},
      mintStatus: "draft",
    });
    return id.toString();
  },
});

// RESIDUAL (left public, ungated): no live caller today (dead), and it only patches
// a pre-mint draft's questionnaire keyed by the opaque client-generated sessionId (a
// capability token an attacker cannot enumerate). Worst case is low-value draft
// tampering for a session whose id you already hold. If revived from a server route,
// gate it with INTERNAL_CRON_SECRET like the other nftAgents mutations.
export const updateQuestionnaire = mutation({
  args: {
    sessionId: v.string(),
    questionnaire: v.object(QUESTIONNAIRE_SHAPE),
    mintStatus: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, questionnaire, mintStatus }) => {
    const draft = await ctx.db
      .query("nftDrafts")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    if (!draft) return;
    await ctx.db.patch(draft._id, {
      questionnaire,
      ...(mintStatus ? { mintStatus } : {}),
    });
  },
});

export const completeMint = mutation({
  args: {
    sessionId: v.string(),
    mintTxSignature: v.string(),
    mintAddress: v.string(),
    creatorWallet: v.string(),
    // Allow caller to pass persona basics so we can create a draft if it's missing
    name: v.optional(v.string()),
    handle: v.optional(v.string()),
    niche: v.optional(v.string()),
    avatarUrls: v.optional(v.array(v.string())),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // SECRET-GATED: the sole caller is the /api/nft/mint server route, which proves
    // the mint tx + forwards INTERNAL_CRON_SECRET. Ungated, anyone could flip a draft
    // to "minted" / burn a signature against an arbitrary session.
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const draft = await ctx.db
      .query("nftDrafts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
    // IDEMPOTENT RESUME: if this session already minted, don't consume the fee
    // signature again (a retry after a post-mint failure would otherwise throw
    // "Transaction already processed" and dead-end, stranding a paid $50). Just
    // return so the caller can re-run the downstream steps (saveInfluencer).
    if (draft && draft.mintStatus === "minted" && draft.mintAddress) return;

    // Single-use mint proof: one paid mint transaction → one agent. Replaying
    // the same mintTxSignature throws here, so a single payment can't mint
    // unlimited agents (JOB-85).
    await consumeSignature(ctx, {
      txSignature: args.mintTxSignature,
      purpose: "nft_mint",
      ref: args.mintAddress,
    });
    if (draft) {
      await ctx.db.patch(draft._id, {
        mintStatus: "minted",
        mintTxSignature: args.mintTxSignature,
        mintAddress: args.mintAddress,
        creatorWallet: args.creatorWallet,
      });
      return;
    }
    // No draft yet — create one inline so the mint always succeeds
    await ctx.db.insert("nftDrafts", {
      sessionId: args.sessionId,
      creatorWallet: args.creatorWallet,
      name: args.name ?? "Unnamed Agent",
      handle: args.handle,
      niche: args.niche ?? "lifestyle",
      avatarUrls: args.avatarUrls ?? [],
      questionnaire: {},
      mintStatus: "minted",
      mintTxSignature: args.mintTxSignature,
      mintAddress: args.mintAddress,
    });
  },
});

export const saveInfluencer = mutation({
  args: {
    sessionId: v.string(),
    mintAddress: v.string(),
    creatorWallet: v.string(),
    name: v.string(),
    handle: v.string(),
    avatarUrl: v.string(),
    avatarStills: v.optional(v.array(v.string())),
    niche: v.string(),
    language: v.string(),
    archetype: v.string(),
    description: v.string(),
    agentType: v.optional(v.string()),
    agentWallet: v.optional(v.string()),
    agentWalletSecret: v.optional(v.string()),
    clipConfig: v.optional(v.any()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // SECRET-GATED: the sole caller is the /api/nft/mint server route (INTERNAL_CRON_SECRET).
    // Ungated, anyone could create/overwrite an agent record + seed its escrow wallet
    // for an arbitrary mint. The wallet backfill below is already write-once.
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    // Only persist usable still references: http(s) URLs that are NOT GIFs
    // (Kie's image/video models can't read GIFs or data: URIs).
    const stills = (args.avatarStills ?? []).filter(
      (u) => /^https?:\/\//i.test(u) && !/\.gif(\?|#|$)/i.test(u),
    );
    const existing = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress))
      .first();
    if (existing) {
      // The agent wallet is created once and is the owner's on-chain account —
      // NEVER overwrite an existing one (that would orphan any USDC/SOL held in
      // it). Only backfill the wallet if the record is missing one.
      const needsWallet = !existing.agentWallet;
      await ctx.db.patch(existing._id, {
        name: args.name,
        handle: args.handle,
        handleLower: await uniqueHandleLower(ctx, args.handle, existing._id),
        // Never CLOBBER a good avatar with an empty string (a later re-save / re-mint
        // with no http URL would otherwise wipe a working picture → "Forming…").
        avatarUrl: args.avatarUrl || existing.avatarUrl,
        niche: args.niche,
        language: args.language,
        archetype: args.archetype,
        description: formatAgentDescription(args),
        ...(args.agentType ? { agentType: args.agentType } : {}),
        ...(stills.length > 0 ? { avatarStills: stills } : {}),
        ...(needsWallet && args.agentWallet ? { agentWallet: args.agentWallet } : {}),
        ...(needsWallet && args.agentWalletSecret ? { agentWalletSecret: args.agentWalletSecret } : {}),
        ...(args.clipConfig ? { clipConfig: args.clipConfig } : {}),
        updatedAt: Date.now(),
      });
      await ensureAgentAccount(ctx, args.mintAddress);
      // Atomically commit the fee reservation now that the agent definitely exists,
      // so a failed best-effort markMintCharged can't re-grant this wallet a freebie.
      await commitMintFeeRow(ctx, args.sessionId, args.mintAddress);
      return existing._id;
    }
    await assertMintCapacity(ctx, args.sessionId, args.creatorWallet);
    const resolvedAgentType = args.agentType ?? "influencer";
    // Auto-install built-in skills based on agent type so the agent can act
    // out of the box. Influencers always get kie.video.generate so the
    // "make a video" copilot action works without operator setup.
    const defaultSkills: string[] =
      resolvedAgentType === "influencer"
        ? ["kie.video.generate", "ai.reasoning"]
        : resolvedAgentType === "worker"
          ? ["kie.video.generate", "ai.reasoning"]
          : [];
    const influencerId = await ctx.db.insert("influencers", {
      mintAddress: args.mintAddress,
      creatorWallet: args.creatorWallet,
      agentWallet: args.agentWallet,
      agentWalletSecret: args.agentWalletSecret,
      name: args.name,
      handle: args.handle,
      handleLower: await uniqueHandleLower(ctx, args.handle),
      avatarUrl: args.avatarUrl,
      avatarStills: stills.length > 0 ? stills : undefined,
      niche: args.niche,
      language: args.language,
      archetype: args.archetype,
      description: formatAgentDescription(args),
      agentType: resolvedAgentType,
      clipConfig: args.clipConfig,
      personality: { warmth: 70, humor: 60, authority: 65, boldness: 70 },
      tvl: 0,
      monthlyEarnings: 0,
      sharePrice: 1,
      totalShares: 1000,
      availableShares: 1000,
      installedSkills: defaultSkills,
      updatedAt: Date.now(),
    });
    await ensureAgentAccount(ctx, args.mintAddress);
    // Atomically commit the fee reservation now that the agent definitely exists,
    // so a failed best-effort markMintCharged can't re-grant this wallet a freebie.
    await commitMintFeeRow(ctx, args.sessionId, args.mintAddress);
    await enqueueAgentAnnouncement(ctx, args);
    return influencerId;
  },
});

/** Patches an existing minted influencer with the latest persona data from knowledge_building. */
export const updateInfluencerPersona = mutation({
  args: {
    mintAddress: v.string(),
    name: v.optional(v.string()),
    handle: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    niche: v.optional(v.string()),
    language: v.optional(v.string()),
    archetype: v.optional(v.string()),
    description: v.optional(v.string()),
    agentType: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, authSecret, ...patch }) => {
    // SECRET-GATED: the sole caller is the /api/builder/save-state server route
    // (INTERNAL_CRON_SECRET). Ungated, anyone could rewrite ANY minted agent's persona.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const existing = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!existing) return null;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next = { ...existing, ...clean };
    clean.description = formatAgentDescription(next);
    await ctx.db.patch(existing._id, { ...clean, updatedAt: Date.now() });
    return existing._id;
  },
});

/** Saves/updates session-level working state for resuming work later. */
export const saveWorkingState = mutation({
  args: {
    sessionId: v.string(),
    creatorWallet: v.optional(v.string()),
    name: v.optional(v.string()),
    handle: v.optional(v.string()),
    niche: v.optional(v.string()),
    characterBible: v.optional(v.string()),
    avatarUrls: v.optional(v.array(v.string())),
    questionnaire: v.optional(v.object(QUESTIONNAIRE_SHAPE)),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // SECRET-GATED: the sole caller is the /api/builder/save-state server route
    // (INTERNAL_CRON_SECRET). `payload` below is built from explicit fields, so
    // `authSecret` is never persisted into the draft row.
    if (!process.env.INTERNAL_CRON_SECRET || args.authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const existing = await ctx.db
      .query("nftDrafts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
    const payload = {
      sessionId: args.sessionId,
      creatorWallet: args.creatorWallet,
      name: args.name ?? existing?.name ?? "Unnamed Agent",
      handle: args.handle ?? existing?.handle,
      niche: args.niche ?? existing?.niche ?? "lifestyle",
      characterBible: args.characterBible ?? existing?.characterBible,
      avatarUrls: args.avatarUrls ?? existing?.avatarUrls ?? [],
      questionnaire: args.questionnaire ?? existing?.questionnaire ?? {},
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id.toString();
    }
    const id = await ctx.db.insert("nftDrafts", {
      ...payload,
      mintStatus: existing ? "draft" : "draft",
    });
    return id.toString();
  },
});

export const getBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("nftDrafts")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
  },
});

/** Find the working-state draft for a minted agent by its mint address. */
export const getDraftByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    return await ctx.db
      .query("nftDrafts")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
  },
});

/**
 * Full agent resume bundle — used by /builder?mint=... to restore everything:
 * influencer record + draft (persona) + knowledge entries.
 */
export const resumeByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) return null;

    const draft = await ctx.db
      .query("nftDrafts")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();

    const sessionId = draft?.sessionId ?? "";
    const knowledge = sessionId
      ? await ctx.db
          .query("agentKnowledge")
          .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
          .collect()
      : [];

    // For trader agents, include the saved strategy spec so the builder
    // can rehydrate the full trader block on resume.
    const strategy = await ctx.db
      .query("traderStrategies")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();

    const { agentWalletSecret: _agentWalletSecret, ...safeInfluencer } = influencer;
    return { influencer: safeInfluencer, draft, knowledge, sessionId, strategy };
  },
});
