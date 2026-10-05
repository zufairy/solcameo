import { query, mutation, internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { consumeSignature } from "./lib/payments";
import { resolveIntervalMs, videosPerDayToCron, evaluateHeartbeatClaim, cronForMinGapHours, nextHeartbeatFireAt } from "../lib/builder/heartbeatSchedule";
import { normalizeShowBible, normalizeRotationState } from "../lib/builder/showBible";
import { normalizeClipConfig } from "../lib/builder/clipConfig";
import { allocatePostingSlot } from "../lib/builder/campaignPosting";
import { formatAgentDescription } from "../lib/agentDescription";

/** Strip the private key AND override the denormalized `tvl` with the agent's
 *  REAL locked USDC. `influencers.tvl` has no live writer — actual capital is
 *  credited to `agentAccount.escrowUsdc` (shares.buyShares / earnings.creditEarnings)
 *  and reconciled to the on-chain balance — so every owner/market read must source
 *  TVL from escrow, not the dead column. Per-creator agent counts are small, so the
 *  per-row by_mint point-lookup is cheap. Returns rows WITHOUT agentWalletSecret. */
async function withRealTvl(ctx: QueryCtx, docs: Doc<"influencers">[]) {
  return Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit agentWalletSecret from the public payload
    docs.map(async ({ agentWalletSecret: _omit, ...rest }) => {
      const acct = await ctx.db
        .query("agentAccount")
        .withIndex("by_mint", (q) => q.eq("mintAddress", rest.mintAddress))
        .unique();
      const token = rest.solstarTokenId ? await ctx.db.get(rest.solstarTokenId) : null;
      return { ...rest, tvl: acct ? acct.escrowUsdc : rest.tvl, coinTicker: token?.ticker };
    }),
  );
}

/** Batched mint→escrowUsdc map. Use for WHOLE-TABLE reads (listAll, getMarketStats)
 *  where a per-row by_mint lookup would be O(n) point reads; the per-creator reads
 *  (listByCreator/listByCreators) use withRealTvl's small per-row lookups instead. */
async function escrowByMint(ctx: QueryCtx): Promise<Map<string, number>> {
  const accounts = await ctx.db.query("agentAccount").collect();
  return new Map(accounts.map((a) => [a.mintAddress, a.escrowUsdc] as const));
}

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("influencers").order("desc").collect();
    const escrow = await escrowByMint(ctx); // real TVL, consistent with listByCreator(s)/getMarketStats
    // Omit agentWalletSecret (private) and followerHistory (up to 200 samples per
    // agent — only the server needs it for the 24h delta) from the public payload.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return docs.map(({ agentWalletSecret: _, followerHistory: _h, ...rest }) => ({
      ...rest,
      tvl: escrow.get(rest.mintAddress) ?? rest.tvl,
    }));
  },
});

/** Projected rows for the nav's agent search — the ONLY fields the dropdown
 *  renders. AgentSearch mounts on every route, so subscribing it to listAll
 *  re-pushed every full persona doc + a whole-table agentAccount escrow join to
 *  every open client on any influencers/agentAccount write. This projection
 *  drops both: no escrow join (the dropdown never shows TVL) and ~95% smaller
 *  rows, so the subscription only re-fires with data the search actually uses. */
export const listSearchable = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("influencers").order("desc").collect();
    const tickers = await Promise.all(docs.map(async (d) => (d.solstarTokenId ? (await ctx.db.get(d.solstarTokenId))?.ticker : undefined)));
    return docs.map((d, i) => ({
      _id: d._id,
      mintAddress: d.mintAddress,
      name: d.name,
      handle: d.handle,
      ticker: tickers[i],
      niche: d.niche,
      agentType: d.agentType,
      avatarUrl: d.avatarUrl,
      lifetimeEarningsUsdc: d.lifetimeEarningsUsdc,
      monthlyEarnings: d.monthlyEarnings,
    }));
  },
});

/** Just the mint addresses of every minted influencer — lighter than listAll
 *  (no escrow join, no persona fields) for callers that only need to know
 *  WHICH agents exist, e.g. the analytics view-sync cron (crons.ts). */
export const listAllMintAddresses = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("influencers").order("desc").collect();
    return docs.map((d) => d.mintAddress).filter((m): m is string => !!m);
  },
});

/** INTERNAL_CRON_SECRET-gated single-agent delete — removes the influencers row +
 *  its agentAccount so the agent disappears from the marketplace. The Next route
 *  /api/agents/delete pairs this with freeing the agent's upload-post profile slot.
 *  Derived clip/economy rows are left orphaned (harmless — no influencers row points
 *  at them; devWipe does a full reset). */
export const deleteByMint = mutation({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    let deleted = 0;
    // Keep the audit ledger, but release the slot and prevent a deleted session
    // from being resumed into a new agent.
    for await (const draft of ctx.db.query("nftDrafts").withIndex("by_mint", q => q.eq("mintAddress", mintAddress))) {
      await ctx.db.patch(draft._id, { mintStatus: "deleted" });
      const charge = await ctx.db.query("agentMintCharges").withIndex("by_session", q => q.eq("sessionId", draft.sessionId)).first();
      if (charge) await ctx.db.patch(charge._id, { status: "deleted" });
    }
    for await (const charge of ctx.db.query("agentMintCharges").withIndex("by_mint", q => q.eq("mintAddress", mintAddress))) {
      if (charge.status !== "deleted") await ctx.db.patch(charge._id, { status: "deleted" });
    }

    const inf = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).first();
    if (inf) { await ctx.db.delete(inf._id); deleted++; }
    const acct = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).first();
    if (acct) { await ctx.db.delete(acct._id); deleted++; }
    // CASCADE: remove the agent's owned rows so nothing is orphaned after delete.
    // Every table below is keyed by_mint on mintAddress; per-agent counts are small
    // (well under a single mutation's read/write budget).
    for (const r of await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect()) { await ctx.db.delete(r._id); deleted++; }
    for (const r of await ctx.db.query("clipJobs").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect()) { await ctx.db.delete(r._id); deleted++; }
    for (const r of await ctx.db.query("scheduledContent").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect()) { await ctx.db.delete(r._id); deleted++; }
    for (const r of await ctx.db.query("agentSkillFiles").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect()) { await ctx.db.delete(r._id); deleted++; }
    for (const r of await ctx.db.query("clipGraphs").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect()) { await ctx.db.delete(r._id); deleted++; }
    for (const r of await ctx.db.query("agentTasks").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect()) { await ctx.db.delete(r._id); deleted++; }
    return { ok: true, deleted };
  },
});

export const getByMint = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const doc = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!doc) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to omit agentWalletSecret from the public payload
    const { agentWalletSecret: _, ...rest } = doc;
    // Real TVL = the agent's escrow vault (consistent with every other read path).
    const acct = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .unique();
    return { ...rest, tvl: acct ? acct.escrowUsdc : rest.tvl };
  },
});

/** "@Foo_Bar" / " Foo_Bar " → "foo_bar" — the canonical form stored in
 *  `handleLower` and matched against for /market/<handle> lookups. */
export function normalizeHandleLower(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

/** Resolves a collision-free `handleLower` for `handle` — auto-suffixes
 *  (-2, -3, …) if another agent already has it. `excludeId` lets re-saving
 *  the SAME agent keep its existing slug instead of colliding with itself. */
export async function uniqueHandleLower(
  ctx: { db: QueryCtx["db"] },
  handle: string,
  excludeId?: Doc<"influencers">["_id"],
): Promise<string> {
  const base = normalizeHandleLower(handle) || "agent";
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const hit = await ctx.db
      .query("influencers")
      .withIndex("by_handle_lower", (q) => q.eq("handleLower", candidate))
      .first();
    if (!hit || hit._id === excludeId) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

/** /market/<handle> — the public profile URL's lookup. */
export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const handleLower = normalizeHandleLower(handle);
    const doc = await ctx.db
      .query("influencers")
      .withIndex("by_handle_lower", (q) => q.eq("handleLower", handleLower))
      .first();
    if (!doc) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to omit agentWalletSecret from the public payload
    const { agentWalletSecret: _, ...rest } = doc;
    const acct = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", rest.mintAddress))
      .unique();
    return { ...rest, tvl: acct ? acct.escrowUsdc : rest.tvl };
  },
});

/**
 * Set the agent's client-facing monetization config (Marketplace Hiring +
 * Charge Per Video builder skills). Patches only the provided fields.
 */
export const setMonetization = mutation({
  args: {
    mintAddress: v.string(),
    monetization: v.object({
      hiringEnabled: v.optional(v.boolean()),
      videosPerMonth: v.optional(v.number()),
      monthlyRate: v.optional(v.number()),
      perVideoEnabled: v.optional(v.boolean()),
      costPerVideo: v.optional(v.number()),
      requirementPrompt: v.optional(v.string()),
    }),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, monetization, authSecret }) => {
    // SECRET-GATED: client callers route through /api/agents/config (SIWS-owner-gated),
    // which injects the secret. Ungated, anyone with the Convex URL could overwrite
    // ANY agent's monetization config.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const doc = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!doc) throw new Error("Agent not found");
    await ctx.db.patch(doc._id, {
      monetization: { ...(doc.monetization ?? {}), ...monetization },
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Persist the agent's Video Director config. Also maps videosPerDay onto the
 * heartbeat cadence (heartbeatCron + heartbeatNextFireAt) so "N videos/day"
 * actually drives auto-posting.
 */
// Minimal defaults so a first-time PARTIAL update (e.g. from the copilot) still
// produces a schema-valid object. Mirrors DEFAULT_VIDEO_CONFIG's required fields.
const VIDEO_CONFIG_DEFAULTS = { minSeconds: 16, maxSeconds: 32, videosPerDay: 1, aspectRatio: "9:16", styles: ["talking_head"] };

export const setVideoConfig = mutation({
  args: {
    mintAddress: v.string(),
    // All fields optional → callers can send a PARTIAL update (the copilot tweaks
    // one thing); we merge over the existing config. The Director tab sends the
    // full object, which also works.
    videoConfig: v.object({
      manualUpdatedAt: v.optional(v.number()),
      minSeconds: v.optional(v.number()),
      maxSeconds: v.optional(v.number()),
      videosPerDay: v.optional(v.number()),
      monthlyBudget: v.optional(v.number()),
      maxBrandsPerDay: v.optional(v.number()),
      postingTimeUtcMinutes: v.optional(v.number()),
      minGapHours: v.optional(v.number()),
      aspectRatio: v.optional(v.string()),
      resolution: v.optional(v.string()),
      styles: v.optional(v.array(v.string())),
      customStyles: v.optional(v.array(v.string())),
      hookStyles: v.optional(v.array(v.string())),
      settings: v.optional(v.array(v.string())),
      moods: v.optional(v.array(v.string())),
      energy: v.optional(v.string()),
      cameraStyle: v.optional(v.string()),
      colorGrade: v.optional(v.string()),
      voiceover: v.optional(v.boolean()),
      cta: v.optional(v.string()),
      ctaText: v.optional(v.string()),
      customDirective: v.optional(v.string()),
      avoid: v.optional(v.string()),
      brandLogoUrl: v.optional(v.string()),
      brandColor: v.optional(v.string()),
      // Video Call To Action app: URL of the appended-at-the-end CTA clip.
      ctaVideo: v.optional(v.string()),
      // Hook Videos / Main Content apps: pools of uploaded videos + the bypass switch.
      hookVideos: v.optional(v.array(v.string())),
      mainVideos: v.optional(v.array(v.string())),
      mainVideosOnly: v.optional(v.boolean()),
      // Series mode (episodic character show) — see schema.influencers.videoConfig.
      // IMAGE POSTS app — see schema.influencers.videoConfig.imagePosts.
      imagePosts: v.optional(v.object({
        enabled: v.optional(v.boolean()),
        imageOnly: v.optional(v.boolean()),
        idea: v.optional(v.string()),
        engine: v.optional(v.string()),
      })),
      series: v.optional(v.object({
        enabled: v.optional(v.boolean()),
        premise: v.optional(v.string()),
        world: v.optional(v.string()),
        themes: v.optional(v.array(v.string())),
        cast: v.optional(v.array(v.object({
          name: v.string(),
          role: v.optional(v.string()),
          designPrompt: v.optional(v.string()),
          refImages: v.optional(v.array(v.string())),
        }))),
      })),
      hookText: v.optional(v.object({
        enabled: v.boolean(), source: v.string(), text: v.optional(v.string()),
        // templateId = hook-design id (lib/builder/hookDesigns.ts); durationSeconds =
        // on-screen seconds (1-15); prompt = brief the hook text is generated from.
        // All optional so the AppStore Auto Hook picker's choices survive the write.
        templateId: v.optional(v.string()),
        durationSeconds: v.optional(v.number()),
        prompt: v.optional(v.string()),
        style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string() }),
      })),
      captions: v.optional(v.object({
        enabled: v.boolean(),
        // `preset` = caption-template id (see lib/builder/captionPresets.ts) — must be
        // allowed here so the AppStore caption picker's choice survives the write.
        style: v.object({ mode: v.string(), fontColor: v.string(), fontSize: v.number(), position: v.string(), preset: v.optional(v.string()) }),
      })),
      // Trending Audio app: music bed under the voiceover. volumePct 0-100 (default 30).
      music: v.optional(v.object({
        enabled: v.boolean(),
        trackId: v.optional(v.string()),
        autoMusic: v.optional(v.boolean()),
        volumePct: v.optional(v.number()),
        customUrl: v.optional(v.string()),
        customStorageId: v.optional(v.string()),
      })),
      webSearchEnabled: v.optional(v.boolean()),
      /** Reference-image overlay (Specials tool / news-idea auto-attach) —
       *  default ON. Off disables the burned-in inset card without touching
       *  the context-image wiring that helps the render itself relate to the
       *  story (that's controlled by webSearchEnabled instead). */
      newsImageOverlayEnabled: v.optional(v.boolean()),
      pinnedVideoReferenceUrl: v.optional(v.string()),
    }),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, videoConfig, authSecret }) => {
    // SECRET-GATED: client callers route through /api/agents/config (SIWS-owner-gated),
    // which injects the secret. Ungated, anyone with the Convex URL could overwrite
    // ANY agent's video config + heartbeat cadence.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const doc = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!doc) throw new Error("Agent not found");

    // Strip undefined keys from the patch so they don't clobber existing values.
    const clean = Object.fromEntries(Object.entries(videoConfig).filter(([, v]) => v !== undefined));
    // Every explicit config write stamps manualUpdatedAt: render-time standing
    // orders (chat directives) OLDER than this are ignored, so a manual Director
    // save actually takes effect instead of being clobbered by a stale directive.
    const merged = { ...VIDEO_CONFIG_DEFAULTS, ...(doc.videoConfig ?? {}), ...clean, manualUpdatedAt: Date.now() };

    // The videoConfig save itself (what the Director tab's operator is actually
    // waiting on) must NEVER fail because of the derived heartbeat/cron math —
    // that's a side effect, not the point of the write. Before this, a throw
    // anywhere below (a bad cron bucket, a stagger-hash edge case, an unexpected
    // videosPerDay/minGapHours combination) took the WHOLE mutation down with it:
    // Convex redacts the real error to a generic "[Request ID] Server Error" on
    // the client, and NOTHING saved — every retry failed identically because the
    // same stored config kept re-triggering the same crash. Compute defensively;
    // on any failure, keep the agent's EXISTING heartbeat schedule (never worse
    // than before this save) and still persist the config change the operator
    // actually asked for.
    const patch: Record<string, unknown> = { videoConfig: merged, updatedAt: Date.now() };
    try {
      let cron = videosPerDayToCron(merged.videosPerDay);
      // "Gap between posts" widens the cadence bucket when it asks for more space
      // than the videos/day rate would leave between fires.
      const gapCron = cronForMinGapHours(merged.minGapHours as number | undefined);
      if (gapCron && resolveIntervalMs(gapCron) > resolveIntervalMs(cron) && resolveIntervalMs(cron) > 0) {
        cron = gapCron;
      }
      patch.heartbeatCron = cron;
      const intervalMs = resolveIntervalMs(cron);
      const postingAnchor = merged.postingTimeUtcMinutes as number | undefined;
      if (intervalMs > 0) {
        // Recompute the SCHEDULE only — a config save must never trigger a
        // render as a side effect. Two past bugs lived here:
        //  (a) heartbeatEnabled was force-flipped ON by every save, so tweaking
        //      any Director chip armed autonomy for agents the operator had
        //      never enabled;
        //  (b) without a posting anchor, nextFireAt was set to Date.now() ("so
        //      the next cron tick fires immediately") — every Director autosave
        //      made the heartbeat DUE, the per-minute cron fired, and a video
        //      rendered. That was the "changing items generates a video and
        //      burns credits" report.
        // Now: heartbeatEnabled is left exactly as it was (enabling is the
        // Heartbeat card's explicit job), and the next fire always lands on the
        // FUTURE staggered/anchored grid — never "now".
        patch.heartbeatNextFireAt = nextHeartbeatFireAt(
          Date.now(), intervalMs, mintAddress,
          postingAnchor != null ? postingAnchor * 60_000 : undefined,
        );
      } else {
        patch.heartbeatEnabled = false;
        patch.heartbeatNextFireAt = undefined;
      }
    } catch (e) {
      console.error(`[setVideoConfig] heartbeat/cron computation failed for ${mintAddress} — saving the config unchanged, keeping the existing schedule:`, e);
    }

    // `merged` carries forward whatever nested optional objects (hookText/
    // captions/music/series/imagePosts) were already stored on THIS agent, even
    // for fields this save never touched. Some agents accumulated a legacy shape
    // for one of those (missing a since-made-required sub-field, an old field
    // name, etc.) from before the current schema was finalized — writing that
    // shape back fails Convex's document-schema validation with a REDACTED
    // "[Request ID] Server Error" that gives no clue which agent or field is at
    // fault. That's "some agents save fine, some always fail, retry never
    // helps": the operator's edit is fine, the poison is in data the agent
    // already had. If the direct write fails, retry once with any such
    // carried-over (not part of THIS save's own payload) risky field dropped —
    // the operator's actual edit still lands; only the already-broken leftover
    // resets to unset instead of permanently blocking every future save too.
    const RISKY_OPTIONAL_KEYS = ["hookText", "captions", "music", "series", "imagePosts"] as const;
    let savedVideoConfig = merged;
    try {
      await ctx.db.patch(doc._id, patch);
    } catch (writeErr) {
      const sanitized = { ...merged } as Record<string, unknown>;
      let droppedAny = false;
      for (const key of RISKY_OPTIONAL_KEYS) {
        if (key in clean) continue; // trust fields the operator just set this save
        if (sanitized[key] !== undefined) {
          delete sanitized[key];
          droppedAny = true;
        }
      }
      if (!droppedAny) throw writeErr; // nothing we could safely drop — surface the real failure
      console.error(`[setVideoConfig] write failed for ${mintAddress} (likely a legacy-shaped stored field) — retrying with carried-over hookText/captions/music/series/imagePosts dropped:`, writeErr);
      const sanitizedVideoConfig = sanitized as unknown as typeof merged;
      await ctx.db.patch(doc._id, { ...patch, videoConfig: sanitizedVideoConfig });
      savedVideoConfig = sanitizedVideoConfig;
    }
    return { ok: true, heartbeatCron: (patch.heartbeatCron as string | undefined) ?? doc.heartbeatCron, videoConfig: savedVideoConfig };
  },
});

/** App Store install counts: how many agents have each skill installed. Powers the
 *  "N agents installed" stat on the App Store cards. No index on the array, so this
 *  is a full scan — fine for a marketplace stat (the client caches the reactive
 *  result). Returns a { [skillId]: count } map. */
export const installCounts = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("influencers").collect();
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const skills = (r as { installedSkills?: string[] }).installedSkills;
      if (!Array.isArray(skills)) continue;
      for (const id of skills) {
        if (typeof id === "string") counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return counts;
  },
});

// ─── Show Bible + agentic pipeline state ─────────────────────────────────────
// All four are SECRET-GATED like setVideoConfig: client callers route through
// SIWS-owner-gated API routes which inject the secret; server callers (idea
// pipeline, copilot) hold it already.

const requireInternalSecret = (authSecret: string) => {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
};

async function getByMintOrThrow(ctx: { db: QueryCtx["db"] }, mintAddress: string) {
  const doc = await ctx.db
    .query("influencers")
    .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
    .first();
  if (!doc) throw new Error("Influencer not found");
  return doc;
}

/** Save the agent's Show Bible. Normalizes via lib/builder/showBible (the shape
 *  contract) and bumps `version` past the stored one on every write. */
export const setShowBible = mutation({
  args: { mintAddress: v.string(), showBible: v.any(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, showBible, authSecret }) => {
    requireInternalSecret(authSecret);
    const doc = await getByMintOrThrow(ctx, mintAddress);
    const normalized = normalizeShowBible(showBible);
    if (!normalized) throw new Error("invalid show bible: premise and format.kinds are required");
    const prevVersion = Number((doc.showBible as { version?: number } | undefined)?.version ?? 0);
    normalized.version = Math.max(normalized.version, prevVersion + 1);
    await ctx.db.patch(doc._id, { showBible: normalized, updatedAt: Date.now() });
    return { version: normalized.version };
  },
});

const AUTONOMY_MODES = new Set(["full-auto", "review-ideas", "review-video"]);

export const setAutonomyMode = mutation({
  args: { mintAddress: v.string(), mode: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, mode, authSecret }) => {
    requireInternalSecret(authSecret);
    if (!AUTONOMY_MODES.has(mode)) throw new Error("invalid autonomy mode");
    const doc = await getByMintOrThrow(ctx, mintAddress);
    await ctx.db.patch(doc._id, { autonomyMode: mode, updatedAt: Date.now() });
    return { mode };
  },
});

export const setRotationState = mutation({
  args: { mintAddress: v.string(), rotationState: v.any(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, rotationState, authSecret }) => {
    requireInternalSecret(authSecret);
    const doc = await getByMintOrThrow(ctx, mintAddress);
    await ctx.db.patch(doc._id, { rotationState: normalizeRotationState(rotationState) });
    return null;
  },
});

export const setTasteProfile = mutation({
  args: { mintAddress: v.string(), tasteProfile: v.any(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, tasteProfile, authSecret }) => {
    requireInternalSecret(authSecret);
    const doc = await getByMintOrThrow(ctx, mintAddress);
    const p = (tasteProfile && typeof tasteProfile === "object" ? tasteProfile : {}) as Record<string, unknown>;
    const prose = String(p.prose ?? "").trim().slice(0, 1200);
    if (!prose) throw new Error("invalid taste profile: prose required");
    await ctx.db.patch(doc._id, {
      tasteProfile: {
        prose,
        updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
        eventCount: typeof p.eventCount === "number" ? p.eventCount : 0,
      },
    });
    return null;
  },
});

// Persist a clipping ClipConfig onto the agent. The Flow canvas compiles its
// graph to a normalized config and calls this BEFORE enqueuing a clip job, so
// clipJobs.process picks it up via getByMint -> agent.clipConfig. The payload is
// already normalized client-side (lib/builder/clipConfig.normalizeClipConfig).
export const setClipConfig = mutation({
  args: { mintAddress: v.string(), clipConfig: v.any(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, clipConfig, authSecret }) => {
    // SECRET-GATED: client callers route through /api/agents/config (SIWS-owner-gated),
    // which injects the secret. Ungated, anyone with the Convex URL could overwrite
    // ANY agent's clip config (auto-post, schedule, channels).
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const doc = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!doc) throw new Error("Agent not found");
    const next = normalizeClipConfig(clipConfig);
    const previous = normalizeClipConfig(doc.clipConfig);
    if (next.campaignPosting && (JSON.stringify(next.campaignPosting) !== JSON.stringify(previous.campaignPosting) || next.timezone !== previous.timezone)) {
      const rows = await ctx.db.query("scheduledContent")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect();
      const pending = rows.filter((r) => r.campaignId && r.status === "scheduled")
        .sort((a, b) => a.scheduledFor - b.scheduledFor);
      const occupied = rows.filter((r) => !pending.some((p) => p._id === r._id));
      for (const row of pending) {
        const scheduledFor = allocatePostingSlot(Date.now(), occupied, row.campaignId, next);
        await ctx.db.patch(row._id, { scheduledFor });
        occupied.push({ ...row, scheduledFor });
      }
    }
    await ctx.db.patch(doc._id, { clipConfig, updatedAt: Date.now() });
    return { ok: true };
  },
});

/**
 * Cache which social platforms this agent has CONNECTED, so the public /agents
 * marketplace can render a connected-accounts icon overlay per card without an
 * owner-gated upload-post call per agent. Called (best-effort) from
 * /api/social/status whenever the live connection state is fetched. Idempotent —
 * a no-op when the set hasn't changed.
 */
export const setConnectedPlatforms = mutation({
  args: {
    mintAddress: v.string(), platforms: v.array(v.string()), authSecret: v.string(),
    accounts: v.optional(v.record(v.string(), v.object({
      id: v.optional(v.string()), handle: v.optional(v.string()), displayName: v.optional(v.string()),
    }))),
  },
  handler: async (ctx, { mintAddress, platforms, accounts, authSecret }) => {
    // SECRET-GATED. Callers: (1) /api/social/status (owner-gated, per agent), and
    // (2) /api/social/sync-connected (the syncConnectedSocials cron, system-level),
    // which reads EVERY agent's real upload-post connections so the public /agents
    // cards stay populated without each owner opening their own Posting tab.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const doc = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!doc) return { ok: false as const };
    // Normalize: unique, sorted, lowercased ids — so the equality check below is stable.
    const next = [...new Set(platforms.map((p) => p.trim().toLowerCase()).filter(Boolean))].sort();
    const prev = [...(doc.connectedPlatforms ?? [])].sort();
    const nextAccounts = accounts
      ? Object.fromEntries(next.filter((p) => accounts[p]).map((p) => [p, accounts[p]]))
      : next.length === 0 ? {} : undefined;
    if (prev.length === next.length && prev.every((p, i) => p === next[i])
      && (!nextAccounts || JSON.stringify(doc.connectedSocialAccounts ?? {}) === JSON.stringify(nextAccounts))) {
      return { ok: true as const, changed: false };
    }
    await ctx.db.patch(doc._id, {
      connectedPlatforms: next,
      ...(nextAccounts ? { connectedSocialAccounts: nextAccounts } : {}),
      updatedAt: Date.now(),
    });
    return { ok: true as const, changed: true };
  },
});

/**
 * Store an agent's LIVE follower counts (upload-post profile analytics). Called by
 * /api/social/sync-connected for every agent. Keeps a small sample history (≥55min
 * apart, last 8 days) so the public card can show a real 24h follower delta.
 * SECRET-GATED like setConnectedPlatforms.
 */
export const setFollowerStats = mutation({
  args: {
    mintAddress: v.string(),
    total: v.number(),
    byPlatform: v.record(v.string(), v.number()),
    authSecret: v.string(),
    /** The analytics call failed: only stamp the attempt (keeps the stored count)
     *  so the stalest-first rotation moves on instead of retrying it forever. */
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, { mintAddress, total, byPlatform, authSecret, failed }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const doc = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!doc) return { ok: false as const };
    const now = Date.now();
    if (failed) {
      await ctx.db.patch(doc._id, { followersSyncedAt: now });
      return { ok: true as const, changed: false };
    }
    const count = Math.max(0, Math.floor(total));
    let history = (doc.followerHistory ?? []).filter((h) => h.at > now - 8 * 86_400_000);
    const last = history[history.length - 1];
    if (!last || now - last.at >= 55 * 60_000) history = [...history, { at: now, count }];
    else if (last.count !== count) history = [...history.slice(0, -1), { at: last.at, count }];
    history = history.slice(-200);
    // Delta vs the sample closest to 24h ago (or the oldest we have, if younger).
    const target = now - 86_400_000;
    const base = history.reduce((best, h) => (Math.abs(h.at - target) < Math.abs(best.at - target) ? h : best), history[0]);
    const delta = count - base.count;
    const samePlatforms = JSON.stringify(doc.followersByPlatform ?? {}) === JSON.stringify(byPlatform);
    if (doc.followerCount === count && samePlatforms && doc.followerDelta24h === delta && history.length === (doc.followerHistory ?? []).length) {
      // Still stamp the sync time: the stalest-first rotation keys on it, and an
      // unchanged count must not keep this agent at the front of the queue.
      await ctx.db.patch(doc._id, { followersSyncedAt: now });
      return { ok: true as const, changed: false };
    }
    await ctx.db.patch(doc._id, {
      followerCount: count,
      followersByPlatform: byPlatform,
      followerDelta24h: delta,
      followerHistory: history,
      followersSyncedAt: now,
    });
    return { ok: true as const, changed: true };
  },
});

/**
 * Flip the agent's "Autonomous clipping" Home toggle. When ON, the daily scout's
 * auto-clip step (convex/autoClip.ts runAutoClipForMint) seeks a fit-matched funded
 * campaign, resolves the next un-clipped source, and runs the clip pipeline — one
 * clip per cycle. Off by default (this loop auto-spends → explicit opt-in).
 */
export const setAutoClip = mutation({
  args: {
    mintAddress: v.string(), enabled: v.boolean(), authSecret: v.string(),
    consent: v.optional(v.object({
      autoJoin: v.boolean(),
      allowThirdPartySources: v.boolean(),
      allowProfileCtaCampaigns: v.boolean(),
    })),
  },
  handler: async (ctx, { mintAddress, enabled, authSecret, consent }) => {
    // SECRET-GATED: the Home UI can't hold INTERNAL_CRON_SECRET, so client callers
    // route through an owner-SIWS route (/api/agents/auto-clip) that injects the
    // secret — mirrors setMonetization/setVideoConfig/setClipConfig above. Ungated,
    // anyone with the Convex URL could arm ANY agent's auto-spend loop.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const doc = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!doc) throw new Error("Agent not found");
    if (enabled && !consent && !doc.campaignWorkConsent) throw new Error("Campaign work consent is required before enabling Auto-work");
    await ctx.db.patch(doc._id, {
      autoClipEnabled: enabled,
      ...(consent ? { campaignWorkConsent: { ...consent, consentedAt: Date.now() } } : {}),
      updatedAt: Date.now(),
    });
    return { ok: true as const, autoClipEnabled: enabled };
  },
});

/** Operator dashboard stats for one agent card: tasks done + spend + revenue +
 *  net profit + how many times it was hired. Powers the data-dense Studio cards. */
export const operatorCardStats = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    const [tasks, dists] = await Promise.all([
      ctx.db.query("agentTasks").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect(),
      ctx.db.query("distributions").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect(),
    ]);
    const totalCost = tasks.reduce((s, t) => s + (t.cost ?? 0), 0);
    const totalRevenue = tasks.reduce((s, t) => s + (t.revenue ?? 0), 0);
    const hires = dists.filter((d) => typeof d.submissionId === "string" && d.submissionId.startsWith("hire:")).length;
    return {
      tasksTotal: tasks.length,
      tasksDone: tasks.filter((t) => t.status === "succeeded").length,
      totalCost: Math.round(totalCost * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      net: Math.round((totalRevenue - totalCost) * 100) / 100,
      hires,
    };
  },
});

export const listByCreator = query({
  args: { creatorWallet: v.string() },
  handler: async (ctx, { creatorWallet }) => {
    const all = await ctx.db
      .query("influencers")
      .withIndex("by_creator", (q) => q.eq("creatorWallet", creatorWallet))
      .order("desc")
      .collect();
    // Deduplicate by mintAddress — keep only the most recent record per mint
    const seen = new Set<string>();
    const deduped = all.filter((doc) => {
      if (seen.has(doc.mintAddress)) return false;
      seen.add(doc.mintAddress);
      return true;
    });
    return withRealTvl(ctx, deduped);
  },
});

/** Multi-wallet twin of listByCreator. A user's agents are keyed to the wallet
 *  each was MINTED under, which for a Privy/Google user is often NOT the wallet
 *  currently resolved by the client. Unioning the account's FULL linked-wallet
 *  set (profile.walletAddresses) keeps the dashboard from blanking to $0 on a
 *  wallet mismatch. Also includes agents where any of the caller's wallets appears
 *  in coCreatorWallets (shared access without ownership transfer).
 *  Dedupes by mintAddress across wallets; real-TVL applied. */
export const listByCreators = query({
  args: { creatorWallets: v.array(v.string()) },
  handler: async (ctx, { creatorWallets }) => {
    const wallets = [...new Set(creatorWallets.filter(Boolean))];
    const seen = new Set<string>();
    const deduped: Doc<"influencers">[] = [];
    // 1. Primary ownership — agents minted under any of the caller's wallets.
    for (const w of wallets) {
      const rows = await ctx.db
        .query("influencers")
        .withIndex("by_creator", (q) => q.eq("creatorWallet", w))
        .order("desc")
        .collect();
      for (const doc of rows) {
        if (seen.has(doc.mintAddress)) continue;
        seen.add(doc.mintAddress);
        deduped.push(doc);
      }
    }
    // 2. Shared access — agents where any caller wallet is listed in coCreatorWallets.
    //    Full-table scan is acceptable: coCreatorWallets is rarely populated and the
    //    set of wallets passed here is always small (one user's linked wallets).
    const walletSet = new Set(wallets);
    const allAgents = await ctx.db.query("influencers").collect();
    for (const doc of allAgents) {
      if (seen.has(doc.mintAddress)) continue;
      if (!doc.coCreatorWallets?.some((w) => walletSet.has(w))) continue;
      seen.add(doc.mintAddress);
      deduped.push(doc);
    }
    return withRealTvl(ctx, deduped);
  },
});

/** Server-side only — returns the full doc including agentWalletSecret. Never call from public queries. */
export const getByMintInternal = internalQuery({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    return await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
  },
});

/** Public, INTERNAL_CRON_SECRET-gated twin returning the FULL doc (incl. the
 *  encrypted agentWalletSecret) for Next server callers that need to sign
 *  on-chain (settleAgent, settle-tab, share buy/redeem). ConvexHttpClient can't
 *  reach internalQuery, so on-chain money paths silently no-op'd without this.
 *  The secret stays encrypted at rest; only the server holding
 *  WALLET_ENCRYPTION_KEY can decrypt it. */
/** Backfill / record the real on-chain NFT for an agent (server-gated). Keeps
 *  the stable internal mintAddress; stores the NFT in dedicated fields. */
export const setNft = mutation({
  args: { mintAddress: v.string(), nftMintAddress: v.string(), nftTxSignature: v.string(), nftExplorerUrl: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, nftMintAddress, nftTxSignature, nftExplorerUrl, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const doc = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).first();
    if (!doc) return { ok: false as const, error: "not found" };
    await ctx.db.patch(doc._id, { nftMintAddress, nftTxSignature, nftExplorerUrl });
    return { ok: true as const };
  },
});

export const getByMintServer = query({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    return await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
  },
});

export const getMarketStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("influencers").collect();
    // DEDUP by mint: escrow is keyed per mint, so a mint with duplicate influencer
    // rows would otherwise count the SAME escrowUsdc once per row (double-count).
    const seen = new Set<string>();
    const influencers = all.filter((i) => {
      if (seen.has(i.mintAddress)) return false;
      seen.add(i.mintAddress);
      return true;
    });
    // Real TVL is the agent's escrow vault, not the dead influencers.tvl column.
    const escrow = await escrowByMint(ctx);
    const tvlOf = (i: Doc<"influencers">) => escrow.get(i.mintAddress) ?? i.tvl;
    const funded = influencers.filter((i) => tvlOf(i) > 0);
    return {
      totalTvl: influencers.reduce((s, i) => s + tvlOf(i), 0),
      totalAgents: influencers.length,
      totalMonthlyEarnings: influencers.reduce((s, i) => s + i.monthlyEarnings, 0),
      avgApr:
        funded.length > 0
          ? (funded.reduce((s, i) => s + (i.monthlyEarnings * 12) / tvlOf(i), 0) /
              funded.length) *
            100
          : 0,
    };
  },
});

export const invest = mutation({
  args: {
    mintAddress: v.string(),
    investorWallet: v.string(),
    usdcAmount: v.number(),
    txSignature: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, investorWallet, usdcAmount, txSignature, authSecret }) => {
    // SECRET-GATED: this MINTS shares for a USDC amount the caller supplies — it
    // trusts the amount and only checks txSignature uniqueness (not the on-chain
    // amount), so a direct client call was free shares + corrupted public TVL/APR.
    // The authoritative buy path is /api/market/buy-shares → shares.buyShares
    // (verifyUsdcDeposit). Server-only now.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) throw new Error("Influencer not found");
    if (usdcAmount <= 0) throw new Error("Amount must be positive");

    // Single-use proof: replay of the same txSignature is rejected globally,
    // regardless of which investor wallet submits it (JOB-85).
    await consumeSignature(ctx, {
      txSignature,
      purpose: "invest",
      ref: mintAddress,
      amount: usdcAmount,
    });

    const sharesBought = Math.floor(usdcAmount / influencer.sharePrice);
    if (sharesBought < 1)
      throw new Error(`Minimum investment is $${influencer.sharePrice.toFixed(2)} USDC for 1 share`);
    if (sharesBought > influencer.availableShares)
      throw new Error("Not enough shares available");

    const newTvl = influencer.tvl + usdcAmount;
    const newMonthlyEarnings = Math.floor(
      newTvl * 0.08 * (1 + Math.log10(Math.max(newTvl, 1)) * 0.005)
    );
    const soldFraction =
      (influencer.totalShares - influencer.availableShares + sharesBought) /
      influencer.totalShares;
    const newSharePrice = parseFloat(
      (influencer.sharePrice * (1 + soldFraction * 0.3)).toFixed(4)
    );

    await ctx.db.patch(influencer._id, {
      tvl: newTvl,
      monthlyEarnings: newMonthlyEarnings,
      availableShares: influencer.availableShares - sharesBought,
      sharePrice: newSharePrice,
    });

    await ctx.db.insert("investments", {
      mintAddress,
      investorWallet,
      sharesBought,
      usdcAmount,
      txSignature,
      sharePrice: influencer.sharePrice,
      investedAt: Date.now(),
    });

    return { sharesBought, newTvl, newSharePrice };
  },
});

export const listInvestments = query({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }) => {
    return ctx.db
      .query("investments")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .order("desc")
      .collect();
  },
});

export const tickEarnings = mutation({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }) => {
    // SECRET-GATED: writes tvl + monthlyEarnings — the SAME public APR stats addEarnings
    // gates. Ungated, anyone could repeatedly call this to inflate the figures investors
    // buy shares on. (No app caller today; a future cron would pass the secret.)
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer || influencer.tvl === 0) return;

    const growth = 1 + Math.random() * 0.02 + 0.01;
    const newTvl = Math.floor(influencer.tvl * growth);
    const newMonthlyEarnings = Math.floor(newTvl * 0.08);

    await ctx.db.patch(influencer._id, {
      tvl: newTvl,
      monthlyEarnings: newMonthlyEarnings,
    });
  },
});

export const getById = query({
  args: { id: v.id("influencers") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to omit agentWalletSecret from the public payload
    const { agentWalletSecret: _, ...rest } = doc;
    return rest;
  },
});

/**
 * Credit verified-work earnings to an agent's economy. Increments lifetime
 * earnings and recomputes `monthlyEarnings` as the trailing-30-day sum of
 * distribution payouts (the single source of truth for earnings → drives APR).
 */
export const addEarnings = mutation({
  args: { mintAddress: v.string(), usdc: v.number(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, usdc, authSecret }) => {
    // SECRET-GATED: writes lifetime/monthly earnings → drives public APR stats.
    // Ungated, anyone could fabricate earnings to inflate the figures investors buy on.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const agent = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!agent) return;

    // DERIVE both figures from the distributions ledger (the single source of
    // truth for every payout — campaigns, clipper content-rewards, AND hires).
    // Recomputing from the ledger makes this idempotent and self-healing: it can
    // be re-run any time without drift, and always reflects every recorded earning.
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const ledger = await ctx.db
      .query("distributions")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    const lifetime = ledger.length
      ? ledger.reduce((s, d) => s + d.totalPayoutUsdc, 0)
      : (agent.lifetimeEarningsUsdc ?? 0) + usdc; // fallback before the row lands
    const monthly = ledger
      .filter((d) => d.createdAt >= since)
      .reduce((s, d) => s + d.totalPayoutUsdc, 0);

    await ctx.db.patch(agent._id, {
      lifetimeEarningsUsdc: Math.round(lifetime * 100) / 100,
      monthlyEarnings: Math.round(monthly * 100) / 100,
    });
  },
});

/**
 * Record a HIRE payout for an agent (someone commissioned a video). Unlike
 * campaign earnings (which the oracle settles into the `distributions` table and
 * `addEarnings` recomputes a 30-day window from), a hire is a direct off-table
 * USDC payment to the agent's wallet — so we add it to BOTH the lifetime total
 * and the live monthly figure additively. Secret-gated like addEarnings.
 */
export const recordHireEarning = mutation({
  args: { mintAddress: v.string(), usdc: v.number(), hireKey: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, usdc, hireKey, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    if (!(usdc > 0)) return;
    const agent = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!agent) return;

    // Record the hire into the SAME distributions ledger campaigns use, so the
    // agent's earnings (lifetime + monthly + APR + chart) are one consistent
    // figure. Idempotent: keyed on the hire so a retry never double-counts.
    const subId = `hire:${hireKey}`;
    const existing = await ctx.db
      .query("distributions")
      .withIndex("by_submission", (q) => q.eq("submissionId", subId))
      .first();
    if (!existing) {
      await ctx.db.insert("distributions", {
        mintAddress,
        submissionId: subId,
        totalPayoutUsdc: usdc,
        investorUsdc: 0,
        builderUsdc: usdc,
        protocolUsdc: 0,
        // The whole amount is the agent's earned income from being hired, paid to
        // its own wallet — mark the split role "earned" and the row source "hire"
        // so the wallet/UI can show it distinctly as the agent's earned income
        // (not an investor/protocol split or an external deposit).
        splits: agent.agentWallet ? [{ wallet: agent.agentWallet, role: "earned", usdc, status: "paid" }] : [],
        status: "paid",
        source: "hire",
        createdAt: Date.now(),
      });
    }

    // Recompute lifetime + monthly from the ledger (idempotent, self-healing).
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const ledger = await ctx.db
      .query("distributions")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .collect();
    const lifetime = ledger.reduce((s, d) => s + d.totalPayoutUsdc, 0);
    const monthly = ledger.filter((d) => d.createdAt >= since).reduce((s, d) => s + d.totalPayoutUsdc, 0);
    await ctx.db.patch(agent._id, {
      lifetimeEarningsUsdc: Math.round(lifetime * 100) / 100,
      monthlyEarnings: Math.round(monthly * 100) / 100,
    });
  },
});

/**
 * Consume a hire-payment signature EXACTLY ONCE (replay protection, JOB-85), so a
 * single real on-chain USDC payment can't be replayed to farm multiple free video
 * renders + fabricated earnings. `/api/agents/hire-generate` calls this — after it
 * has verified the deposit on-chain (verifyUsdcDeposit) — BEFORE forwarding to
 * run-task, mirroring how `invest` consumes the signature before crediting. Throws
 * "Transaction already processed" (from consumeSignature) if the signature was
 * already used by this or ANY other payment path (shared processedSignatures ledger).
 * Secret-gated like the other money mutations.
 */
export const consumeHireSignature = mutation({
  args: { mintAddress: v.string(), txSignature: v.string(), usdc: v.number(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, txSignature, usdc, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    await consumeSignature(ctx, { txSignature, purpose: "hire", ref: mintAddress, amount: usdc });
    return { ok: true as const };
  },
});

/**
 * RELEASE a hire-payment signature previously consumed by consumeHireSignature so
 * the SAME real payment can be retried (BUG-025b). The hire route consumes the
 * signature BEFORE it dispatches the render (so concurrent duplicates of one
 * payment can't each fire a render — anti-farm). But if the render then fails to
 * START, that consume would strand a paying user: the sig is burned, so their
 * retry (same sig, no re-pay) is rejected "already used" → paid-but-no-render.
 * The route calls this ONLY on a confirmed render-dispatch failure to un-burn the
 * sig, so the retry (or the client's automatic re-attempt) re-consumes and renders.
 *
 * SAFETY: deletes ONLY a row THIS hire path inserted (purpose "hire" AND ref ===
 * this mint), so it can never free an invest/mint/top-up/buy-shares proof that
 * shares the (globally-unique) signature. Secret-gated. No-op if already gone.
 */
export const releaseHireSignature = mutation({
  args: { mintAddress: v.string(), txSignature: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, txSignature, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const sig = txSignature.trim();
    if (!sig) return { released: false as const };
    const row = await ctx.db
      .query("processedSignatures")
      .withIndex("by_signature", (q) => q.eq("txSignature", sig))
      .first();
    if (row && row.purpose === "hire" && row.ref === mintAddress) {
      await ctx.db.delete(row._id);
      return { released: true as const };
    }
    return { released: false as const };
  },
});

/** SECRET-GATED admin ownership transfer: repoint an agent (by mint) at a new
 *  creator wallet so it shows up under that account's builder/agents pages. */
export const adminTransferOwnership = mutation({
  args: { mintAddress: v.string(), newCreatorWallet: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, newCreatorWallet, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const inf = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).first();
    if (!inf) return { ok: false as const, error: "influencer not found" };
    await ctx.db.patch(inf._id, { creatorWallet: newCreatorWallet, updatedAt: Date.now() });
    return { ok: true as const, name: inf.name };
  },
});

/** SECRET-GATED: add (or remove) a wallet from an agent's coCreatorWallets list
 *  so a second account can manage the agent without losing primary ownership.
 *  action: "add" | "remove" */
export const adminAddCoCreator = mutation({
  args: {
    mintAddress: v.string(),
    coCreatorWallet: v.string(),
    action: v.union(v.literal("add"), v.literal("remove")),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, coCreatorWallet, action, authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    const inf = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!inf) return { ok: false as const, error: "influencer not found" };
    const current = inf.coCreatorWallets ?? [];
    let next: string[];
    if (action === "add") {
      next = current.includes(coCreatorWallet) ? current : [...current, coCreatorWallet];
    } else {
      next = current.filter((w) => w !== coCreatorWallet);
    }
    await ctx.db.patch(inf._id, { coCreatorWallets: next, updatedAt: Date.now() });
    return { ok: true as const, name: inf.name, coCreatorWallets: next };
  },
});

export const update = mutation({
  args: {
    id: v.id("influencers"),
    name: v.string(),
    handle: v.string(),
    avatarUrl: v.string(),
    niche: v.string(),
    language: v.string(),
    archetype: v.string(),
    description: v.string(),
    personality: v.object({
      warmth: v.number(),
      humor: v.number(),
      authority: v.number(),
      boldness: v.number(),
    }),
    authSecret: v.string(),
  },
  handler: async (ctx, { id, authSecret, ...fields }) => {
    // SECRET-GATED: the influencer _id is exposed in every public list/detail query,
    // so an ungated update let anyone deface ANY agent's persona by _id. The edit page
    // now POSTs to the SIWS-owner-gated /api/agents/config (kind:"persona"), which
    // proves ownership and injects INTERNAL_CRON_SECRET. `authSecret` is destructured
    // out so it never lands in the row.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Agent not found");
    await ctx.db.patch(id, {
      ...fields,
      description: formatAgentDescription({ ...existing, ...fields }),
      updatedAt: Date.now(),
    });
  },
});

/** Update only the agent's display avatar. Kept separate from the full persona
 * mutation so a profile-photo change cannot overwrite newer persona fields. */
export const setAvatarUrl = mutation({
  args: { mintAddress: v.string(), avatarUrl: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, avatarUrl, authSecret }) => {
    requireInternalSecret(authSecret);
    const url = avatarUrl.trim();
    if (!/^https:\/\//i.test(url)) throw new Error("avatarUrl must be a secure public URL");
    const doc = await getByMintOrThrow(ctx, mintAddress);
    await ctx.db.patch(doc._id, { avatarUrl: url, updatedAt: Date.now() });
    return { ok: true, avatarUrl: url };
  },
});

/** One-time and repeat-safe migration for every existing marketplace card. */
export const standardizeAllDescriptions = mutation({
  args: { authSecret: v.string() },
  handler: async (ctx, { authSecret }) => {
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const agents = await ctx.db.query("influencers").collect();
    let updated = 0;
    for (const agent of agents) {
      const description = formatAgentDescription(agent);
      if (description === agent.description) continue;
      await ctx.db.patch(agent._id, { description, updatedAt: Date.now() });
      updated++;
    }
    return { total: agents.length, updated };
  },
});

/** Internal provisioning only. User creation goes through /api/nft/mint. */
export const create = internalMutation({
  args: {
    mintAddress: v.string(),
    creatorWallet: v.string(),
    name: v.string(),
    handle: v.string(),
    avatarUrl: v.string(),
    niche: v.string(),
    language: v.string(),
    archetype: v.string(),
    description: v.string(),
    personality: v.object({
      warmth: v.number(),
      humor: v.number(),
      authority: v.number(),
      boldness: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", args.mintAddress))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("influencers", {
      ...args,
      description: formatAgentDescription(args),
      handleLower: await uniqueHandleLower(ctx, args.handle),
      tvl: 0,
      monthlyEarnings: 0,
      sharePrice: 10,
      totalShares: 1000,
      availableShares: 1000,
    });
  },
});

export const setAgentWallet = mutation({
  args: {
    mintAddress: v.string(),
    agentWallet: v.string(),
    agentWalletSecret: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, agentWallet, agentWalletSecret, authSecret }) => {
    // SECRET-GATED: this writes an agent's escrow wallet + spend SECRET. Ungated,
    // anyone could reroute deposits / hijack the payout source. Server-only.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) throw new Error("Influencer not found");
    // Never clobber an already-set wallet (the secret is the sole spend authority;
    // overwriting would orphan funds held there).
    if (influencer.agentWallet && influencer.agentWallet !== agentWallet) {
      throw new Error("agentWallet already set — refusing to overwrite");
    }
    await ctx.db.patch(influencer._id, { agentWallet, agentWalletSecret, updatedAt: Date.now() });
  },
});

const PAPER_STARTING_BALANCE = 10_000;

/**
 * Adjust paper USDC balance by an arbitrary delta — used for non-spot paper
 * operations like binary bet stakes/payouts, perp margin, etc.
 * Throws when the delta would overdraft a positive balance, so callers can
 * surface "insufficient paper USDC" clearly to the operator.
 */
/** Increment realized paper PnL by a delta (positive = win, negative = loss). */
export const adjustPaperRealizedPnl = mutation({
  args: { mintAddress: v.string(), deltaUsdc: v.number(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, deltaUsdc, authSecret }) => {
    // SECRET-GATED: paper-PnL display write — ungated, anyone could fabricate a
    // victim agent's trader PnL. Server callers (trade router) pass the secret.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) return null;
    await ctx.db.patch(influencer._id, {
      paperRealizedPnlUsdc: (influencer.paperRealizedPnlUsdc ?? 0) + deltaUsdc,
      updatedAt: Date.now(),
    });
    return { newPnl: (influencer.paperRealizedPnlUsdc ?? 0) + deltaUsdc };
  },
});

export const adjustPaperBalance = mutation({
  args: {
    mintAddress: v.string(),
    deltaUsdc: v.number(),
    reason: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, deltaUsdc, reason, authSecret }) => {
    // SECRET-GATED: writes a victim agent's paper USDC balance. Server callers pass it.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) throw new Error("Agent not found");
    const current = influencer.paperUsdcBalance ?? PAPER_STARTING_BALANCE;
    const next = current + deltaUsdc;
    if (next < 0) throw new Error(`Insufficient paper USDC. Have $${current.toFixed(2)}, need $${Math.abs(deltaUsdc).toFixed(2)}`);
    await ctx.db.patch(influencer._id, {
      paperUsdcBalance: next,
      updatedAt: Date.now(),
    });
    void reason;
    return { newBalance: next, delta: deltaUsdc };
  },
});

/** Apply a paper-trade fill to the agent's virtual wallet — deducts USDC,
 *  opens/closes positions, and returns the new balance. Called server-side
 *  from the trade router after a successful paper fill.  */
export const recordPaperFill = mutation({
  args: {
    mintAddress: v.string(),
    side: v.union(v.literal("BUY"), v.literal("SELL")),
    asset: v.string(),
    amountUsdc: v.number(),
    units: v.number(),
    fillPrice: v.number(),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, side, asset, amountUsdc, units, fillPrice, authSecret }) => {
    // SECRET-GATED: mutates a victim agent's paper wallet + positions. Server-only (trade router).
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) return null;

    const currentBalance = influencer.paperUsdcBalance ?? PAPER_STARTING_BALANCE;
    const positions = influencer.paperPositions ?? [];
    let realized = influencer.paperRealizedPnlUsdc ?? 0;

    if (side === "BUY") {
      if (currentBalance < amountUsdc) {
        throw new Error(`Insufficient paper USDC. Have $${currentBalance.toFixed(2)}, need $${amountUsdc.toFixed(2)}`);
      }
      await ctx.db.patch(influencer._id, {
        paperUsdcBalance: currentBalance - amountUsdc,
        paperPositions: [
          ...positions,
          { asset, amountUsdc, units, fillPrice, openedAt: Date.now() },
        ],
        updatedAt: Date.now(),
      });
      return { newBalance: currentBalance - amountUsdc, openPositions: positions.length + 1 };
    }

    // SELL — match against the oldest open position in this asset (FIFO)
    const matchIdx = positions.findIndex((p) => p.asset === asset);
    if (matchIdx < 0) {
      throw new Error(`No open paper position in ${asset} to sell`);
    }
    const exited = positions[matchIdx];
    const proceeds = exited.units * fillPrice;
    const pnl = proceeds - exited.amountUsdc;
    realized += pnl;
    const nextPositions = positions.filter((_, i) => i !== matchIdx);
    await ctx.db.patch(influencer._id, {
      paperUsdcBalance: currentBalance + proceeds,
      paperPositions: nextPositions,
      paperRealizedPnlUsdc: realized,
      updatedAt: Date.now(),
    });
    return { newBalance: currentBalance + proceeds, realizedPnl: pnl, openPositions: nextPositions.length };
  },
});

/** Reset paper wallet back to starting balance — for testing. */
export const resetPaperWallet = mutation({
  args: { mintAddress: v.string(), authSecret: v.string() },
  handler: async (ctx, { mintAddress, authSecret }) => {
    // SECRET-GATED: wipes a victim agent's paper wallet. (No app caller today.)
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) return null;
    await ctx.db.patch(influencer._id, {
      paperUsdcBalance: PAPER_STARTING_BALANCE,
      paperPositions: [],
      paperRealizedPnlUsdc: 0,
      updatedAt: Date.now(),
    });
    return { newBalance: PAPER_STARTING_BALANCE };
  },
});

/**
 * Persists the operator's installed skills + heartbeat config so they survive
 * a page refresh. Idempotent — overwrites the full array each call.
 * Returns silently when the influencer hasn't been minted yet (skills only
 * live in client state pre-mint; we can't index them without a mint address).
 */
export const saveAgentConfig = mutation({
  args: {
    mintAddress: v.string(),
    installedSkills: v.optional(v.array(v.string())),
    heartbeatEnabled: v.optional(v.boolean()),
    heartbeatCron: v.optional(v.string()),
    heartbeatMarkdown: v.optional(v.string()),
    videoEngine: v.optional(v.string()),
    /** Operator-authored persona kernel (see schema) — "" clears the override. */
    personaKernelOverride: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, { mintAddress, authSecret, ...patch }) => {
    // SECRET-GATED: client callers route through /api/agents/config (SIWS-owner-gated),
    // which injects the secret. Ungated, anyone with the Convex URL could overwrite
    // ANY agent's installed skills + heartbeat schedule + video engine. The
    // destructure above keeps `authSecret` out of `patch` so it never lands in the row.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) return null;
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    // Recompute the next wall-clock fire slot whenever cadence/enabled change so the
    // new schedule takes effect immediately (and the /agents countdown re-syncs).
    const nextEnabled = patch.heartbeatEnabled ?? influencer.heartbeatEnabled;
    const nextCron = patch.heartbeatCron ?? influencer.heartbeatCron;
    if (patch.heartbeatCron !== undefined || patch.heartbeatEnabled !== undefined) {
      const intervalMs = resolveIntervalMs(nextCron);
      // "Fire on the next cron tick" is ONLY for the explicit OFF→ON click —
      // the operator pressed start, a render is expected, so it feels
      // immediate. A cadence-only change (heartbeatCron while already enabled)
      // must NOT fire a surprise render; it reschedules onto the future
      // staggered grid instead. (Cadence tweaks triggering instant videos was
      // part of the "changing items burns credits" report.)
      const justEnabled = patch.heartbeatEnabled === true && influencer.heartbeatEnabled !== true;
      (clean as Record<string, unknown>).heartbeatNextFireAt =
        !nextEnabled || intervalMs <= 0 ? undefined
        : justEnabled ? Date.now()
        : nextHeartbeatFireAt(Date.now(), intervalMs, mintAddress);
    }
    await ctx.db.patch(influencer._id, { ...clean, updatedAt: Date.now() });
    return influencer._id;
  },
});

/** Atomically record that the heartbeat fired for an agent and advance its next
 *  wall-clock fire slot. Used by the cron driver. */
export const markHeartbeatFired = mutation({
  args: { mintAddress: v.string(), firedAt: v.number(), nextFireAt: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { mintAddress, firedAt, nextFireAt, authSecret }) => {
    // SECRET-GATED: no live caller (cron-driver helper). Ungated, anyone could rewrite
    // any agent's heartbeat schedule (delay/skew its auto-posting cadence).
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) return null;
    await ctx.db.patch(influencer._id, {
      heartbeatLastFiredAt: firedAt,
      ...(nextFireAt !== undefined ? { heartbeatNextFireAt: nextFireAt } : {}),
    });
    return influencer._id;
  },
});

/**
 * Atomic compare-and-advance claim. Returns { claimed: true } to exactly one
 * concurrent caller (cron or an open client page) when the agent's wall-clock
 * slot is due, advancing the slot in the same transaction so nobody re-fires it.
 * Seeds a slot for never-seen agents without firing. Public so the builder can
 * call it as a localhost firing fallback.
 * RESIDUAL (left public, ungated): the builder calls this directly (browser
 * useMutation) as a localhost firing fallback, so it can't carry the internal secret.
 * It only claims when the agent's slot is already due and advances the slot in the
 * same tx, so it is self-rate-limited to the configured cadence (no spam/drain), and
 * it does not itself run a paid task — the caller separately invokes the auth-gated
 * run-task route. Low value; left open to keep the localhost heartbeat working.
 */
export const claimHeartbeat = mutation({
  args: { mintAddress: v.string(), now: v.number() },
  handler: async (ctx, { mintAddress, now }) => {
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) return { claimed: false };
    if (!influencer.heartbeatEnabled) return { claimed: false };

    const intervalMs = resolveIntervalMs(influencer.heartbeatCron);
    const postingAnchor = influencer.videoConfig?.postingTimeUtcMinutes;
    const decision = evaluateHeartbeatClaim({
      now,
      intervalMs,
      mintAddress,
      storedNextFireAt: influencer.heartbeatNextFireAt,
      phaseOverrideMs: postingAnchor != null ? postingAnchor * 60_000 : undefined,
    });

    if (decision.nextFireAt !== undefined) {
      await ctx.db.patch(influencer._id, {
        heartbeatNextFireAt: decision.nextFireAt,
        ...(decision.claimed ? { heartbeatLastFiredAt: now } : {}),
      });
    }
    return { claimed: decision.claimed };
  },
});

/** Set/clear an agent's next heartbeat fire slot. Called when the cadence changes
 *  or when the cron lazily initializes a never-fired agent. */
export const setHeartbeatNextFireAt = mutation({
  args: { mintAddress: v.string(), nextFireAt: v.optional(v.number()), authSecret: v.string() },
  handler: async (ctx, { mintAddress, nextFireAt, authSecret }) => {
    // SECRET-GATED: no live caller (cron helper). Ungated, anyone could set/clear any
    // agent's next heartbeat fire slot.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) return null;
    await ctx.db.patch(influencer._id, { heartbeatNextFireAt: nextFireAt });
    return influencer._id;
  },
});

/**
 * Real earnings time-series derived from:
 * - Actual investment history (TVL-projected yield at 8% APR)
 * - Task revenues (actual USDC earned per completed task)
 */
export const earningsTimeSeries = query({
  args: { mintAddress: v.string(), range: v.string() },
  handler: async (ctx, { mintAddress, range }) => {
    const now = Date.now();
    const msPerDay = 24 * 3600 * 1000;
    const { days, buckets } = (
      range === "1W" ? { days: 7,   buckets: 7  } :
      range === "1M" ? { days: 30,  buckets: 30 } :
      range === "3M" ? { days: 90,  buckets: 13 } :
                       { days: 180, buckets: 6  }
    );
    const startMs = now - days * msPerDay;
    const bucketMs = (now - startMs) / buckets;

    const [investments, tasks, distributions] = await Promise.all([
      ctx.db.query("investments").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect(),
      ctx.db.query("agentTasks").withIndex("by_mint",  (q) => q.eq("mintAddress", mintAddress)).collect(),
      ctx.db.query("distributions").withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress)).collect(),
    ]);

    const revenueTasksInRange = tasks.filter(
      (t) => t.status === "succeeded" && (t.revenue ?? 0) > 0 && (t.completedAt ?? 0) >= startMs
    );
    // Real settled payouts (campaign / clipper content-reward / hire) in range.
    const payoutsInRange = distributions.filter((d) => (d.createdAt ?? 0) >= startMs);

    const bucketsPerYear = (365 * msPerDay) / bucketMs;

    return Array.from({ length: buckets }, (_, i) => {
      const bucketStart = startMs + i * bucketMs;
      const bucketEnd   = bucketStart + bucketMs;
      const mid = new Date(bucketStart + bucketMs / 2);

      // Cumulative TVL locked up to this bucket
      const cumulativeTvl = investments
        .filter((inv) => inv.investedAt < bucketEnd)
        .reduce((s, inv) => s + inv.usdcAmount, 0);

      // Task revenue earned in this specific bucket
      const taskRevenue = revenueTasksInRange
        .filter((t) => (t.completedAt ?? 0) >= bucketStart && (t.completedAt ?? 0) < bucketEnd)
        .reduce((s, t) => s + (t.revenue ?? 0), 0);

      // Real payouts (campaign + clipper content-reward + hire) settled in this bucket.
      const payouts = payoutsInRange
        .filter((d) => (d.createdAt ?? 0) >= bucketStart && (d.createdAt ?? 0) < bucketEnd)
        .reduce((s, d) => s + (d.totalPayoutUsdc ?? 0), 0);

      // Projected yield from TVL (8% APR prorated to bucket duration)
      const projected = cumulativeTvl > 0 ? cumulativeTvl * 0.08 / bucketsPerYear : 0;

      const label =
        range === "6M" ? mid.toLocaleDateString("en", { month: "short" }) :
        mid.toLocaleDateString("en", { month: "short", day: "numeric" });

      return {
        label,
        earnings: parseFloat((taskRevenue + payouts + projected).toFixed(4)),
        taskRevenue: parseFloat((taskRevenue + payouts).toFixed(4)),
        projected: parseFloat(projected.toFixed(4)),
      };
    });
  },
});
