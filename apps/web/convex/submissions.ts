import { query, mutation, action, type ActionCtx, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { resolveAdmin } from "./admin";
import { isRestrictedCampaign, isAllowedRestrictedEmail } from "../lib/restrictedCampaigns";
import { decideSubmission, hasRealPost } from "../lib/submissionIdentity";
import { enqueueVideoMilestone } from "./contentControl";
import { bumpLiveViews } from "./platformStats";

/** INTERNAL_CRON_SECRET gate — the only caller of the secret-gated functions
 *  below is the `/api/oracle/scrape-views` worker (via ConvexHttpClient). */
function gateSecret(authSecret: string) {
  if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) {
    throw new Error("unauthorized");
  }
}

// Real social-post permalink hosts — mirrors the admin table's `isSocialPostUrl`
// (submissions-section.tsx) and lib/server `isSocialPermalink`. Anything else (a
// Convex/Supabase storage url, an .mp4, a KIE render link) is the raw clip, not a
// post link, so the scrape write-back must not treat it as a live permalink.
const SOCIAL_POST_HOST =
  /(?:^|\.)(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|twitter\.com|x\.com)$/i;
function isSocialPermalink(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return SOCIAL_POST_HOST.test(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}

/**
 * Earned income per agent, computed from the records that actually exist — so the
 * marketplace shows real earnings the moment a clipper's submission is approved or
 * an agent is hired, without depending on the (lagging, on-chain) settlement
 * pipeline having run. Returns { mintAddress → { lifetime, monthly } } in USDC.
 *
 * Sources (no double-count):
 *   • Campaign / clipper rewards  → the agent's submissions (paid amount, else the
 *     approved/verified payout).
 *   • Hire commissions            → distributions rows we key as `hire:*`.
 */
export const earningsByAgent = query({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, { lifetime: number; monthly: number }> = {};
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const add = (mint: string | undefined, usdc: number, ts: number) => {
      if (!mint || !(usdc > 0)) return;
      const e = out[mint] ?? (out[mint] = { lifetime: 0, monthly: 0 });
      e.lifetime += usdc;
      if (ts >= since) e.monthly += usdc;
    };

    // BOUNDED scans — never `collect()` the whole table (it throws past Convex's
    // per-query read limit once these grow). A recent window is plenty for the
    // marketplace's live earnings; the denormalized lifetimeEarningsUsdc remains
    // the accurate all-time figure the page falls back to.
    const SCAN = 8000;

    // Campaign / clipper rewards — count the on-chain paid amount when present,
    // else the reward owed on an approved/verified submission. Also record any
    // content-reward clip already counted here via its on-chain paidUsdc, so its
    // redundant `creward:` distribution mirror isn't double-counted below (#18/24/26).
    const paidBridgedCreward = new Set<string>();
    for (const s of await ctx.db.query("submissions").order("desc").take(SCAN)) {
      const paid = typeof s.paidUsdc === "number" && s.paidUsdc > 0 ? s.paidUsdc : 0;
      const earned = paid > 0
        ? paid
        : (s.status === "approved" || s.status === "verified") ? (s.payoutAmountUsdc ?? 0) : 0;
      add(s.influencerMint, earned, s.verifiedAt ?? s._creationTime);
      if (paid > 0 && typeof s.contentRewardSubmissionId === "string") {
        paidBridgedCreward.add(s.contentRewardSubmissionId);
      }
    }

    // Hire commissions (`hire:*`) AND content-reward clipper/UGC payouts
    // (`creward:*`) recorded in the distributions ledger. A `creward:` clip that
    // was ALSO paid on-chain (bridged to a funded v2 campaign) is already counted
    // via its paidUsdc submission above — skip its mirror to avoid double-counting.
    for (const d of await ctx.db.query("distributions").order("desc").take(SCAN)) {
      const id = typeof d.submissionId === "string" ? d.submissionId : "";
      if (id.startsWith("hire:")) {
        add(d.mintAddress, d.totalPayoutUsdc, d.createdAt);
      } else if (id.startsWith("creward:")) {
        const crSubId = id.slice("creward:".length);
        if (paidBridgedCreward.has(crSubId)) continue; // already counted on-chain
        add(d.mintAddress, d.totalPayoutUsdc, d.createdAt);
      }
    }

    for (const k of Object.keys(out)) {
      out[k].lifetime = Math.round(out[k].lifetime * 100) / 100;
      out[k].monthly = Math.round(out[k].monthly * 100) / 100;
    }
    return out;
  },
});

/**
 * Total collected views per agent, summed across every campaign it has joined.
 * Returns { influencerMint → totalViews }. BOUNDED scan (never collect() the whole
 * table) so it stays within Convex's per-query read limit as submissions grow.
 */
export const viewsByAgent = query({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, number> = {};
    const SCAN = 8000;
    for (const s of await ctx.db.query("submissions").order("desc").take(SCAN)) {
      const v = typeof s.viewCount === "number" && s.viewCount > 0 ? s.viewCount : 0;
      if (!s.influencerMint || v <= 0) continue;
      out[s.influencerMint] = (out[s.influencerMint] ?? 0) + v;
    }
    return out;
  },
});

export const listByInfluencer = query({
  args: { influencerMint: v.string() },
  handler: async (ctx, { influencerMint }) => {
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_influencer_mint", (q) => q.eq("influencerMint", influencerMint))
      .collect();
    return Promise.all(
      submissions.map(async (sub) => {
        const campaign = await ctx.db.get(sub.campaignId);
        return { ...sub, campaign };
      })
    );
  },
});

/**
 * Recent submissions across all campaigns, joined with the campaign's brand +
 * title. Powers the agent-activity marquee on the Stage page.
 */
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const subs = await ctx.db.query("submissions").order("desc").take(limit ?? 40);
    return Promise.all(
      subs.map(async (sub) => {
        const campaign = await ctx.db.get(sub.campaignId);
        return {
          _id: sub._id,
          influencerName: sub.influencerName,
          submitterWallet: sub.submitterWallet,
          status: sub.status,
          platform: sub.platform ?? null,
          payoutAmountUsdc: sub.payoutAmountUsdc ?? null,
          campaignTitle: campaign?.title ?? "a campaign",
          brandName: campaign?.brandName ?? "",
          createdAt: sub._creationTime,
        };
      })
    );
  },
});

/** Latest submissions joined with the agent's profile (avatar/name/handle) for the
 *  landing-page showcase. Newest first; each row carries the agent that posted it. */
export const listShowcase = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const max = limit ?? 6;
    const subs = await ctx.db.query("submissions").order("desc").take(60);

    const agentCache = new Map<string, { name: string; avatarUrl: string; handle: string; niche: string; agentType?: string } | null>();
    const getAgent = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const a = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
        .first();
      const lite = a ? { name: a.name, avatarUrl: a.avatarUrl, handle: a.handle, niche: a.niche, agentType: a.agentType } : null;
      agentCache.set(mint, lite);
      return lite;
    };

    const out = [];
    for (const s of subs) {
      const agent = await getAgent(s.influencerMint);
      const campaign = await ctx.db.get(s.campaignId);
      out.push({
        _id: s._id,
        name: agent?.name ?? s.influencerName,
        handle: agent?.handle ?? s.influencerName,
        avatarUrl: agent?.avatarUrl ?? "",
        agentType: agent?.agentType ?? agent?.niche ?? "agent",
        platform: s.platform ?? "",
        postUrl: s.postUrl ?? "",
        viewCount: s.viewCount ?? 0,
        campaignTitle: campaign?.title ?? "",
        brandName: campaign?.brandName ?? "",
      });
      if (out.length >= max) break;
    }
    return out;
  },
});

/** Platform-wide submission totals for the Stage stat bar. */
export const globalStats = query({
  args: {},
  handler: async (ctx) => {
    // BOUNDED scan. `collect()` over ALL submissions threw once the table grew
    // past Convex's per-query read limit (agents add submissions daily), which
    // crashed the /stage page. Read a generous recent window instead — plenty for
    // a live stat bar, and it never exceeds the limit.
    const SCAN = 8000;
    const subs = await ctx.db.query("submissions").order("desc").take(SCAN);
    const approved = subs.filter(
      (s) => s.status === "approved" || s.status === "verified"
    ).length;
    const posted = subs.filter((s) => !!s.postUrl).length;
    const agents = new Set(subs.map((s) => s.influencerMint)).size;
    return { total: subs.length, approved, posted, agents };
  },
});

export const listByCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    return await ctx.db
      .query("submissions")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
  },
});

/** Every submission in a campaign, enriched with the agent's avatar + a computed
 *  total-earnings figure, newest first — powers the Submissions table + per-post
 *  View modal + Payout-history card on the campaign detail page (creator, platform,
 *  post link, views, status, per-post payout + attestation). Now ONE ROW PER POST
 *  (an agent that posts N clips has N payable rows); the client still de-dupes by
 *  `_id` as defense-in-depth. */
export const listByCampaignEnriched = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .order("desc")
      .collect();

    const avatarByMint = new Map<string, string | null>();
    const getAvatar = async (mint: string): Promise<string | null> => {
      if (avatarByMint.has(mint)) return avatarByMint.get(mint) ?? null;
      const inf = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
        .first();
      const url = inf?.avatarUrl ?? null;
      avatarByMint.set(mint, url);
      return url;
    };

    // LIVE views: the analytics sync (every 5 min) keeps clips.viewCount fresh,
    // while a submission's own viewCount only moves when the oracle settles — so
    // the campaign page lagged real views badly. Join each participating agent's
    // clips (by submissionId, else the post URL) and show the higher number.
    const liveViews = new Map<string, number>();
    const mints = [...new Set(subs.map((x) => x.influencerMint).filter(Boolean))].slice(0, 40);
    for (const mint of mints) {
      const clips = await ctx.db.query("clips").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).order("desc").take(300);
      for (const c of clips) {
        const n = typeof c.viewCount === "number" ? c.viewCount : 0;
        if (n <= 0) continue;
        for (const key of [c.submissionId ? `sub:${c.submissionId}` : "", c.postUrl ? `url:${c.postUrl}` : ""]) {
          if (key && n > (liveViews.get(key) ?? 0)) liveViews.set(key, n);
        }
      }
    }
    const viewsFor = (s: (typeof subs)[number]) => Math.max(
      s.viewCount ?? 0,
      liveViews.get(`sub:${s._id}`) ?? 0,
      s.postUrl ? liveViews.get(`url:${s.postUrl}`) ?? 0 : 0,
    );

    return Promise.all(
      subs.map(async (s) => ({
        _id: s._id,
        influencerName: s.influencerName,
        influencerMint: s.influencerMint,
        submitterWallet: s.submitterWallet,
        avatarUrl: await getAvatar(s.influencerMint),
        platform: s.platform ?? null,
        postUrl: s.postUrl ?? null,
        // Native post id — lets the View modal deep-link even when postUrl lags.
        platformPostId: s.platformPostId ?? null,
        viewCount: viewsFor(s),
        // "Total earnings" — actual paid/claimable first, else NAV accrued.
        earningsUsdc: s.paidUsdc ?? s.payoutAmountUsdc ?? s.navCreditedUsdc ?? 0,
        // Per-post payout estimate + on-chain attestation (Payout-history card).
        payoutAmountUsdc: s.payoutAmountUsdc ?? 0,
        attestationTx: s.attestationTx ?? null,
        status: s.status,
        payoutTxSignature: s.payoutTxSignature ?? null,
        createdAt: s.postedAt ?? s._creationTime,
      })),
    );
  },
});

// RESIDUAL (left public, ungated): the campaign "join" from the browser (builder +
// campaign-detail useMutation), so it can't carry the internal secret. It only accepts
// a bare postUrl/platform — NOT the oracle-payable identity fields (platformPostId /
// uploadPostRequestId), which live on the secret-gated submitForCampaign/setPostLink —
// so it cannot forge a payable/verifiable submission. Worst case is spam join rows /
// mis-attributing a public postUrl to an agent, which the brand/oracle ignores.
export const submit = mutation({
  args: {
    campaignId: v.id("campaigns"),
    influencerMint: v.string(),
    influencerName: v.string(),
    submitterWallet: v.string(),
    // Optional at join time — attached now if the post already exists, else
    // filled in later by setPostLink once the deliverable is published.
    platform: v.optional(v.string()),
    postUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("Campaign not found");

    // Platform gate — a submission may only target a platform this campaign
    // accepts. The connected-account requirement (agent must have linked one of
    // these socials) is evaluated client-side before submit; this is the
    // server-side backstop so a submission can never land on a rejected network.
    const accepted = (campaign.platforms ?? []).map((p) => p.toLowerCase().trim()).filter(Boolean);
    if (accepted.length > 0 && args.platform) {
      const norm = (p: string) => {
        const s = p.toLowerCase().trim();
        if (s === "twitter") return "x";
        if (s === "insta" || s === "ig") return "instagram";
        if (s === "fb") return "facebook";
        return s;
      };
      if (!accepted.map(norm).includes(norm(args.platform))) {
        throw new Error(
          `This campaign only accepts submissions on ${accepted.join(", ")}. Connect one of those accounts to join.`,
        );
      }
    }

    const existing = await ctx.db
      .query("submissions")
      .withIndex("by_campaign_and_mint", (q) => q.eq("campaignId", args.campaignId).eq("influencerMint", args.influencerMint))
      .first();
    if (existing) throw new Error("Already submitted to this campaign");

    const id = await ctx.db.insert("submissions", {
      ...args,
      // A post link present at join time means it's already submitted.
      status: args.postUrl ? "submitted" : "pending",
    });

    await ctx.runMutation(internal.campaigns.incrementSubmissions, {
      id: args.campaignId,
    });

    return id;
  },
});

/**
 * Reverse wallet→account-email lookup, mirroring `users.walletsForEmail`'s union of
 * `users.walletAddress` (legacy/primary) with the normalized `walletLinks` rows. A
 * wallet belongs to at most one account (enforced in `users.linkWalletInternal`).
 * Returns null when the wallet is not linked to any account, or that account has no
 * email — which the restricted gate treats as "not positively confirmed" (fail closed).
 */
async function resolveEmailForWallet(
  ctx: { db: MutationCtx["db"] },
  wallet: string,
): Promise<string | null> {
  if (!wallet) return null;
  const primary = await ctx.db
    .query("users")
    .withIndex("by_wallet", (q) => q.eq("walletAddress", wallet))
    .first();
  if (primary?.email) return primary.email;
  const link = await ctx.db
    .query("walletLinks")
    .withIndex("by_wallet", (q) => q.eq("walletAddress", wallet))
    .first();
  if (link) {
    const owner = await ctx.db.get(link.userId);
    if (owner?.email) return owner.email;
  }
  return null;
}

/**
 * DEFENSE-IN-DEPTH restriction gate — the true CHOKE POINT shared by the two
 * money-binding submission mutations (`submitForCampaign` / `submitClipToCampaign`).
 *
 * The clip executors already strip a restricted `campaignId` at enqueue
 * (`restrictedCampaignGates`), and run-task `post_content` gates it before calling
 * `submitForCampaign` — but those cover only their own call paths. Gating HERE makes
 * ANY caller (the drip scheduler, a direct HTTP call with a forged campaignId, a
 * future caller) unable to bind a restricted campaign's funded on-chain vault for a
 * non-allowed submitter.
 *
 * Given an already-resolved `Id<"campaigns">` + the submitter wallet, returns true
 * when the bind must be BLOCKED: the campaign is one of the restricted 12 (matched
 * by its DEFINITIVE `contentRewardId` — preferUuid, so a merely-same-title PUBLIC
 * campaign is never wrongly gated) AND the submitter's account email is NOT the
 * single allowed one. FAIL-CLOSED: a restricted campaign whose submitter wallet
 * cannot be positively resolved to the allowed email is blocked. Non-restricted
 * campaigns and allowed submitters are never blocked (unchanged behaviour).
 */
async function restrictedBindBlocked(
  ctx: { db: MutationCtx["db"] },
  campaignId: Id<"campaigns">,
  submitterWallet: string,
): Promise<boolean> {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign) return false; // no such campaign → nothing payable; leave the normal path
  if (
    !isRestrictedCampaign({
      contentRewardId: campaign.contentRewardId,
      title: campaign.title,
      preferUuid: true,
    })
  ) {
    return false; // not one of the restricted 12 → unchanged behaviour
  }
  const email = await resolveEmailForWallet(ctx, submitterWallet);
  return !isAllowedRestrictedEmail(email); // restricted → allow ONLY the single account (fail closed)
}

/**
 * PER-POST campaign submission by raw campaignId string — the autonomous video
 * flow's "join + submit" in one call. The heartbeat planner emits a create_video
 * with only the campaignId (no submissionId exists yet), so when that video
 * renders + auto-posts there is no submission to attach the link to.
 *
 * Each DISTINCT post becomes its own submission so the oracle attests + pays each
 * clip independently (get paid on every clip, not just one). The Convex `_id` of
 * each submission is the on-chain `submission_id`, and the escrow ClaimRecord PDA
 * is seeded by `[b"claim", campaignPda, submission_id]` — so per-post rows already
 * map to independent, budget-capped on-chain payouts (no program change needed).
 *
 * Behaviour (see `lib/submissionIdentity.decideSubmission`):
 *  - post identity = first non-empty of uploadPostRequestId → platformPostId → postUrl.
 *  - a re-send of the SAME post (matching identity) PATCHES its existing row
 *    (settled-guarded) — no duplicate, so no second ClaimRecord for one post.
 *  - a genuinely-new post INSERTS a new row (new _id → new ClaimRecord) and bumps
 *    the campaign submissions count.
 *  - a bare join (no post identity) keeps at most ONE "pending" row; the FIRST real
 *    post fills that pending row (no extra count), and posts #2..n get new rows.
 *  - the settled-guard is PER SUBMISSION: a settled post #1 never blocks post #2.
 */
export const submitForCampaign = mutation({
  args: {
    campaignId: v.string(), // raw string from the planner/video job; validated below
    influencerMint: v.string(),
    influencerName: v.string(),
    submitterWallet: v.string(),
    postUrl: v.optional(v.string()),
    platform: v.optional(v.string()),
    uploadPostRequestId: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // Secret-gate: this accepts oracle-payable fields (platformPostId/
    // uploadPostRequestId/postedAt), so a client must NOT be able to forge a
    // submission. Trusted callers (the videoJobs auto-post action, and the Next
    // routes that hold INTERNAL_CRON_SECRET) forward it.
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || args.authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const campaignId = ctx.db.normalizeId("campaigns", args.campaignId);
    if (!campaignId) return { ok: false as const, error: "invalid campaignId" };

    // DEFENSE-IN-DEPTH (restricted 12): never bind a restricted campaign's funded
    // on-chain vault for a non-allowed submitter — covers ANY caller (drip/direct/
    // future), not just run-task post_content. Fail-closed on the allow check.
    if (await restrictedBindBlocked(ctx, campaignId, args.submitterWallet)) {
      return { ok: false as const, skipped: "restricted" as const };
    }

    const incoming = {
      uploadPostRequestId: args.uploadPostRequestId,
      platformPostId: args.platformPostId,
      postUrl: args.postUrl,
    };

    // THIS agent's rows for THIS campaign — bounded + complete via the compound
    // index (never scans other agents' rows), so the per-post dedupe can't miss a
    // duplicate and mint a second on-chain ClaimRecord for one post.
    const rows = await ctx.db
      .query("submissions")
      .withIndex("by_campaign_and_mint", (q) =>
        q.eq("campaignId", campaignId).eq("influencerMint", args.influencerMint))
      .collect();

    const decision = decideSubmission(rows, incoming);

    // Field bag applied on insert / attach — only present values are set.
    const postFields = {
      ...(args.postUrl ? { postUrl: args.postUrl } : {}),
      ...(args.platform ? { platform: args.platform } : {}),
      ...(args.uploadPostRequestId ? { uploadPostRequestId: args.uploadPostRequestId } : {}),
      ...(args.platformPostId ? { platformPostId: args.platformPostId } : {}),
      ...(args.postedAt !== undefined ? { postedAt: args.postedAt } : {}),
    };
    const settled = ["verified", "approved", "rejected"];

    switch (decision.action) {
      case "create-pending":
      case "create-new": {
        // A genuinely-new post (or the first bare join) → its own row + one count.
        const submissionId = await ctx.db.insert("submissions", {
          campaignId,
          influencerMint: args.influencerMint,
          influencerName: args.influencerName,
          submitterWallet: args.submitterWallet,
          status: hasRealPost(incoming) ? "submitted" : "pending",
          ...postFields,
        });
        await ctx.runMutation(internal.campaigns.incrementSubmissions, { id: campaignId });
        return { ok: true as const, submissionId, created: true };
      }
      case "reuse-pending": {
        // A prior bare join already holds the pending slot — don't spam a 2nd row.
        return { ok: true as const, submissionId: decision.id, created: false };
      }
      case "attach-to-pending": {
        // The FIRST real post fills the pending join row (never settled → safe).
        // No count bump: the pending join already counted when it was created.
        await ctx.db.patch(decision.id, { ...postFields, status: "submitted" });
        return { ok: true as const, submissionId: decision.id, created: false };
      }
      case "patch-duplicate": {
        // Same post re-sent → refresh its fields unless the oracle/brand settled it
        // (settled-guard PER SUBMISSION). postedAt stays write-once per row.
        const existing = await ctx.db.get(decision.id);
        if (existing && !settled.includes(existing.status)) {
          await ctx.db.patch(decision.id, {
            ...(args.postUrl ? { postUrl: args.postUrl } : {}),
            ...(args.platform ? { platform: args.platform } : {}),
            ...(args.uploadPostRequestId ? { uploadPostRequestId: args.uploadPostRequestId } : {}),
            ...(args.platformPostId ? { platformPostId: args.platformPostId } : {}),
            ...(existing.postedAt == null && args.postedAt !== undefined ? { postedAt: args.postedAt } : {}),
            status: "submitted",
          });
        }
        return { ok: true as const, submissionId: decision.id, created: false };
      }
    }
  },
});

/**
 * Attach the published post's link to a submission and mark it submitted.
 * Called after the agent posts the campaign deliverable to a social platform.
 * Leaves oracle-verified/approved/rejected submissions untouched.
 */
/** Mark a (pre-created) join failed when the auto-post produced no live link —
 *  so a campaign submission never sits "pending" with no post link. */
export const markFailed = mutation({
  args: { submissionId: v.id("submissions"), influencerMint: v.string(), reason: v.optional(v.string()), authSecret: v.string() },
  handler: async (ctx, { submissionId, influencerMint, reason, authSecret }) => {
    // Secret-gate: the browser can NO LONGER call this directly. Trusted callers
    // (the videoJobs auto-post action, or the /api/submissions/set-link route which
    // resolves + SIWS-checks ownership server-side) forward INTERNAL_CRON_SECRET.
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const submission = await ctx.db.get(submissionId);
    if (!submission) return { ok: false as const };
    // Defense-in-depth: a caller may only fail a submission for the agent it claims.
    if (submission.influencerMint !== influencerMint) return { ok: false as const };
    // Never override a submission that already has a link or was settled.
    const settled = ["verified", "approved", "rejected", "submitted"];
    if (submission.postUrl || settled.includes(submission.status)) return { ok: false as const };
    void reason; // (no notes field on submissions; status alone marks it failed)
    await ctx.db.patch(submissionId, { status: "failed" });
    return { ok: true as const };
  },
});

/**
 * Secret-gated server resolve of a submission by id. The /api/submissions/set-link
 * route uses this to read a submission's TRUE influencerMint server-side, so the
 * client can't claim ownership of someone else's submission with a forged mint.
 * Internal-only: requires INTERNAL_CRON_SECRET.
 */
export const getByIdServer = query({
  args: { submissionId: v.id("submissions"), authSecret: v.string() },
  handler: async (ctx, { submissionId, authSecret }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) {
      throw new Error("unauthorized");
    }
    return await ctx.db.get(submissionId);
  },
});

/**
 * Secret-gated server query: the submissions the oracle should measure NOW.
 *
 * A row is "due" when it is a posted, measurable, not-yet-settled deliverable
 * that has matured past `windowMs`:
 *  - status === "submitted" (read via the `by_status` index, NOT a table scan),
 *  - the oracle hasn't already settled it (`verificationDecision` unset),
 *  - it has a real, measurable post identity (uploadPostRequestId OR
 *    platformPostId — a bare postUrl isn't analytics-queryable on its own), and
 *  - its post (postedAt, else _creationTime) is older than `now - windowMs`.
 *
 * The post-index `.filter(...)` runs in JS over the already-narrowed "submitted"
 * rows — do NOT push a `.filter()` into the Convex query builder. Internal-only:
 * requires INTERNAL_CRON_SECRET (the /api oracle route forwards it).
 */
/**
 * Resolve the payout beneficiary wallet for an agent mint. Module-scope helper
 * shared by dueForVerification, dueForClaim, dueForReattest, and onchainJoinById
 * — previously duplicated verbatim in each function body.
 *
 * When the agent has an enabled on-chain vault (agentAccount.vaultEnabled ===
 * true AND vaultAddress is set), the vault PDA is returned so oracle rewards
 * land in the unified compute vault. Otherwise falls back to
 * influencers.agentWallet (custodial) — preserving the existing behaviour for
 * agents that have no vault yet.
 *
 * CORRECTNESS NOTE: claim.beneficiary locks at the FIRST record_performance
 * call on-chain. This projection must be in effect before a new submission's
 * first attestation. Pre-existing attested submissions already have their
 * beneficiary locked (custodial) and are not affected.
 */
async function resolveAgentWallet(
  db: QueryCtx["db"],
  mint: string,
): Promise<string | null> {
  const influencer = await db
    .query("influencers")
    .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
    .first();
  const acct = await db
    .query("agentAccount")
    .withIndex("by_mint", (q) => q.eq("mintAddress", mint))
    .first();
  // Return the vault PDA when the on-chain vault is enabled so rewards flow
  // into the compute vault. Fall back to the custodial agentWallet otherwise.
  if (acct?.vaultEnabled === true && acct.vaultAddress) {
    return acct.vaultAddress;
  }
  return influencer?.agentWallet ?? null;
}

/** Approved v2 posts whose on-chain view high-water may have grown. */
export const dueForGrowth = query({
  args: { authSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { authSecret, limit }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const now = Date.now();
    const out: Array<{
      _id: Id<"submissions">; campaignId: Id<"campaigns">; influencerMint: string;
      submitterWallet: string; platform: string | null; postUrl: string | null;
      platformPostId: string | null; uploadPostRequestId: string | null;
      postedAt: number; viewCount: number; growthCandidateViews?: number;
      growthCandidateAt?: number; creatorWallet: string; agentWallet: string;
    }> = [];
    let scanned = 0;
    for await (const s of ctx.db.query("submissions").withIndex("by_status", (q) => q.eq("status", "verified"))) {
      if (scanned++ >= 5000 || out.length >= (limit ?? 40)) break;
      if (s.verificationDecision !== "approved" || !s.attestationTx) continue;
      if (!s.platformPostId && !s.uploadPostRequestId) continue;
      if (now - (s.lastGrowthMeasuredAt ?? s.verifiedAt ?? s._creationTime) < 30 * 60 * 1000) continue;
      const campaign = await ctx.db.get(s.campaignId);
      if (!campaign || (campaign.onchainVersion ?? 1) < 2 || !campaign.pdaAddress || campaign.maxPayoutUsdc) continue;
      if (Date.parse(campaign.deadline) <= now || (campaign.spentUsdc ?? 0) >= campaign.budget) continue;
      const agentWallet = await resolveAgentWallet(ctx.db, s.influencerMint);
      if (!agentWallet) continue;
      out.push({
        _id: s._id, campaignId: s.campaignId, influencerMint: s.influencerMint,
        submitterWallet: s.submitterWallet, platform: s.platform ?? null, postUrl: s.postUrl ?? null,
        platformPostId: s.platformPostId ?? null, uploadPostRequestId: s.uploadPostRequestId ?? null,
        postedAt: s.postedAt ?? s._creationTime, viewCount: s.viewCount ?? 0,
        growthCandidateViews: s.growthCandidateViews, growthCandidateAt: s.growthCandidateAt,
        creatorWallet: campaign.creatorWallet, agentWallet,
      });
    }
    return out;
  },
});

type DueSubmission = {
  _id: Id<"submissions">;
  creationTimeMs: number;
  campaignId: Id<"campaigns">;
  influencerMint: string;
  submitterWallet: string;
  platform: string | null;
  postUrl: string | null;
  uploadPostRequestId: string | null;
  platformPostId: string | null;
  postedAt: number | null;
  // On-chain mirror joins (for the oracle route's record_performance call on v2
  // campaigns; v1 ignores these). `agentWallet` = the payout beneficiary; null
  // when the agent has no provisioned wallet yet (keeper must skip/flag).
  // `onchainVersion` null = legacy v1 (off-chain).
  agentWallet: string | null;
  creatorWallet: string | null;
  onchainVersion: number | null;
  // When this submission mirrors a jobtepi/ryze content_rewards_submissions row,
  // its Supabase id — the oracle backfills the measured views onto it (display).
  contentRewardSubmissionId: string | null;
};

export const dueForVerification = query({
  args: {
    authSecret: v.string(),
    windowMs: v.optional(v.number()), // maturation: only posts older than this. default 0.
    limit: v.optional(v.number()), // default 50
    nowMs: v.optional(v.number()), // for deterministic tests; default Date.now()
  },
  // Explicit return type: the `for await` over Convex's AsyncIterableIterator<any>
  // otherwise lets `any` leak into the inferred handler return, degrading
  // FunctionReturnType (and every typed test consumer of this query) to `any`.
  handler: async (ctx, { authSecret, windowMs, limit, nowMs }): Promise<DueSubmission[]> => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const now = nowMs ?? Date.now();
    const win = windowMs ?? 0;
    const max = limit ?? 50;
    // Stream "submitted" rows oldest-first via async iteration and collect up to
    // `max` DUE rows, regardless of how many permanently-stuck (postUrl-only)
    // rows precede them. A bounded `.take(500)`+filter would starve the oracle
    // once >500 stuck rows pile up at the front. Bound the scan by SCAN_CAP so a
    // single tick can't run unbounded (remaining due rows settle next tick).
    const SCAN_CAP = 5000;
    let scanned = 0;
    const due: DueSubmission[] = [];
    // Memoize the join lookups so a campaign/agent with many due rows is read
    // once per tick, not once per row.
    const campaignCache = new Map<string, { creatorWallet: string | null; onchainVersion: number | null }>();
    const agentCache = new Map<string, string | null>();
    const resolveCampaign = async (id: Id<"campaigns">) => {
      const key = id as string;
      const cached = campaignCache.get(key);
      if (cached) return cached;
      const c = await ctx.db.get(id);
      const lite = { creatorWallet: c?.creatorWallet ?? null, onchainVersion: c?.onchainVersion ?? null };
      campaignCache.set(key, lite);
      return lite;
    };
    const getAgentWallet = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const w = await resolveAgentWallet(ctx.db, mint);
      agentCache.set(mint, w);
      return w;
    };
    for await (const s of ctx.db
      .query("submissions")
      .withIndex("by_status", (q) => q.eq("status", "submitted"))) {
      if (scanned++ >= SCAN_CAP) {
        console.warn(`[dueForVerification] scan cap ${SCAN_CAP} reached; remaining due rows deferred to next tick`);
        break;
      }
      if (
        s.verificationDecision === undefined && // not yet settled by the oracle
        (!!s.uploadPostRequestId || !!s.platformPostId) && // has a real, measurable post id
        (s.postedAt ?? s._creationTime) <= now - win // matured
      ) {
        const campaign = await resolveCampaign(s.campaignId);
        const agentWallet = await getAgentWallet(s.influencerMint);
        due.push({
          _id: s._id,
          creationTimeMs: s._creationTime, // for the route's duplicate tiebreak
          campaignId: s.campaignId,
          influencerMint: s.influencerMint,
          submitterWallet: s.submitterWallet,
          platform: s.platform ?? null,
          postUrl: s.postUrl ?? null,
          uploadPostRequestId: s.uploadPostRequestId ?? null,
          platformPostId: s.platformPostId ?? null,
          postedAt: s.postedAt ?? null,
          agentWallet,
          creatorWallet: campaign.creatorWallet,
          onchainVersion: campaign.onchainVersion,
          contentRewardSubmissionId: s.contentRewardSubmissionId ?? null,
        });
        if (due.length >= max) break;
      }
    }
    return due;
  },
});

/**
 * Secret-gated server query: the approved submissions the claim keeper should
 * crank `claim_payout` for NOW. A row is "due for claim" when:
 *  - the oracle approved it (`verificationDecision === "approved"`),
 *  - it has a positive payout estimate (`payoutAmountUsdc > 0`),
 *  - the oracle already recorded performance on-chain (`attestationTx` present),
 *  - it is not fully paid yet (`(paidUsdc ?? 0) < payoutAmountUsdc`), AND
 *  - its campaign is on the on-chain rail (`onchainVersion >= 2`) — legacy v1
 *    campaigns are paid off-chain via distributions.dispatch and must NOT be
 *    cranked.
 *
 * Joins campaigns (creatorWallet → campaign PDA seed; onchainVersion gate) and
 * influencers (agentWallet → beneficiary) so the claim route derives the
 * campaign PDA + beneficiary without extra round-trips. Streams the by_status
 * "verified" rows (approved submissions land in status "verified") via async
 * iteration with a SCAN_CAP, same idiom as dueForVerification. Explicit return
 * type so the for-await element type can't leak `any`. Internal-only: requires
 * INTERNAL_CRON_SECRET.
 */
type ClaimDue = {
  _id: Id<"submissions">;
  campaignId: Id<"campaigns">;
  influencerMint: string;
  payoutAmountUsdc: number;
  paidUsdc: number;
  /** Cumulative NET already credited to NAV for this submission (mirror). The
   *  claim keeper feeds this into computeClaimSettlement as the idempotency
   *  guard so a multi-tranche payout credits only the per-tick delta. */
  navCreditedUsdc: number;
  attestationTx: string;
  creatorWallet: string | null;
  agentWallet: string | null;
};

/** v1 re-drive probe (E2E hunt #11): verified+approved submissions on the LEGACY
 *  off-chain rail (campaign.onchainVersion ?? 1 < 2) with a positive payout that
 *  have NO distributions row yet — i.e. their scheduled dispatch dropped. The
 *  keeper (crons.runV1Distributions) POSTs each to /api/agents/distribute-earnings,
 *  which is idempotent on submissionId, so a row that actually credited is skipped. */
export const dueForDistribution = query({
  args: { authSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    { authSecret, limit },
  ): Promise<Array<{ mintAddress: string; payoutUsdc: number; campaignId: string; submissionId: string }>> => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET)
      throw new Error("unauthorized");
    const max = limit ?? 50;
    const SCAN_CAP = 5000;
    let scanned = 0;
    const out: Array<{ mintAddress: string; payoutUsdc: number; campaignId: string; submissionId: string }> = [];
    const verCache = new Map<string, number>();
    const resolveVer = async (id: Id<"campaigns">) => {
      const k = id as string;
      const cached = verCache.get(k);
      if (cached !== undefined) return cached;
      const doc = await ctx.db.get(id);
      const ver = doc?.onchainVersion ?? 1;
      verCache.set(k, ver);
      return ver;
    };
    for await (const s of ctx.db
      .query("submissions")
      .withIndex("by_status", (q) => q.eq("status", "verified"))) {
      if (scanned++ >= SCAN_CAP) {
        console.warn(`[dueForDistribution] scan cap ${SCAN_CAP} reached; remaining deferred to next tick`);
        break;
      }
      if (s.verificationDecision !== "approved") continue;
      const payout = s.payoutAmountUsdc ?? 0;
      if (payout <= 0) continue;
      if ((await resolveVer(s.campaignId)) >= 2) continue; // v2 uses the on-chain claim keeper
      const existing = await ctx.db
        .query("distributions")
        .withIndex("by_submission", (q) => q.eq("submissionId", s._id as string))
        .first();
      if (existing) continue; // already credited
      out.push({
        mintAddress: s.influencerMint,
        payoutUsdc: payout,
        campaignId: s.campaignId as string,
        submissionId: s._id as string,
      });
      if (out.length >= max) break;
    }
    return out;
  },
});

export const dueForClaim = query({
  args: {
    authSecret: v.string(),
    limit: v.optional(v.number()), // default 50
  },
  handler: async (ctx, { authSecret, limit }): Promise<ClaimDue[]> => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const max = limit ?? 50;
    const SCAN_CAP = 5000;
    let scanned = 0;
    const out: ClaimDue[] = [];
    // Memoized joins — read each campaign/agent at most once per tick.
    const campaignCache = new Map<string, { creatorWallet: string | null; onchainVersion: number | null }>();
    const agentCache = new Map<string, string | null>();
    const resolveCampaign = async (id: Id<"campaigns">) => {
      const key = id as string;
      const cached = campaignCache.get(key);
      if (cached) return cached;
      const c = await ctx.db.get(id);
      const lite = { creatorWallet: c?.creatorWallet ?? null, onchainVersion: c?.onchainVersion ?? null };
      campaignCache.set(key, lite);
      return lite;
    };
    const getAgentWallet = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const w = await resolveAgentWallet(ctx.db, mint);
      agentCache.set(mint, w);
      return w;
    };
    // Approved submissions sit in status "verified" (see campaigns.markVerified).
    for await (const s of ctx.db
      .query("submissions")
      .withIndex("by_status", (q) => q.eq("status", "verified"))) {
      if (scanned++ >= SCAN_CAP) {
        console.warn(`[dueForClaim] scan cap ${SCAN_CAP} reached; remaining due rows deferred to next tick`);
        break;
      }
      const payout = s.payoutAmountUsdc ?? 0;
      const paid = s.paidUsdc ?? 0;
      if (
        s.verificationDecision === "approved" &&
        payout > 0 &&
        !!s.attestationTx &&
        // Intentionally NOT gated on `paid < payout`. A fully-paid row whose NAV
        // credit LAGGED on the completing tick (a transient distribute-earnings or
        // PlatformConfig-fee read failure deferred it) must STAY due so the keeper
        // retries the credit. `claimDone` — set true ONLY when fully paid AND fully
        // credited — is the real terminal signal; the keeper skips the on-chain
        // crank for an already-paid row and just back-fills the lagging NAV credit.
        s.claimDone !== true // terminal/budget-clamped/fully-settled rows leave the claim set
      ) {
        const campaign = await resolveCampaign(s.campaignId);
        if ((campaign.onchainVersion ?? 1) < 2) continue; // v1 paid off-chain — skip
        const agentWallet = await getAgentWallet(s.influencerMint);
        out.push({
          _id: s._id,
          campaignId: s.campaignId,
          influencerMint: s.influencerMint,
          payoutAmountUsdc: payout,
          paidUsdc: paid,
          navCreditedUsdc: s.navCreditedUsdc ?? 0,
          attestationTx: s.attestationTx!,
          creatorWallet: campaign.creatorWallet,
          agentWallet,
        });
        if (out.length >= max) break;
      }
    }
    return out;
  },
});

/**
 * Secret-gated server query: the APPROVED-but-unpaid v2 submissions whose
 * on-chain attestation basis must be REFRESHED this tick so a claim never goes
 * permanently `AttestationStale`.
 *
 * Background: `record_performance` fires exactly ONCE per submission (the fresh
 * settle path), then the approved row leaves `dueForVerification` forever. On
 * chain `ClaimRecord.last_recorded_slot` is then frozen at that single
 * attestation. If the claim keeper misses the `[dispute, staleness]` window once
 * (an outage), the clip is permanently unclaimable and the USDC strands. To
 * prevent that we re-record the SAME cumulative `viewCount` every oracle tick:
 * the program accepts `verified_views == stored` and just refreshes
 * `last_recorded_slot` (lib.rs ~236-256), keeping the basis fresh.
 *
 * A row is "due for re-attest" when (mirrors `dueForClaim`'s structure):
 *  - the oracle approved it (`verificationDecision === "approved"`),
 *  - the oracle already recorded performance on-chain (`attestationTx` present),
 *  - it is not fully paid yet (`(paidUsdc ?? 0) < payoutAmountUsdc`),
 *  - it is not terminal (`claimDone !== true`), AND
 *  - its campaign is on the on-chain rail (`onchainVersion >= 2`).
 *
 * Joins campaigns (creatorWallet → campaign PDA seed; onchainVersion gate) and
 * influencers (agentWallet → beneficiary) so the route re-records without extra
 * round-trips. Streams the by_status "verified" rows via async iteration with a
 * SCAN_CAP, same idiom as `dueForClaim`. Explicit return type so the for-await
 * element type can't leak `any`. Internal-only: requires INTERNAL_CRON_SECRET.
 */
type ReattestDue = {
  _id: Id<"submissions">;
  campaignId: Id<"campaigns">;
  influencerMint: string;
  viewCount: number;
  payoutAmountUsdc: number;
  creatorWallet: string | null;
  agentWallet: string | null;
};

// How long a v2 attestation may sit on-chain before we refresh its slot. MUST be
// LESS than the on-chain max_staleness (so the attestation never actually goes
// stale) and GREATER than the dispute window (so the claim keeper has a clear
// window to crank claim_payout BEFORE the next refresh re-arms last_recorded_slot).
// The staleness default is ~200k slots ≈ 22h; a 12h refresh sits safely between a
// ~1h dispute window and that ceiling. Re-recording every oracle tick (30 min)
// instead PERMANENTLY re-armed the dispute window < its length → claim_payout
// reverted InDisputeWindow forever and the USDC stranded. Env-tunable.
export const REATTEST_INTERVAL_MS = Number(
  globalThis.process.env.VELLO_REATTEST_INTERVAL_MS ?? 12 * 60 * 60 * 1000,
);

export const dueForReattest = query({
  args: {
    authSecret: v.string(),
    limit: v.optional(v.number()), // default 50
    nowMs: v.optional(v.number()), // testability; defaults to Date.now()
  },
  handler: async (ctx, { authSecret, limit, nowMs }): Promise<ReattestDue[]> => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const max = limit ?? 50;
    const now = nowMs ?? Date.now();
    const SCAN_CAP = 5000;
    let scanned = 0;
    const out: ReattestDue[] = [];
    // Memoized joins — read each campaign/agent at most once per tick.
    const campaignCache = new Map<string, { creatorWallet: string | null; onchainVersion: number | null }>();
    const agentCache = new Map<string, string | null>();
    const resolveCampaign = async (id: Id<"campaigns">) => {
      const key = id as string;
      const cached = campaignCache.get(key);
      if (cached) return cached;
      const c = await ctx.db.get(id);
      const lite = { creatorWallet: c?.creatorWallet ?? null, onchainVersion: c?.onchainVersion ?? null };
      campaignCache.set(key, lite);
      return lite;
    };
    const getAgentWallet = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const w = await resolveAgentWallet(ctx.db, mint);
      agentCache.set(mint, w);
      return w;
    };
    // Approved submissions sit in status "verified" (see campaigns.markVerified).
    for await (const s of ctx.db
      .query("submissions")
      .withIndex("by_status", (q) => q.eq("status", "verified"))) {
      if (scanned++ >= SCAN_CAP) {
        console.warn(`[dueForReattest] scan cap ${SCAN_CAP} reached; remaining rows deferred to next tick`);
        break;
      }
      const payout = s.payoutAmountUsdc ?? 0;
      const paid = s.paidUsdc ?? 0;
      if (
        s.verificationDecision === "approved" &&
        !!s.attestationTx && // already recorded on-chain — has a basis to refresh
        payout > 0 &&
        paid < payout && // not fully paid yet
        s.claimDone !== true // terminal/budget-clamped rows don't need refreshing
      ) {
        const campaign = await resolveCampaign(s.campaignId);
        if ((campaign.onchainVersion ?? 1) < 2) continue; // v1 paid off-chain — never re-records
        // THROTTLE: only refresh as staleness nears. Re-recording on every tick
        // re-arms the on-chain dispute window faster than it elapses, so
        // claim_payout can never satisfy `now >= last_recorded_slot + dispute` →
        // the payout strands. Basis = the last time we recorded on-chain
        // (lastReattestAt), else first attestation (verifiedAt), else row age.
        const basisAt = s.lastReattestAt ?? s.verifiedAt ?? s._creationTime;
        if (now - basisAt < REATTEST_INTERVAL_MS) continue;
        const agentWallet = await getAgentWallet(s.influencerMint);
        out.push({
          _id: s._id,
          campaignId: s.campaignId,
          influencerMint: s.influencerMint,
          viewCount: s.viewCount ?? 0,
          payoutAmountUsdc: payout,
          creatorWallet: campaign.creatorWallet,
          agentWallet,
        });
        if (out.length >= max) break;
      }
    }
    return out;
  },
});

/**
 * Secret-gated, BOUNDED peers for the oracle's per-submission duplicate/cluster
 * checks. The route memoizes this by campaignId per tick, so the oracle reads a
 * campaign's submissions ONCE instead of once-per-due-row (the old
 * `listByCampaign().collect()` was unbounded AND O(due × campaignSubmissions),
 * risking Convex's per-query read limit on a large campaign — which would drop
 * every settle for that campaign on every tick).
 *
 * Returns ONLY the projection `toPeer` consumes (`_id, _creationTime, status,
 * platform, platformPostId, postUrl, submitterWallet`). Explicit return type so
 * the index-scan's element type can't leak `any` into the inferred handler return
 * (same rationale as `dueForVerification`). Internal-only: requires
 * INTERNAL_CRON_SECRET.
 */
type PeerRow = {
  _id: Id<"submissions">;
  _creationTime: number;
  status: string;
  platform: string | null;
  platformPostId: string | null;
  postUrl: string | null;
  submitterWallet: string;
};

export const peersForVerification = query({
  args: {
    authSecret: v.string(),
    campaignId: v.id("campaigns"),
    limit: v.optional(v.number()), // default 3000
  },
  handler: async (ctx, { authSecret, campaignId, limit }): Promise<PeerRow[]> => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const rows = await ctx.db
      .query("submissions")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .take(limit ?? 3000);
    return rows.map((s) => ({
      _id: s._id,
      _creationTime: s._creationTime,
      status: s.status,
      platform: s.platform ?? null,
      platformPostId: s.platformPostId ?? null,
      postUrl: s.postUrl ?? null,
      submitterWallet: s.submitterWallet,
    }));
  },
});

export const setPostLink = mutation({
  args: {
    submissionId: v.id("submissions"),
    influencerMint: v.string(),
    postUrl: v.string(),
    platform: v.optional(v.string()),
    uploadPostRequestId: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    authSecret: v.string(),
  },
  handler: async (ctx, { submissionId, influencerMint, postUrl, platform, uploadPostRequestId, platformPostId, postedAt, authSecret }) => {
    // Secret-gate: the browser can NO LONGER call this directly. The earlier
    // influencerMint re-check was not sufficient — the agent mint is PUBLIC, so an
    // attacker could pass the victim's real mint and the equality passed, leaving the
    // IDOR open (any post URL pinned to any submission). Trusted callers (the videoJobs
    // auto-post action, or the /api/submissions/set-link route which resolves the
    // submission's agent and SIWS-checks ownership server-side) forward INTERNAL_CRON_SECRET.
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const submission = await ctx.db.get(submissionId);
    if (!submission) throw new Error("Submission not found");
    // Defense-in-depth: a caller may only attach a link to a submission for the agent
    // it claims (the route already proved ownership of this mint via SIWS).
    if (submission.influencerMint !== influencerMint) throw new Error("Unauthorized");
    // Don't regress a submission the oracle/brand already settled.
    const settled = ["verified", "approved", "rejected"];
    const nextStatus = settled.includes(submission.status) ? submission.status : "submitted";
    await ctx.db.patch(submissionId, {
      postUrl,
      ...(platform ? { platform } : {}),
      ...(uploadPostRequestId ? { uploadPostRequestId } : {}),
      ...(platformPostId ? { platformPostId } : {}),
      // postedAt is write-once: a re-link must NOT reset the maturation clock.
      ...(submission.postedAt == null && postedAt !== undefined ? { postedAt } : {}),
      status: nextStatus,
    });
    return { ok: true, status: nextStatus };
  },
});

/**
 * Resolve an influencer's submission for a specific campaign (used to attach a
 * post link by campaignId when the client only knows the campaign + mint).
 */
export const getForCampaign = query({
  args: { campaignId: v.id("campaigns"), influencerMint: v.string() },
  handler: async (ctx, { campaignId, influencerMint }) => {
    return await ctx.db
      .query("submissions")
      .withIndex("by_campaign_and_mint", (q) => q.eq("campaignId", campaignId).eq("influencerMint", influencerMint))
      .first();
  },
});

/**
 * Vello-native earning path for clips: when a clip job tied to a Vello campaign
 * posts a clip, create a separate campaign entry for each distinct published
 * post and link the clip to it. Retries reuse the same entry.
 */
export const submitClipToCampaign = mutation({
  args: {
    clipId: v.id("clips"),
    campaignId: v.string(), // raw string from clipJobs; validated below
    influencerMint: v.string(),
    influencerName: v.string(),
    submitterWallet: v.string(),
    // Optional now: a clip with no real post identity (CDN fallback only) records
    // the join as "pending" rather than a verifiable "submitted".
    postUrl: v.optional(v.string()),
    platform: v.optional(v.string()),
    uploadPostRequestId: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    // When this clip was also submitted to a jobtepi/ryze content_reward, that
    // Supabase content_rewards_submissions id — so the oracle can backfill the
    // measured views onto the ryze display row after it settles the USDC payout.
    contentRewardSubmissionId: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (ctx, args) => {
    // Internal-only: the sole caller is the clipJobs posting action, which holds
    // INTERNAL_CRON_SECRET. Gate so a client can't submit clips for arbitrary agents.
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || args.authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const campaignId = ctx.db.normalizeId("campaigns", args.campaignId);
    if (!campaignId) return { ok: false as const, error: "invalid campaignId" };

    // DEFENSE-IN-DEPTH (restricted 12): never link/submit a clip to a restricted
    // campaign's funded on-chain vault for a non-allowed submitter — the enqueue-time
    // gate already strips the campaignId, this covers direct/future callers too.
    if (await restrictedBindBlocked(ctx, campaignId, args.submitterWallet)) {
      return { ok: false as const, skipped: "restricted" as const };
    }

    const clip = await ctx.db.get(args.clipId);
    if (!clip || clip.mintAddress !== args.influencerMint) throw new Error("Clip does not belong to agent");
    // Share per-post identity handling with the video flow: retries reuse an
    // entry, distinct clips get distinct entries, and settled posts stay intact.
    const { clipId, contentRewardSubmissionId, ...post } = args;
    void clipId;
    const result: { ok: boolean; submissionId?: Id<"submissions"> } =
      await ctx.runMutation(api.submissions.submitForCampaign, post);
    if (!result.ok || !result.submissionId) return { ok: false as const, error: "Campaign submission failed" };
    const submissionId = result.submissionId;
    if (contentRewardSubmissionId) {
      const submission = await ctx.db.get(submissionId);
      if (submission && !submission.contentRewardSubmissionId) {
        await ctx.db.patch(submissionId, { contentRewardSubmissionId });
      }
    }

    await ctx.db.patch(args.clipId, { submissionId, updatedAt: Date.now() });
    return { ok: true as const, submissionId };
  },
});

/**
 * BRIDGE → USDC rail (shared by the DRIP + MANUAL post paths; parity with the
 * inline finalizeJob bridge in clipJobs.ts). Given a jobtepi/ryze content_reward
 * id and a posted clip's identity, find the FUNDED on-chain v2 vault linked to
 * that content_reward and record a Convex submission so the oracle reads views
 * on-chain and the claim keeper auto-pays the agent USDC.
 *
 * Money-safety: only submits when a FUNDED v2 vault (pdaAddress AND
 * onchainVersion>=2) is linked — never credits unbacked NAV. The funded-vault
 * scan mirrors campaigns.getFundedByContentRewardId (scan, not `.first()`, so a
 * stray v1/unfunded link can't shadow the funded vault); kept in sync with it.
 * Idempotent via submitClipToCampaign's per-post identity, so firing
 * it on drip/manual on top of any inline submit yields exactly one row.
 *
 * Public but INTERNAL_CRON_SECRET-gated: the Next /api/social/post route calls
 * it via ConvexHttpClient (which cannot invoke Convex internalQuery/internal
 * functions), so the funded-vault gate lives INSIDE this mutation and never
 * leaks to the client. Returns { ok:false, skipped } when no funded vault links.
 */
export const bridgeContentRewardToCampaign = mutation({
  args: {
    clipId: v.id("clips"),
    contentRewardId: v.string(),
    influencerMint: v.string(),
    influencerName: v.string(),
    submitterWallet: v.string(),
    postUrl: v.optional(v.string()),
    platform: v.optional(v.string()),
    uploadPostRequestId: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    contentRewardSubmissionId: v.optional(v.string()),
    authSecret: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: false; error?: string; skipped?: string }
    | { ok: true; submissionId: Id<"submissions"> | undefined }
  > => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || args.authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    if (!args.contentRewardId) return { ok: false as const, skipped: "no contentRewardId" as const };
    // Find the FUNDED v2 vault linked to this content_reward. Mirror of
    // campaigns.getFundedByContentRewardId (kept self-contained here so the drip
    // action + the Next route can reach the gate without an internalQuery hop).
    let fundedId: Id<"campaigns"> | null = null;
    for await (const c of ctx.db
      .query("campaigns")
      .withIndex("by_content_reward", (q) => q.eq("contentRewardId", args.contentRewardId))) {
      if (c.pdaAddress && (c.onchainVersion ?? 1) >= 2) { fundedId = c._id; break; }
    }
    if (!fundedId) return { ok: false as const, skipped: "no funded vault" as const };
    // Delegate to the single upsert path so clips.submissionId linking + the
    // per-(campaign, mint) idempotency + incrementSubmissions guard stay in ONE
    // place. Id<"campaigns"> is a branded string, assignable to the string arg.
    return await ctx.runMutation(api.submissions.submitClipToCampaign, {
      clipId: args.clipId,
      campaignId: fundedId,
      influencerMint: args.influencerMint,
      influencerName: args.influencerName,
      submitterWallet: args.submitterWallet,
      ...(args.postUrl ? { postUrl: args.postUrl } : {}),
      ...(args.platform ? { platform: args.platform } : {}),
      ...(args.uploadPostRequestId ? { uploadPostRequestId: args.uploadPostRequestId } : {}),
      ...(args.platformPostId ? { platformPostId: args.platformPostId } : {}),
      ...(args.postedAt !== undefined ? { postedAt: args.postedAt } : {}),
      ...(args.contentRewardSubmissionId ? { contentRewardSubmissionId: args.contentRewardSubmissionId } : {}),
      authSecret: args.authSecret,
    });
  },
});

export const approveSubmission = mutation({
  args: {
    submissionId: v.id("submissions"),
    payoutTxSignature: v.string(),
    callerWallet: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, { submissionId, payoutTxSignature, callerWallet, authSecret }) => {
    // SECRET-GATED: no live browser caller today (the legacy brand-approval UI is
    // gone), and `callerWallet` is client-supplied + the creatorWallet is public, so
    // an ungated v1 approve let anyone flip a submission to "approved". A revived brand
    // flow must route through a server endpoint that proves ownership (SIWS) and injects
    // INTERNAL_CRON_SECRET. v2 (on-chain USDC) rows stay oracle-only regardless (below).
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const submission = await ctx.db.get(submissionId);
    if (!submission) throw new Error("Submission not found");
    const approvable = ["pending", "submitted"];
    if (!approvable.includes(submission.status)) throw new Error("Submission already processed");
    const campaign = await ctx.db.get(submission.campaignId);
    if (!campaign) throw new Error("Campaign not found");
    // v2 (on-chain USDC treasury) submissions settle SOLELY via the oracle
    // (settleFromOracle → record_performance → claim_payout). This legacy
    // brand-approval mutation trusts a client-supplied callerWallet (Convex has
    // no native auth), so allowing it on a v2 row would let anyone flip an
    // agent's payable submission to "approved"/"rejected" and strand its USDC
    // (it would leave dueForVerification/dueForClaim permanently). Refuse.
    if ((campaign.onchainVersion ?? 1) >= 2) throw new Error("v2 submissions settle via the oracle, not manual approval");
    if (campaign.creatorWallet !== callerWallet) throw new Error("Unauthorized");
    await ctx.db.patch(submissionId, {
      status: "approved",
      payoutTxSignature,
    });
  },
});

export const rejectSubmission = mutation({
  args: {
    submissionId: v.id("submissions"),
    callerWallet: v.string(),
    authSecret: v.string(),
  },
  handler: async (ctx, { submissionId, callerWallet, authSecret }) => {
    // SECRET-GATED: mirror of approveSubmission — no live browser caller, and a forged
    // callerWallet must not be able to reject someone's submission. Server-only.
    if (!process.env.INTERNAL_CRON_SECRET || authSecret !== process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const submission = await ctx.db.get(submissionId);
    if (!submission) throw new Error("Submission not found");
    const rejectable = ["pending", "submitted"];
    if (!rejectable.includes(submission.status)) throw new Error("Submission already processed");
    const campaign = await ctx.db.get(submission.campaignId);
    if (!campaign) throw new Error("Campaign not found");
    // v2 (on-chain USDC) submissions are oracle-owned — a forged callerWallet
    // must not be able to reject an agent's payable row and strand its USDC. (See
    // approveSubmission for the full rationale.)
    if ((campaign.onchainVersion ?? 1) >= 2) throw new Error("v2 submissions settle via the oracle, not manual rejection");
    if (campaign.creatorWallet !== callerWallet) throw new Error("Unauthorized");
    await ctx.db.patch(submissionId, { status: "rejected" });
  },
});

/* ── Admin Submissions page: listing + residential-proxy view sync ──────────
 *
 * The /admin/submissions page lists EVERY agent submission with its agent
 * profile, platform, post link, live view count, status and payout. It exposes
 * 4 sync buttons:
 *   1. Upload-post realtime  → contentRewardMeasurements:syncNow (existing)
 *   2/3/4. Sync TikTok / Instagram / YouTube → `syncPlatformViews` below, which
 *      drives the `/api/oracle/scrape-views` worker. That worker fetches each
 *      post's live view count with vello's OWN scraper stack — the same yt-dlp
 *      binary + residential proxy (YTDLP_PROXY) used for clip downloads — and
 *      writes it back here. The Convex `listAllAdmin` subscription then pushes
 *      the new count to the page in realtime as each row is measured.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Every submission joined with its agent (name/handle/avatar) + campaign title,
 *  newest first. Bounded scan — never `collect()` the whole table. Admin page is
 *  gated at the layout level (profile.isAdmin), mirroring `influencers.listAll`.
 *  RESIDUAL (leaky read, left ungated): the layout gate protects the PAGE, not this
 *  Convex function — anyone with the public Convex URL can read every submission's
 *  post link + submitter wallet + payout. Not gated here because a browser admin can't
 *  supply INTERNAL_CRON_SECRET; the correct fix is to move the read behind a SIWS+admin
 *  Next endpoint (like submissions.syncPlatformViews/checkAdminToken already do) and
 *  have the page fetch that. Flagged for follow-up. */
export const listAllAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const max = Math.min(Math.max(1, limit ?? 1000), 5000);
    const subs = await ctx.db.query("submissions").order("desc").take(max);

    const agentCache = new Map<string, { name: string; handle: string; avatarUrl: string; agentType?: string } | null>();
    const getAgent = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const a = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).first();
      const lite = a ? { name: a.name, handle: a.handle, avatarUrl: a.avatarUrl, agentType: a.agentType } : null;
      agentCache.set(mint, lite);
      return lite;
    };
    const campaignCache = new Map<string, { title: string; brandName: string } | null>();
    const getCampaign = async (id: Id<"campaigns">) => {
      const key = String(id);
      if (campaignCache.has(key)) return campaignCache.get(key)!;
      const c = await ctx.db.get(id);
      const lite = c ? { title: c.title, brandName: c.brandName ?? "" } : null;
      campaignCache.set(key, lite);
      return lite;
    };

    const out = [];
    for (const s of subs) {
      const agent = await getAgent(s.influencerMint);
      const campaign = await getCampaign(s.campaignId);
      out.push({
        _id: s._id,
        campaignId: String(s.campaignId),
        // Present when this Convex row mirrors a Supabase content_rewards_submissions
        // row (bridged clipping submission) — the admin page dedups on it so the same
        // post isn't listed twice across the two stores.
        contentRewardSubmissionId: s.contentRewardSubmissionId ?? null,
        status: s.status,
        platform: s.platform ?? "",
        postUrl: s.postUrl ?? "",
        platformPostId: s.platformPostId ?? null,
        uploadPostRequestId: s.uploadPostRequestId ?? null,
        viewCount: s.viewCount ?? 0,
        payoutAmountUsdc: s.payoutAmountUsdc ?? 0,
        paidUsdc: s.paidUsdc ?? 0,
        influencerMint: s.influencerMint,
        influencerName: s.influencerName,
        agentName: agent?.name ?? s.influencerName,
        agentHandle: agent?.handle ?? "",
        agentAvatar: agent?.avatarUrl ?? "",
        agentType: agent?.agentType ?? "influencer",
        campaignTitle: campaign?.title ?? "",
        brandName: campaign?.brandName ?? "",
        postedAt: s.postedAt ?? null,
        createdAt: s._creationTime,
      });
    }
    return out;
  },
});

/**
 * Admin list of HIRE-per-video posts (the "Charge Per Video" skill / Hire button
 * on /agents). A hire is a flat, pre-paid commission — it is NOT a campaign or a
 * content-reward, so it never produces a `submissions` or `content_rewards_submissions`
 * row and was invisible in admin/submissions. We surface it here as its own source.
 *
 * The data already exists end-to-end with NO change to the hire write path:
 *  - the hire task is an `agentTasks` row of type `create_video` whose title starts
 *    with "Commissioned · " (set by /api/agents/hire-generate) and whose `output`
 *    JSON carries `post.url` / `post.platforms` (written by render-step's finishAll
 *    when the video auto-posts — even if the hire-generate request itself timed out).
 *  - the commission (USDC) is in the shared `distributions` ledger as a row with
 *    `submissionId = "hire:<taskId>"` (written by influencers.recordHireEarning);
 *    absent for hires whose recordHireEarning never ran (e.g. a pre-fix timeout) —
 *    then we fall back to 0 and still show the post.
 *
 * Money-safe: read-only join, touches no campaign/vault/NAV accounting.
 */
export const listAllHireAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const max = Math.min(Math.max(1, limit ?? 1000), 5000);
    // Bounded newest-first scan of succeeded tasks (mirrors listAllAdmin's bound).
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_status", (q) => q.eq("status", "succeeded"))
      .order("desc")
      .take(max);

    const agentCache = new Map<string, { name: string; avatarUrl: string; agentType?: string } | null>();
    const getAgent = async (mint: string) => {
      if (agentCache.has(mint)) return agentCache.get(mint)!;
      const a = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).first();
      const lite = a ? { name: a.name, avatarUrl: a.avatarUrl, agentType: a.agentType } : null;
      agentCache.set(mint, lite);
      return lite;
    };

    const out = [];
    for (const t of tasks) {
      // Discriminator: a hire is a create_video task titled "Commissioned · …".
      if (t.type !== "create_video" || !t.title.startsWith("Commissioned · ") || !t.output) continue;
      let post: { url?: string; platforms?: string[] } | undefined;
      let topic: string | undefined;
      let videoUrl: string | undefined;
      let generatedAt: number | undefined;
      try {
        const o = JSON.parse(t.output) as Record<string, unknown>;
        post = (o.post as { url?: string; platforms?: string[] }) ?? undefined;
        if (typeof o.topic === "string") topic = o.topic;
        if (typeof o.videoUrl === "string") videoUrl = o.videoUrl;
        if (typeof o.generatedAt === "number") generatedAt = o.generatedAt;
      } catch {
        continue;
      }
      const postUrl = typeof post?.url === "string" ? post.url : "";
      if (!postUrl) continue; // only surface hires that actually posted

      // Commission from the shared ledger (idempotency key "hire:<taskId>"); may be absent.
      const dist = await ctx.db
        .query("distributions")
        .withIndex("by_submission", (q) => q.eq("submissionId", `hire:${t._id}`))
        .first();

      const agent = await getAgent(t.mintAddress);
      out.push({
        taskId: String(t._id),
        mintAddress: t.mintAddress,
        agentName: agent?.name ?? "Agent",
        agentAvatar: agent?.avatarUrl ?? "",
        agentType: agent?.agentType ?? "influencer",
        platform: post?.platforms?.[0] ?? "",
        postUrl,
        videoUrl: videoUrl ?? null,
        title: topic ?? t.title.replace(/^Commissioned · /, ""),
        commissionUsdc: dist?.totalPayoutUsdc ?? 0,
        createdAt: generatedAt ?? t.completedAt ?? t._creationTime,
      });
    }
    return out;
  },
});

/** Secret-gated due-list for the scrape worker: campaign/clipping submissions on
 *  `platform` (tiktok/instagram/youtube) that are MEASURABLE and not paid/rejected.
 *  "Measurable" = has a live post permalink (yt-dlp proxy scrape) OR an upload-post
 *  handle (uploadPostRequestId / platformPostId → upload-post analytics, which needs
 *  NO url). Previously gated on `!!postUrl` only, which excluded every auto-posted
 *  clip whose permalink hadn't resolved yet (it carries only an uploadPostRequestId)
 *  — so those clips never synced views and never got their link backfilled. Returns
 *  the handles so the worker can measure by request_id and backfill the permalink.
 *  Newest first (recent posts gain views fastest); bounded. */
export const dueForScrape = query({
  args: { authSecret: v.string(), platform: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { authSecret, platform, limit }) => {
    gateSecret(authSecret);
    const cap = Math.min(Math.max(1, limit ?? 300), 1000);
    const rows = await ctx.db.query("submissions").order("desc").take(5000);
    return rows
      .filter(
        (s) =>
          (s.platform ?? "") === platform &&
          (!!s.postUrl || !!s.uploadPostRequestId || !!s.platformPostId) &&
          s.status !== "rejected" &&
          (s.paidUsdc ?? 0) === 0,
      )
      .slice(0, cap)
      .map((s) => ({
        _id: s._id,
        postUrl: s.postUrl ?? null,
        platform: s.platform ?? platform,
        viewCount: s.viewCount ?? 0,
        uploadPostRequestId: s.uploadPostRequestId ?? null,
        platformPostId: s.platformPostId ?? null,
        influencerMint: s.influencerMint,
      }));
  },
});

/** Secret-gated write-back from the scrape worker. Mirrors jobtepi's data-integrity
 *  rule: NEVER lower a recorded view count (scrapes can transiently under-read).
 *  Also backfills the real social permalink + native id the upload-post analytics
 *  resolved — but only when the resolved url is a genuine post link AND the stored
 *  postUrl isn't one yet (so an auto-posted clip stops showing "not posted"/no-link).
 *  Never touches status/payout, so it can't open a payout path. */
export const recordScrapedViews = mutation({
  args: {
    authSecret: v.string(),
    id: v.id("submissions"),
    viewCount: v.number(),
    postUrl: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
  },
  handler: async (ctx, { authSecret, id, viewCount, postUrl, platformPostId }) => {
    gateSecret(authSecret);
    const row = await ctx.db.get(id);
    if (!row) return { ok: false, updated: false };
    const patch: Record<string, unknown> = {};
    const next = Math.max(0, Math.floor(viewCount));
    if (next > (row.viewCount ?? 0)) patch.viewCount = next;
    if (row.status !== "rejected" && isSocialPermalink(postUrl || row.postUrl)) await enqueueVideoMilestone(ctx, {
      mintAddress: row.influencerMint, views: Math.max(next, row.viewCount ?? 0), key: `submission:${id}`,
      postUrl: postUrl || row.postUrl, platform: row.platform, platformPostId: platformPostId || row.platformPostId,
    });
    // Backfill the resolved permalink only over a non-permalink stored value.
    if (postUrl && isSocialPermalink(postUrl) && !isSocialPermalink(row.postUrl)) patch.postUrl = postUrl;
    if (platformPostId && !row.platformPostId) patch.platformPostId = platformPostId;
    if (Object.keys(patch).length === 0) return { ok: true, updated: false };
    await ctx.db.patch(id, patch);
    if (patch.viewCount !== undefined) await bumpLiveViews(ctx, next - (row.viewCount ?? 0)); // live hero counter
    return { ok: true, updated: true };
  },
});

/** Secret-gated due-list for the user-facing analytics "Refresh" button — same
 *  measurability rule as dueForScrape, but scoped to the caller's OWN agent
 *  mints instead of one platform across everyone. Called server-side (never
 *  directly by the browser) from /api/analytics/refresh-views, which has
 *  already verified the mints belong to the requesting user. */
export const dueForScrapeByMints = query({
  args: { authSecret: v.string(), mintAddresses: v.array(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { authSecret, mintAddresses, limit }) => {
    gateSecret(authSecret);
    const cap = Math.min(Math.max(1, limit ?? 200), 500);
    const mints = [...new Set(mintAddresses)].slice(0, 25);

    const rows = [];
    for (const mint of mints) {
      const subs = await ctx.db
        .query("submissions")
        .withIndex("by_influencer_mint", (q) => q.eq("influencerMint", mint))
        .order("desc")
        .take(150);
      for (const s of subs) {
        if (!(!!s.postUrl || !!s.uploadPostRequestId || !!s.platformPostId)) continue;
        if (s.status === "rejected") continue;
        rows.push({
          _id: s._id,
          postUrl: s.postUrl ?? null,
          platform: s.platform ?? "",
          viewCount: s.viewCount ?? 0,
          uploadPostRequestId: s.uploadPostRequestId ?? null,
          platformPostId: s.platformPostId ?? null,
          influencerMint: s.influencerMint,
        });
      }
    }
    return rows.slice(0, cap);
  },
});

/**
 * Record content-reward payouts (the agent's view-based clipper/UGC earnings) into
 * the `distributions` ledger — the single source of truth for agent earnings. Each
 * submission becomes an idempotent `creward:<id>` row (re-syncing UPDATES the
 * amount as views grow). Then recompute `monthlyEarnings`/`lifetimeEarningsUsdc`
 * per affected agent so the market page card, APR, PnL and chart all reflect it.
 * Secret-gated (the recalc-payout route passes INTERNAL_CRON_SECRET). `usdc` is the
 * payout already converted to USD by the caller.
 */
export const recordContentRewardEarnings = mutation({
  args: {
    authSecret: v.string(),
    items: v.array(v.object({
      contentRewardSubmissionId: v.string(),
      mintAddress: v.string(),
      usdc: v.number(),
      postedAtMs: v.optional(v.number()),
    })),
  },
  handler: async (ctx, { authSecret, items }) => {
    gateSecret(authSecret);
    const affected = new Set<string>();

    for (const it of items) {
      const usdc = Number.isFinite(it.usdc) ? Math.max(0, Math.round(it.usdc * 100) / 100) : 0;
      const mint = it.mintAddress;
      if (!mint) continue;
      const subKey = `creward:${it.contentRewardSubmissionId}`;
      const existing = await ctx.db
        .query("distributions")
        .withIndex("by_submission", (q) => q.eq("submissionId", subKey))
        .first();
      if (existing) {
        if (existing.totalPayoutUsdc !== usdc) {
          await ctx.db.patch(existing._id, {
            totalPayoutUsdc: usdc,
            builderUsdc: usdc,
            splits: existing.splits?.length
              ? existing.splits.map((s) => (s.role === "earned" ? { ...s, usdc } : s))
              : existing.splits,
          });
        }
      } else {
        const agent = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).first();
        await ctx.db.insert("distributions", {
          mintAddress: mint,
          submissionId: subKey,
          totalPayoutUsdc: usdc,
          investorUsdc: 0,
          builderUsdc: usdc,
          protocolUsdc: 0,
          splits: agent?.agentWallet ? [{ wallet: agent.agentWallet, role: "earned", usdc, status: "paid" }] : [],
          status: "paid",
          source: "content_reward",
          createdAt: it.postedAtMs ?? Date.now(),
        });
      }
      affected.add(mint);
    }

    // Recompute lifetime + monthly from the ledger for each affected agent.
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const mint of affected) {
      const agent = await ctx.db.query("influencers").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).first();
      if (!agent) continue;
      const ledger = await ctx.db.query("distributions").withIndex("by_mint", (q) => q.eq("mintAddress", mint)).collect();
      const lifetime = ledger.reduce((s, d) => s + d.totalPayoutUsdc, 0);
      const monthly = ledger.filter((d) => d.createdAt >= since).reduce((s, d) => s + d.totalPayoutUsdc, 0);
      await ctx.db.patch(agent._id, {
        lifetimeEarningsUsdc: Math.round(lifetime * 100) / 100,
        monthlyEarnings: Math.round(monthly * 100) / 100,
      });
    }
    return { ok: true, recorded: items.length, agents: affected.size };
  },
});

/** Lightweight admin check for the same-origin scrape-views route: verify the
 *  caller's Supabase token resolves to an active admin. The route (localhost or
 *  prod, same origin as the browser) calls this before scraping — so the sync no
 *  longer depends on NEXT_PUBLIC_APP_URL (which broke local: the cloud action
 *  POSTed to prod vello.gg and 404'd). */
export const checkAdminToken = action({
  args: { accessToken: v.string() },
  handler: async (ctx: ActionCtx, { accessToken }): Promise<{ admin: boolean }> => {
    try {
      await resolveAdmin(ctx, accessToken);
      return { admin: true };
    } catch {
      return { admin: false };
    }
  },
});

/** Admin "Sync <platform>": force-refresh views for every active submission on
 *  TikTok / Instagram / YouTube via the residential-proxy scraper service.
 *  Admin-gated (Supabase accessToken → resolveAdmin), then drives the
 *  internal-secret-gated `/api/oracle/scrape-views` worker. Returns its summary. */
export const syncPlatformViews = action({
  args: { accessToken: v.string(), platform: v.string() },
  handler: async (
    ctx: ActionCtx,
    { accessToken, platform },
  ): Promise<{ ok: boolean; error?: string; platform?: string; scanned?: number; measured?: number; updated?: number; skipped?: number; errors?: number; capped?: boolean }> => {
    await resolveAdmin(ctx, accessToken);
    if (!["tiktok", "instagram", "youtube"].includes(platform)) {
      return { ok: false, error: `unsupported platform: ${platform}` };
    }
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    const secret = process.env.INTERNAL_CRON_SECRET;
    if (!baseUrl) return { ok: false, error: "NEXT_PUBLIC_APP_URL not set in Convex env" };
    const res = await fetch(`${baseUrl}/api/oracle/scrape-views`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { "X-Internal-Secret": secret } : {}) },
      body: JSON.stringify({ platform }),
    }).catch(() => null);
    if (!res) return { ok: false, error: "scrape-views worker unreachable" };
    if (!res.ok) return { ok: false, error: `scrape-views worker returned ${res.status}` };
    const summary = (await res.json().catch(() => ({}))) as Record<string, number>;
    return { ok: true, platform, ...summary };
  },
});

/* ── Live view-sync progress (realtime progress bar) ─────────────────────────
 * The scrape worker upserts a row per platform as it runs; the admin page reads
 * `getSyncProgress` (a live Convex subscription) to render an "X/Y synced" bar. */

/** Worker write (secret-gated): upsert this platform's live sync progress. */
export const setSyncProgress = mutation({
  args: {
    authSecret: v.string(),
    platform: v.string(),
    total: v.number(),
    done: v.number(),
    updated: v.number(),
    running: v.boolean(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { authSecret, platform, ...fields }) => {
    gateSecret(authSecret);
    // A run that's STARTING (running:true) supersedes any prior finish — clear a stale
    // finishedAt so a row can never carry running:true AND a leftover finishedAt from a
    // previous run (that inconsistency is what made getSyncProgress report a dead scrape
    // as "still running" → a phantom "Syncing…" bar on the admin page).
    const write = fields.running ? { ...fields, finishedAt: undefined } : fields;
    const existing = await ctx.db
      .query("viewSyncProgress")
      .withIndex("by_platform", (q) => q.eq("platform", platform))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, write);
    } else {
      await ctx.db.insert("viewSyncProgress", { platform, ...write });
    }
    return { ok: true };
  },
});

/** On-chain USDC settled per ryze content-reward submission. The vello money-rail
 *  `submissions` row mirrors `paidUsdc` (actually disbursed by claim_payout) and
 *  links to its ryze display row via `contentRewardSubmissionId`. The admin page
 *  joins this (live) onto each content-reward submission for the "On-chain" column.
 *  Returns { [contentRewardSubmissionId]: { paid, owed, convexId } }. Bounded scan.
 *  `convexId` is the Convex submissions._id — used by the view-injector UI to
 *  resolve the Convex row for a Supabase content_rewards_submissions id. */
export const onchainByContentReward = query({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, { paid: number; owed: number; convexId: string }> = {};
    for (const s of await ctx.db.query("submissions").order("desc").take(8000)) {
      if (!s.contentRewardSubmissionId) continue;
      const prev = out[s.contentRewardSubmissionId];
      const paid = s.paidUsdc ?? 0;
      const owed = s.payoutAmountUsdc ?? 0;
      // If multiple money-rail rows ever point at one display row, keep the max paid.
      if (!prev || paid > prev.paid) out[s.contentRewardSubmissionId] = { paid, owed, convexId: s._id };
    }
    return out;
  },
});

/** Live progress for all platforms — powers the admin page's progress bar. */
// A scrape batch runs at most ~110s (the scrape-views route's DEADLINE_MS). If a row
// is STILL flagged `running` well past that, the serverless function was evicted
// before its final `running:false` write — a STALE row. We must NOT report it as
// running, or the admin page renders a phantom "Syncing views…" bar on every open
// (the bug the operator saw as "it auto-syncs when I open the page" — nothing was
// actually syncing; a dead scrape's progress row was stuck `running:true`).
const SYNC_STALE_MS = 3 * 60 * 1000;

export const getSyncProgress = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("viewSyncProgress").collect();
    const now = Date.now();
    return rows.map((r) => ({
      platform: r.platform,
      total: r.total,
      done: r.done,
      updated: r.updated,
      // A row counts as running only if it's flagged running, has NOT been marked
      // finished, and is fresh (< SYNC_STALE_MS). setSyncProgress now clears finishedAt
      // when a run starts, so `!finishedAt` reliably means "not yet done"; the staleness
      // bound catches a scrape that died before writing running:false at all.
      running: r.running && !r.finishedAt && now - r.startedAt < SYNC_STALE_MS,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt ?? null,
      note: r.note ?? null,
    }));
  },
});

/**
 * Secret-gated point-lookup: join a single money-rail submission with its
 * campaign (creatorWallet, onchainVersion) and influencer (agentWallet).
 * Used by the admin view-injector route to resolve all on-chain parameters
 * for a known Convex submission _id before calling recordPerformanceTx.
 * Reuses the same join pattern as dueForVerification (:402-420).
 * Gate: INTERNAL_CRON_SECRET.
 */
export const onchainJoinById = query({
  args: {
    authSecret: v.string(),
    submissionId: v.id("submissions"),
  },
  handler: async (ctx, { authSecret, submissionId }) => {
    if (!globalThis.process.env.INTERNAL_CRON_SECRET || authSecret !== globalThis.process.env.INTERNAL_CRON_SECRET) throw new Error("unauthorized");
    const s = await ctx.db.get(submissionId);
    if (!s) return null;
    const c = await ctx.db.get(s.campaignId);
    const agentWallet = await resolveAgentWallet(ctx.db, s.influencerMint);
    return {
      campaignId: s.campaignId as string,
      creatorWallet: c?.creatorWallet ?? null,
      agentWallet,
      onchainVersion: c?.onchainVersion ?? 0,
    };
  },
});
