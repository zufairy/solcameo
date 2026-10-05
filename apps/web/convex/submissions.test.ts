/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { RESTRICTED_CAMPAIGN_EMAIL } from "../lib/restrictedCampaigns";

const modules = import.meta.glob("./**/*.ts");

const MINT = "Mint1111111111111111111111111111111111111";
const WALLET = "Wallet11111111111111111111111111111111111";

// submitClipToCampaign is secret-gated (INTERNAL_CRON_SECRET): only the internal
// clipJobs posting action may submit clips on an agent's behalf. Set a known
// secret and pass it on every call.
const SECRET = "test-internal-cron-secret-submissions";
process.env.INTERNAL_CRON_SECRET = SECRET;

const baseCampaign = {
  creatorWallet: "Creator11111111111111111111111111111111111",
  brandName: "Acme",
  brandLogoUrl: "https://example.com/logo.svg",
  title: "Clip campaign",
  brief: "Clip the keynote",
  budget: 1000,
  ratePerThousandViews: 5,
  targetNiche: ["tech"],
  targetLanguage: ["en"],
  status: "open",
  submissionsCount: 0,
  deadline: "2026-12-31",
};

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const campaignId = await ctx.db.insert("campaigns", baseCampaign);
    const now = Date.now();
    const jobId = await ctx.db.insert("clipJobs", {
      mintAddress: MINT, sourceUrl: "https://x/v.mp4", sourceType: "campaign_asset",
      campaignId, status: "posting", createdAt: now, updatedAt: now,
    });
    const mkClip = (title: string, viralScore: number) =>
      ctx.db.insert("clips", {
        jobId, mintAddress: MINT, title, reason: "r", startSeconds: 0, endSeconds: 20,
        viralScore, captionText: "c", status: "posted", createdAt: now, updatedAt: now,
      });
    const clipA = await mkClip("Clip A", 90);
    const clipB = await mkClip("Clip B", 80);
    return { campaignId, clipA, clipB };
  });
}

describe("submitClipToCampaign", () => {
  it("creates a vello submission, links the clip, and bumps the campaign count", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);

    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok", authSecret: SECRET,
    });
    expect(res.ok).toBe(true);

    await t.run(async (ctx) => {
      const clip = await ctx.db.get(clipA);
      expect(clip?.submissionId).toBe(res.submissionId);
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("submitted");
      expect(sub?.postUrl).toBe("https://tiktok.com/@x/video/1");
      expect(sub?.platform).toBe("tiktok");
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(1);
    });
  });

  it("creates an independent submission for every posted clip", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA, clipB } = await seed(t);

    const r1 = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok", authSecret: SECRET,
    });
    const r2 = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipB, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/2", platform: "tiktok", authSecret: SECRET,
    });

    expect(r2.submissionId).not.toBe(r1.submissionId);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(2);
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(2);
      const clipBRow = await ctx.db.get(clipB);
      expect(clipBRow?.submissionId).toBe(r2.submissionId);
    });
  });

  it("returns {ok:false} for an invalid campaign id without creating a submission", async () => {
    const t = convexTest(schema, modules);
    const { clipA } = await seed(t);
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId: "not-a-real-id", influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok", authSecret: SECRET,
    });
    expect(res.ok).toBe(false);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(0);
    });
  });

  it("with NO postUrl and NO ids → records the join as 'pending' (CDN fallback is not a real post)", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("pending");
      expect(sub?.postUrl).toBeUndefined();
    });
  });

  it("with platformPostId (no postUrl) → 'submitted' and platformPostId persisted", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, platformPostId: "tt_video_777", platform: "tiktok", authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("submitted");
      expect(sub?.platformPostId).toBe("tt_video_777");
      expect(sub?.postUrl).toBeUndefined();
    });
  });

  it("with uploadPostRequestId (no postUrl) → 'submitted' and uploadPostRequestId persisted", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, uploadPostRequestId: "req_abc123", authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("submitted");
      expect(sub?.uploadPostRequestId).toBe("req_abc123");
      expect(sub?.postUrl).toBeUndefined();
    });
  });

  it("with postUrl → 'submitted' and postUrl persisted (existing behavior preserved)", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/9", authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("submitted");
      expect(sub?.postUrl).toBe("https://tiktok.com/@x/video/9");
    });
  });

  it("persists postedAt when passed", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);
    const when = 1_750_000_000_000;
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, platformPostId: "tt_video_888", postedAt: when, authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.postedAt).toBe(when);
    });
  });

  it("does NOT regress an already-settled (verified) submission", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);
    // Pre-create a settled submission for this campaign+mint.
    const submissionId = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot",
        submitterWallet: WALLET, status: "verified", postUrl: "https://tiktok.com/@x/orig",
      }),
    );
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/late", platform: "tiktok", authSecret: SECRET,
    });
    expect(res.submissionId).not.toBe(submissionId);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(submissionId)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("verified");
      expect(sub?.postUrl).toBe("https://tiktok.com/@x/orig");
    });
  });

  it("throws when the secret is wrong or missing", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);
    await expect(
      t.mutation(api.submissions.submitClipToCampaign, {
        clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
        submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/1", authSecret: "wrong",
      }),
    ).rejects.toThrow(/unauthorized/);
  });
});

describe("submitForCampaign", () => {
  it("with no post → records the join as 'pending'", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    const res = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET, authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("pending");
      expect(sub?.postUrl).toBeUndefined();
    });
  });

  it("with platformPostId only → 'submitted' and id persisted", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    const res = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      platformPostId: "tt_video_555", platform: "tiktok", authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("submitted");
      expect(sub?.platformPostId).toBe("tt_video_555");
    });
  });

  it("patches an existing pending join to 'submitted' when a platformPostId arrives", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    // First call: pending join, no post.
    const r1 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET, authSecret: SECRET,
    });
    // Second call: a real post id arrives.
    const r2 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      platformPostId: "tt_video_222", authSecret: SECRET,
    });
    expect(r2.submissionId).toBe(r1.submissionId);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(r1.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("submitted");
      expect(sub?.platformPostId).toBe("tt_video_222");
    });
  });

  it("throws when the secret is wrong or missing", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    await expect(
      t.mutation(api.submissions.submitForCampaign, {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        platformPostId: "tt_forged", authSecret: "wrong",
      }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("write-once postedAt: re-sending the SAME post does NOT reset the maturation clock", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    const T0 = 1_750_000_000_000;
    // First submit of this post stamps postedAt=T0.
    const r1 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      platformPostId: "tt_first", postUrl: "https://tiktok.com/@x/first", postedAt: T0, authSecret: SECRET,
    });
    // Re-send the SAME post 24h later (same platformPostId) with a later postedAt +
    // a resolved postUrl → dedupes to the same row (patch-duplicate); postedAt sticks.
    const r2 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      platformPostId: "tt_first", postUrl: "https://tiktok.com/@x/first-resolved", postedAt: T0 + 86_400_000, authSecret: SECRET,
    });
    expect(r2.submissionId).toBe(r1.submissionId);
    expect(r2.created).toBe(false);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(r1.submissionId!)) as Doc<"submissions"> | null;
      // postedAt is write-once: stays at T0.
      expect(sub?.postedAt).toBe(T0);
      // The resolved postUrl still updates on the same row.
      expect(sub?.postUrl).toBe("https://tiktok.com/@x/first-resolved");
      // Exactly one submission for this (campaign, agent) — no duplicate.
      const all = await ctx.db.query("submissions").collect();
      expect(all).toHaveLength(1);
    });
  });

  // ── PER-POST payable submissions (get paid on every clip, not just one) ──────
  it("two DIFFERENT posts → TWO submissions (distinct on-chain ClaimRecords), count 2", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    const p1 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      uploadPostRequestId: "req_1", platform: "tiktok", authSecret: SECRET,
    });
    const p2 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      uploadPostRequestId: "req_2", platform: "tiktok", authSecret: SECRET,
    });
    expect(p1.created).toBe(true);
    expect(p2.created).toBe(true);
    expect(p2.submissionId).not.toBe(p1.submissionId);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(2);
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(2);
    });
  });

  it("the SAME post submitted twice → ONE submission (dedupe, count stays 1)", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    const r1 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      uploadPostRequestId: "req_dup", platform: "tiktok", authSecret: SECRET,
    });
    const r2 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      uploadPostRequestId: "req_dup", platform: "tiktok", authSecret: SECRET,
    });
    expect(r2.submissionId).toBe(r1.submissionId);
    expect(r2.created).toBe(false);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(1);
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(1);
    });
  });

  it("a SETTLED post #1 does NOT block creating post #2's row", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    // Post #1, then settle it (verified) out-of-band.
    const p1 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      platformPostId: "tt_post1", platform: "tiktok", authSecret: SECRET,
    });
    await t.run((ctx) => ctx.db.patch(p1.submissionId!, { status: "verified", verificationDecision: "approved", payoutAmountUsdc: 10 }));
    // Post #2 (a different clip) must still create its own row.
    const p2 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      platformPostId: "tt_post2", platform: "tiktok", authSecret: SECRET,
    });
    expect(p2.created).toBe(true);
    expect(p2.submissionId).not.toBe(p1.submissionId);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(2);
      const settled = (await ctx.db.get(p1.submissionId!)) as Doc<"submissions"> | null;
      expect(settled?.status).toBe("verified"); // untouched
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(2);
    });
  });

  it("bare join → first post fills the pending row (count 1) → second post is a new row (count 2)", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    // Bare join (no post identity) → one pending row, counted.
    const join = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET, authSecret: SECRET,
    });
    // First real post attaches to the pending row (no extra count).
    const post1 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      platformPostId: "tt_a", platform: "tiktok", authSecret: SECRET,
    });
    expect(post1.submissionId).toBe(join.submissionId);
    expect(post1.created).toBe(false);
    // Second post → its own new row.
    const post2 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      platformPostId: "tt_b", platform: "tiktok", authSecret: SECRET,
    });
    expect(post2.created).toBe(true);
    expect(post2.submissionId).not.toBe(join.submissionId);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(2);
      // The pending join never spawned a second pending row.
      expect(subs.filter((s) => s.status === "pending")).toHaveLength(0);
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(2);
    });
  });

  it("a repeated bare join does NOT spam pending rows (count stays 1)", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    const j1 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET, authSecret: SECRET,
    });
    const j2 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET, authSecret: SECRET,
    });
    expect(j2.submissionId).toBe(j1.submissionId);
    expect(j2.created).toBe(false);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(1);
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(1);
    });
  });
});

describe("write-once postedAt on re-link", () => {
  it("submitClipToCampaign: retry preserves postedAt and enriches the same post", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA, clipB } = await seed(t);
    const T0 = 1_750_000_000_000;
    const r1 = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, platformPostId: "tt_first", postedAt: T0, authSecret: SECRET,
    });
    const r2 = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipB, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, platformPostId: "tt_first", postUrl: "https://tiktok.com/@x/video/2",
      postedAt: T0 + 86_400_000, authSecret: SECRET,
    });
    expect(r2.submissionId).toBe(r1.submissionId);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(r1.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.postedAt).toBe(T0);
      expect(sub?.platformPostId).toBe("tt_first");
      expect(sub?.postUrl).toBe("https://tiktok.com/@x/video/2");
    });
  });

  it("setPostLink: postedAt is write-once but postUrl/platformPostId update", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t);
    const T0 = 1_750_000_000_000;
    // Create a submission already stamped with postedAt=T0.
    const submissionId = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot",
        submitterWallet: WALLET, status: "submitted",
        postUrl: "https://tiktok.com/@x/orig", platformPostId: "tt_first", postedAt: T0,
      }),
    );
    await t.mutation(api.submissions.setPostLink, {
      submissionId, influencerMint: MINT, postUrl: "https://tiktok.com/@x/relinked",
      platformPostId: "tt_relinked", postedAt: T0 + 86_400_000, authSecret: SECRET,
    });
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(submissionId)) as Doc<"submissions"> | null;
      expect(sub?.postedAt).toBe(T0);
      expect(sub?.postUrl).toBe("https://tiktok.com/@x/relinked");
      expect(sub?.platformPostId).toBe("tt_relinked");
    });
  });
});

// ─── On-chain mirror: dueForClaim + dueForVerification extended projection ───

const CREATOR = "Creator11111111111111111111111111111111111";
const AGENT_WALLET = "AgentWallet1111111111111111111111111111111";

/** Insert an influencers row for MINT so the join can resolve agentWallet. */
async function seedInfluencer(t: ReturnType<typeof convexTest>, agentWallet?: string) {
  return await t.run((ctx) =>
    ctx.db.insert("influencers", {
      mintAddress: MINT,
      creatorWallet: CREATOR,
      name: "Vello Bot",
      handle: "@vello",
      avatarUrl: "https://example.com/a.png",
      niche: "tech",
      language: "en",
      archetype: "creator",
      description: "an agent",
      personality: { warmth: 50, humor: 50, authority: 50, boldness: 50 },
      ...(agentWallet ? { agentWallet } : {}),
      tvl: 0,
      monthlyEarnings: 0,
      sharePrice: 1,
      totalShares: 0,
      availableShares: 0,
    }),
  );
}

/** Insert a campaign with overridable fields (onchainVersion, creatorWallet). */
async function seedCampaignV(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("campaigns", { ...baseCampaign, creatorWallet: CREATOR, ...overrides }),
  );
}

describe("submissions.dueForClaim", () => {
  it("throws unauthorized when the secret is wrong", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.submissions.dueForClaim, { authSecret: "nope" }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("returns a v2 approved+attested+underpaid row, with creatorWallet + agentWallet joined", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const sid = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "verified",
        verificationDecision: "approved",
        payoutAmountUsdc: 200,
        attestationTx: "OnChainSig",
        // paidUsdc absent → 0 < 200 → due
      }),
    );

    const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      _id: sid,
      campaignId,
      influencerMint: MINT,
      payoutAmountUsdc: 200,
      attestationTx: "OnChainSig",
      creatorWallet: CREATOR,
      agentWallet: AGENT_WALLET,
    });
    expect(due[0].paidUsdc ?? 0).toBe(0);
    expect(due[0].navCreditedUsdc).toBe(0); // absent → projected as 0
  });

  it("EXCLUDES a v1 (legacy / onchainVersion undefined) campaign's row", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, {}); // no onchainVersion → v1
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "verified",
        verificationDecision: "approved",
        payoutAmountUsdc: 200,
        attestationTx: "OnChainSig",
      }),
    );
    const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });

  it("EXCLUDES rows with no attestationTx (oracle hasn't recorded on-chain yet)", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "verified",
        verificationDecision: "approved",
        payoutAmountUsdc: 200,
        // no attestationTx
      }),
    );
    const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });

  it("INCLUDES a fully-paid row whose NAV credit lagged (claimDone not set) so the keeper back-fills the credit", async () => {
    // Strand-heal: on the payment-completing tick the on-chain USDC moved (paidUsdc
    // reached the full payout) but the NAV credit was deferred (transient
    // distribute-earnings / fee-read failure), so claimDone was NOT set. The row
    // MUST stay due so a later tick re-credits the lagging NAV (the route skips the
    // crank for an already-paid row and just back-fills). Gating on `paid < payout`
    // would evict it here and strand the credit forever.
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const sid = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "verified",
        verificationDecision: "approved",
        payoutAmountUsdc: 200,
        attestationTx: "OnChainSig",
        paidUsdc: 200, // fully paid on-chain
        // claimDone NOT set → NAV credit hasn't completed → stay due
      }),
    );
    const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
    expect(due.map((d) => d._id)).toEqual([sid]);
  });

  it("EXCLUDES a fully-paid + fully-credited row (claimDone === true)", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "verified",
        verificationDecision: "approved",
        payoutAmountUsdc: 200,
        attestationTx: "OnChainSig",
        paidUsdc: 200,
        claimDone: true, // fully settled → leaves the claim set
      }),
    );
    const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });

  it("INCLUDES partially-paid rows (0 < paidUsdc < payoutAmountUsdc)", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const sid = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "verified",
        verificationDecision: "approved",
        payoutAmountUsdc: 200,
        attestationTx: "OnChainSig",
        paidUsdc: 50, // partially paid → still owed 150
      }),
    );
    const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
    expect(due.map((d) => d._id)).toEqual([sid]);
  });

  it("EXCLUDES a terminal row (claimDone === true) even when paidUsdc < payoutAmountUsdc", async () => {
    // The budget-clamped/terminal guard: a 0-progress crank set claimDone=true,
    // so the row must leave the claim set (stops the forever-cranking gas leak)
    // even though the off-chain estimate (200) still exceeds paid (80).
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "verified",
        verificationDecision: "approved",
        payoutAmountUsdc: 200,
        attestationTx: "OnChainSig",
        paidUsdc: 80,
        claimDone: true, // budget exhausted on-chain → terminal
      }),
    );
    const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });

  it("projects navCreditedUsdc onto the due row (defaults 0 when absent)", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const withCredit = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "verified",
        verificationDecision: "approved",
        payoutAmountUsdc: 200,
        attestationTx: "OnChainSig",
        paidUsdc: 50,
        navCreditedUsdc: 48, // partial tranche already credited
      }),
    );
    const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
    const row = due.find((d) => d._id === withCredit);
    expect(row?.navCreditedUsdc).toBe(48);
    // A row with no navCreditedUsdc set still surfaces as 0 (verified above by the
    // first dueForClaim test, where paidUsdc/navCreditedUsdc are both absent).
  });

  it("EXCLUDES rejected / zero-payout rows", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    // rejected
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "rejected", verificationDecision: "rejected", attestationTx: "Sig",
      }),
    );
    // approved but zero payout
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "verified", verificationDecision: "approved", payoutAmountUsdc: 0, attestationTx: "Sig2",
      }),
    );
    const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });
});

describe("submissions.dueForReattest", () => {
  it("throws unauthorized when the secret is wrong", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.submissions.dueForReattest, { authSecret: "nope" }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("returns a v2 approved + attested + unpaid + non-terminal row with viewCount + wallets joined", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const sid = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "verified",
        verificationDecision: "approved",
        viewCount: 40_000,
        payoutAmountUsdc: 200,
        attestationTx: "OnChainSig",
        lastReattestAt: 1, // old basis → past the reattest throttle
        // paidUsdc absent → 0 < 200 → still owed → needs slot refresh
      }),
    );

    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      _id: sid,
      campaignId,
      influencerMint: MINT,
      viewCount: 40_000,
      payoutAmountUsdc: 200,
      creatorWallet: CREATOR,
      agentWallet: AGENT_WALLET,
    });
  });

  it("INCLUDES partially-paid rows (0 < paidUsdc < payoutAmountUsdc)", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const sid = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "verified", verificationDecision: "approved", viewCount: 40_000,
        payoutAmountUsdc: 200, attestationTx: "OnChainSig", paidUsdc: 50, lastReattestAt: 1,
      }),
    );
    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET });
    expect(due.map((d) => d._id)).toEqual([sid]);
  });

  it("EXCLUDES a v1 (onchainVersion undefined) campaign's row", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, {}); // v1
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "verified", verificationDecision: "approved", viewCount: 40_000,
        payoutAmountUsdc: 200, attestationTx: "OnChainSig",
      }),
    );
    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });

  it("EXCLUDES rows with no attestationTx (never recorded on-chain — nothing to refresh)", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "verified", verificationDecision: "approved", viewCount: 40_000,
        payoutAmountUsdc: 200, // no attestationTx
      }),
    );
    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });

  it("EXCLUDES fully-paid rows (paidUsdc >= payoutAmountUsdc)", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "verified", verificationDecision: "approved", viewCount: 40_000,
        payoutAmountUsdc: 200, attestationTx: "OnChainSig", paidUsdc: 200,
      }),
    );
    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });

  it("EXCLUDES terminal rows (claimDone === true)", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "verified", verificationDecision: "approved", viewCount: 40_000,
        payoutAmountUsdc: 200, attestationTx: "OnChainSig", paidUsdc: 80, claimDone: true,
      }),
    );
    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });

  it("EXCLUDES rejected rows and a manual_review (needs_review) row", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    // rejected
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "rejected", verificationDecision: "rejected", attestationTx: "Sig",
      }),
    );
    // needs_review (manual_review terminal): not "verified"/not approved → excluded
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "needs_review", reviewReason: "facebook reach", payoutAmountUsdc: 200,
      }),
    );
    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET });
    expect(due).toHaveLength(0);
  });

  // THROTTLE (mainnet strand fix): re-recording every oracle tick re-arms the
  // on-chain dispute window faster than it elapses → claim_payout reverts forever.
  // A row is due ONLY when its last on-chain record is older than the interval.
  it("THROTTLES a freshly-recorded row (recorded on-chain just now — not near staleness)", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const now = 10_000_000_000;
    await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "verified", verificationDecision: "approved", viewCount: 40_000,
        payoutAmountUsdc: 200, attestationTx: "OnChainSig",
        lastReattestAt: now - 60_000, // recorded 1 min ago → well inside the interval
      }),
    );
    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET, nowMs: now });
    expect(due).toHaveLength(0);
  });

  it("RE-RECORDS a row whose last on-chain record is older than the interval", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const now = 10_000_000_000;
    const sid = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "verified", verificationDecision: "approved", viewCount: 40_000,
        payoutAmountUsdc: 200, attestationTx: "OnChainSig",
        lastReattestAt: now - 13 * 60 * 60 * 1000, // 13h ago → past the 12h interval
      }),
    );
    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET, nowMs: now });
    expect(due.map((d) => d._id)).toEqual([sid]);
  });

  it("falls back to verifiedAt then row age when lastReattestAt is unset", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const now = 10_000_000_000;
    // verifiedAt (first attestation) 13h ago, never reattested → basis = verifiedAt → due
    const sid = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
        status: "verified", verificationDecision: "approved", viewCount: 40_000,
        payoutAmountUsdc: 200, attestationTx: "OnChainSig",
        verifiedAt: now - 13 * 60 * 60 * 1000,
      }),
    );
    const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET, nowMs: now });
    expect(due.map((d) => d._id)).toEqual([sid]);
  });
});

describe("submissions.dueForVerification — extended projection (agentWallet + creatorWallet + onchainVersion)", () => {
  it("returns matured rows joined with agentWallet, creatorWallet, onchainVersion", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t, AGENT_WALLET);
    const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
    const now = 10_000_000_000;
    const hour = 3_600_000;

    const sid = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "submitted",
        platform: "tiktok",
        platformPostId: "tt_777",
        postedAt: now - 2 * hour,
      }),
    );

    const due = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: hour,
      nowMs: now,
    });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      _id: sid,
      campaignId,
      influencerMint: MINT,
      agentWallet: AGENT_WALLET,
      creatorWallet: CREATOR,
      onchainVersion: 2,
    });
  });

  it("returns null agentWallet when the influencer has no wallet, and v1 onchainVersion is null/absent", async () => {
    const t = convexTest(schema, modules);
    await seedInfluencer(t); // no agentWallet
    const campaignId = await seedCampaignV(t, {}); // no onchainVersion
    const now = 10_000_000_000;
    const hour = 3_600_000;

    const sid = await t.run((ctx) =>
      ctx.db.insert("submissions", {
        campaignId,
        influencerMint: MINT,
        influencerName: "Vello Bot",
        submitterWallet: WALLET,
        status: "submitted",
        platformPostId: "tt_888",
        postedAt: now - 2 * hour,
      }),
    );

    const [row] = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: hour,
      nowMs: now,
    });
    expect(row._id).toBe(sid);
    expect(row.agentWallet).toBeNull();
    expect(row.creatorWallet).toBe(CREATOR);
    expect(row.onchainVersion).toBeNull();
  });
});

describe("getFundedByContentRewardId (USDC funded-treasury gate)", () => {
  const CR_ID = "ryze-content-reward-uuid-1";
  const insertCampaign = (t: ReturnType<typeof convexTest>, extra: Record<string, unknown>) =>
    t.run((ctx) => ctx.db.insert("campaigns", { ...baseCampaign, contentRewardId: CR_ID, ...extra }));

  it("returns the campaign ONLY when funded v2 (pdaAddress + onchainVersion>=2)", async () => {
    const t = convexTest(schema, modules);
    const id = await insertCampaign(t, { pdaAddress: "Pda1111", onchainVersion: 2 });
    const res = await t.query(internal.campaigns.getFundedByContentRewardId, { contentRewardId: CR_ID });
    expect(res?._id).toBe(id);
    expect(res?.onchainVersion).toBe(2);
  });

  it("returns null for a v1 link (no onchainVersion) — never credits unbacked NAV", async () => {
    const t = convexTest(schema, modules);
    await insertCampaign(t, { pdaAddress: "Pda1111" }); // funded vault but legacy v1
    expect(await t.query(internal.campaigns.getFundedByContentRewardId, { contentRewardId: CR_ID })).toBeNull();
  });

  it("returns null for a v2 link with no funded vault (no pdaAddress)", async () => {
    const t = convexTest(schema, modules);
    await insertCampaign(t, { onchainVersion: 2 }); // v2 but unfunded → cannot pay USDC
    expect(await t.query(internal.campaigns.getFundedByContentRewardId, { contentRewardId: CR_ID })).toBeNull();
  });

  it("returns null when no campaign is linked to that content_reward", async () => {
    const t = convexTest(schema, modules);
    await insertCampaign(t, { pdaAddress: "Pda1111", onchainVersion: 2 });
    expect(await t.query(internal.campaigns.getFundedByContentRewardId, { contentRewardId: "different-uuid" })).toBeNull();
  });

  it("returns null for an empty content_reward id", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(internal.campaigns.getFundedByContentRewardId, { contentRewardId: "" })).toBeNull();
  });
});

describe("submitClipToCampaign — content_reward display-mirror link", () => {
  it("persists contentRewardSubmissionId on the convex submission", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok",
      contentRewardSubmissionId: "ryze-sub-1", authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.contentRewardSubmissionId).toBe("ryze-sub-1");
    });
  });

  it("write-once: a later submit does NOT overwrite the linked ryze id", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA, clipB } = await seed(t);
    await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok",
      contentRewardSubmissionId: "ryze-sub-1", authSecret: SECRET,
    });
    const r2 = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipB, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok",
      contentRewardSubmissionId: "ryze-sub-2", authSecret: SECRET,
    });
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(r2.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.contentRewardSubmissionId).toBe("ryze-sub-1"); // unchanged
    });
  });
});

describe("getFundedByContentRewardId — funded match wins over a shared-id stray", () => {
  it("returns the FUNDED v2 even when an unfunded/v1 campaign shares the same content_reward id", async () => {
    const t = convexTest(schema, modules);
    const CR = "ryze-shared-id";
    // v1 (unfunded) inserted FIRST so it would win a naive .first() tiebreak.
    await t.run((ctx) => ctx.db.insert("campaigns", { ...baseCampaign, contentRewardId: CR })); // v1
    const v2 = await t.run((ctx) => ctx.db.insert("campaigns", { ...baseCampaign, contentRewardId: CR, pdaAddress: "Pda2", onchainVersion: 2 }));
    const res = await t.query(internal.campaigns.getFundedByContentRewardId, { contentRewardId: CR });
    expect(res?._id).toBe(v2); // the scan finds the funded vault, not the stray v1
  });
});

describe("approveSubmission / rejectSubmission — v2 USDC rows are oracle-owned (anti-strand)", () => {
  const seedV2 = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", { ...baseCampaign, onchainVersion: 2, pdaAddress: "Pda1", contentRewardId: "cr-x" });
      const submissionId = await ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET, status: "submitted",
      });
      return { campaignId, submissionId };
    });

  it("approveSubmission REFUSES a v2 submission even with the real creatorWallet (no manual hijack of USDC rows)", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seedV2(t);
    await expect(
      t.mutation(api.submissions.approveSubmission, { submissionId, payoutTxSignature: "sig", callerWallet: baseCampaign.creatorWallet, authSecret: SECRET }),
    ).rejects.toThrow(/oracle/);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(submissionId)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("submitted"); // unchanged → still measurable by the oracle
    });
  });

  it("rejectSubmission REFUSES a v2 submission (a forged callerWallet can't strand the agent's USDC)", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seedV2(t);
    await expect(
      t.mutation(api.submissions.rejectSubmission, { submissionId, callerWallet: baseCampaign.creatorWallet, authSecret: SECRET }),
    ).rejects.toThrow(/oracle/);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(submissionId)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("submitted");
    });
  });

  it("approveSubmission STILL works for a v1 campaign (legacy brand flow preserved)", async () => {
    const t = convexTest(schema, modules);
    const submissionId = await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", { ...baseCampaign }); // v1 (no onchainVersion)
      return ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET, status: "submitted",
      });
    });
    await t.mutation(api.submissions.approveSubmission, { submissionId, payoutTxSignature: "sig", callerWallet: baseCampaign.creatorWallet, authSecret: SECRET });
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(submissionId)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("approved");
    });
  });

  it("approveSubmission / rejectSubmission REJECT a wrong internal secret (browser cannot forge a status flip)", async () => {
    const t = convexTest(schema, modules);
    const submissionId = await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", { ...baseCampaign }); // v1
      return ctx.db.insert("submissions", {
        campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET, status: "submitted",
      });
    });
    await expect(
      t.mutation(api.submissions.approveSubmission, { submissionId, payoutTxSignature: "sig", callerWallet: baseCampaign.creatorWallet, authSecret: "wrong" }),
    ).rejects.toThrow(/unauthorized/);
    await expect(
      t.mutation(api.submissions.rejectSubmission, { submissionId, callerWallet: baseCampaign.creatorWallet, authSecret: "wrong" }),
    ).rejects.toThrow(/unauthorized/);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(submissionId)) as Doc<"submissions"> | null;
      expect(sub?.status).toBe("submitted"); // unchanged — the forged calls were rejected
    });
  });
});

// ─── Task 3.1: beneficiary resolver → vault PDA when vault is enabled ────────
//
// When agentAccount.vaultEnabled === true and vaultAddress is set, all three
// projectors (dueForVerification, dueForClaim, dueForReattest) and the admin
// onchainJoinById join must return the vault PDA as agentWallet so on-chain
// rewards land in the compute vault. When the vault is absent or disabled, the
// custodial influencers.agentWallet is returned unchanged.
//
// CORRECTNESS NOTE: claim.beneficiary locks at the FIRST record_performance
// call. This resolution is in effect before any new submission's first
// attestation; pre-existing attested submissions keep their custodial
// beneficiary (unaffected by this change).

const VAULT_ADDR = "VaultPDA11111111111111111111111111111111111";
const CUSTODIAL = "Custodial1111111111111111111111111111111111";

/** Insert an agentAccount row for MINT; vault fields are optional. */
async function seedAgentAccount(
  t: ReturnType<typeof convexTest>,
  opts: { vaultEnabled?: boolean; vaultAddress?: string } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("agentAccount", {
      mintAddress: MINT,
      sharesOutstanding: 0,
      escrowUsdc: 0,
      liquidUsdc: 0,
      unsettledTabUsdc: 0,
      status: "active" as const,
      seedSharePrice: 1,
      plannedSupply: 1000,
      updatedAt: Date.now(),
      ...opts,
    }),
  );
}

describe("Task 3.1 — beneficiary resolver: vault PDA vs custodial agentWallet", () => {
  // ── dueForVerification ──────────────────────────────────────────────────────
  describe("dueForVerification", () => {
    it("returns vault PDA as agentWallet when vaultEnabled:true and vaultAddress is set", async () => {
      const t = convexTest(schema, modules);
      await seedInfluencer(t, CUSTODIAL);
      await seedAgentAccount(t, { vaultEnabled: true, vaultAddress: VAULT_ADDR });
      const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
      const now = 10_000_000_000;
      const hour = 3_600_000;

      const sid = await t.run((ctx) =>
        ctx.db.insert("submissions", {
          campaignId,
          influencerMint: MINT,
          influencerName: "Vello Bot",
          submitterWallet: WALLET,
          status: "submitted",
          platform: "tiktok",
          platformPostId: "tt_vault_test",
          postedAt: now - 2 * hour,
        }),
      );

      const due = await t.query(api.submissions.dueForVerification, {
        authSecret: SECRET,
        windowMs: hour,
        nowMs: now,
      });
      expect(due).toHaveLength(1);
      expect(due[0]._id).toBe(sid);
      // Vault PDA must replace the custodial wallet as the beneficiary.
      expect(due[0].agentWallet).toBe(VAULT_ADDR);
    });

    it("returns custodial agentWallet when agent has no agentAccount (vault not set up)", async () => {
      const t = convexTest(schema, modules);
      await seedInfluencer(t, CUSTODIAL);
      // No agentAccount row → resolveAgentWallet falls back to influencers.agentWallet.
      const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
      const now = 10_000_000_000;
      const hour = 3_600_000;

      await t.run((ctx) =>
        ctx.db.insert("submissions", {
          campaignId,
          influencerMint: MINT,
          influencerName: "Vello Bot",
          submitterWallet: WALLET,
          status: "submitted",
          platformPostId: "tt_custodial_test",
          postedAt: now - 2 * hour,
        }),
      );

      const due = await t.query(api.submissions.dueForVerification, {
        authSecret: SECRET,
        windowMs: hour,
        nowMs: now,
      });
      expect(due).toHaveLength(1);
      expect(due[0].agentWallet).toBe(CUSTODIAL);
    });

    it("returns custodial agentWallet when agentAccount exists but vaultEnabled is false", async () => {
      const t = convexTest(schema, modules);
      await seedInfluencer(t, CUSTODIAL);
      // Vault address present but NOT enabled → still custodial.
      await seedAgentAccount(t, { vaultEnabled: false, vaultAddress: VAULT_ADDR });
      const campaignId = await seedCampaignV(t, { onchainVersion: 2 });
      const now = 10_000_000_000;
      const hour = 3_600_000;

      await t.run((ctx) =>
        ctx.db.insert("submissions", {
          campaignId,
          influencerMint: MINT,
          influencerName: "Vello Bot",
          submitterWallet: WALLET,
          status: "submitted",
          platformPostId: "tt_disabled_vault",
          postedAt: now - 2 * hour,
        }),
      );

      const due = await t.query(api.submissions.dueForVerification, {
        authSecret: SECRET,
        windowMs: hour,
        nowMs: now,
      });
      expect(due).toHaveLength(1);
      expect(due[0].agentWallet).toBe(CUSTODIAL);
    });
  });

  // ── dueForClaim ─────────────────────────────────────────────────────────────
  describe("dueForClaim", () => {
    it("returns vault PDA as agentWallet when vault is enabled", async () => {
      const t = convexTest(schema, modules);
      await seedInfluencer(t, CUSTODIAL);
      await seedAgentAccount(t, { vaultEnabled: true, vaultAddress: VAULT_ADDR });
      const campaignId = await seedCampaignV(t, { onchainVersion: 2 });

      const sid = await t.run((ctx) =>
        ctx.db.insert("submissions", {
          campaignId,
          influencerMint: MINT,
          influencerName: "Vello Bot",
          submitterWallet: WALLET,
          status: "verified",
          verificationDecision: "approved",
          payoutAmountUsdc: 100,
          attestationTx: "SomeSig",
        }),
      );

      const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
      expect(due).toHaveLength(1);
      expect(due[0]._id).toBe(sid);
      expect(due[0].agentWallet).toBe(VAULT_ADDR);
    });

    it("returns custodial agentWallet when vault is not enabled", async () => {
      const t = convexTest(schema, modules);
      await seedInfluencer(t, CUSTODIAL);
      // No agentAccount → custodial fallback.
      const campaignId = await seedCampaignV(t, { onchainVersion: 2 });

      await t.run((ctx) =>
        ctx.db.insert("submissions", {
          campaignId,
          influencerMint: MINT,
          influencerName: "Vello Bot",
          submitterWallet: WALLET,
          status: "verified",
          verificationDecision: "approved",
          payoutAmountUsdc: 100,
          attestationTx: "SomeSig",
        }),
      );

      const due = await t.query(api.submissions.dueForClaim, { authSecret: SECRET });
      expect(due).toHaveLength(1);
      expect(due[0].agentWallet).toBe(CUSTODIAL);
    });
  });

  // ── dueForReattest ──────────────────────────────────────────────────────────
  describe("dueForReattest", () => {
    it("returns vault PDA as agentWallet when vault is enabled", async () => {
      const t = convexTest(schema, modules);
      await seedInfluencer(t, CUSTODIAL);
      await seedAgentAccount(t, { vaultEnabled: true, vaultAddress: VAULT_ADDR });
      const campaignId = await seedCampaignV(t, { onchainVersion: 2 });

      const sid = await t.run((ctx) =>
        ctx.db.insert("submissions", {
          campaignId,
          influencerMint: MINT,
          influencerName: "Vello Bot",
          submitterWallet: WALLET,
          status: "verified",
          verificationDecision: "approved",
          viewCount: 50_000,
          payoutAmountUsdc: 250,
          attestationTx: "ReatestSig",
          lastReattestAt: 1,
          // paidUsdc absent → 0 < 250 → unpaid → needs slot refresh
        }),
      );

      const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET });
      expect(due).toHaveLength(1);
      expect(due[0]._id).toBe(sid);
      expect(due[0].agentWallet).toBe(VAULT_ADDR);
    });

    it("returns custodial agentWallet when vault is not enabled", async () => {
      const t = convexTest(schema, modules);
      await seedInfluencer(t, CUSTODIAL);
      const campaignId = await seedCampaignV(t, { onchainVersion: 2 });

      await t.run((ctx) =>
        ctx.db.insert("submissions", {
          campaignId,
          influencerMint: MINT,
          influencerName: "Vello Bot",
          submitterWallet: WALLET,
          status: "verified",
          verificationDecision: "approved",
          viewCount: 50_000,
          payoutAmountUsdc: 250,
          attestationTx: "ReatestSig",
          lastReattestAt: 1,
        }),
      );

      const due = await t.query(api.submissions.dueForReattest, { authSecret: SECRET });
      expect(due).toHaveLength(1);
      expect(due[0].agentWallet).toBe(CUSTODIAL);
    });
  });
});

// ─── Campaign-submission bridge for AI-agent-posted clips (drip + manual) ─────
//
// Closes the gap where a campaign clip posted via the drip cron (scheduled from
// the Posting tab, which drops row.campaignId) or the manual "Post now" path was
// posted but never submitted. The server recovers the campaign/content-reward
// from the CLIP'S JOB (markClipPostedByUrl provenance) so a client dropping
// campaignId can't break the payout — mirrors the inline autoPost path.

/** Seed a posted clip whose job carries a content_reward id (for the USDC bridge). */
async function seedContentRewardClip(t: ReturnType<typeof convexTest>, contentRewardId: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("clipJobs", {
      mintAddress: MINT, sourceUrl: "https://x/v.mp4", sourceType: "url",
      contentRewardId, status: "posting", createdAt: now, updatedAt: now,
    });
    const clipId = await ctx.db.insert("clips", {
      jobId, mintAddress: MINT, title: "Clip", reason: "r", startSeconds: 0, endSeconds: 20,
      viralScore: 90, captionText: "c", status: "posted", createdAt: now, updatedAt: now,
    });
    return { clipId };
  });
}

describe("bridgeContentRewardToCampaign — USDC rail shared by the drip + manual post paths", () => {
  const CR = "ryze-cr-bridge-1";

  it("submits to the FUNDED v2 vault linked to the content_reward, links the clip, bumps the count", async () => {
    const t = convexTest(schema, modules);
    const { clipId } = await seedContentRewardClip(t, CR);
    const campaignId = await t.run((ctx) =>
      ctx.db.insert("campaigns", { ...baseCampaign, contentRewardId: CR, pdaAddress: "PdaFunded1", onchainVersion: 2 }),
    );
    const res = await t.mutation(api.submissions.bridgeContentRewardToCampaign, {
      clipId, contentRewardId: CR, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok",
      postedAt: 123, authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(1);
      expect(subs[0].campaignId).toBe(campaignId);
      expect(subs[0].influencerMint).toBe(MINT);
      expect(subs[0].submitterWallet).toBe(WALLET);
      expect(subs[0].status).toBe("submitted");
      const clip = await ctx.db.get(clipId);
      expect(clip?.submissionId).toBe(subs[0]._id);
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(1);
    });
  });

  it("SKIPS (no submission) when only a v1/unfunded campaign links the content_reward — never credits unbacked NAV", async () => {
    const t = convexTest(schema, modules);
    const { clipId } = await seedContentRewardClip(t, CR);
    await t.run((ctx) => ctx.db.insert("campaigns", { ...baseCampaign, contentRewardId: CR, pdaAddress: "PdaX" })); // v1 (no onchainVersion)
    const res = await t.mutation(api.submissions.bridgeContentRewardToCampaign, {
      clipId, contentRewardId: CR, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok", authSecret: SECRET,
    });
    expect(res.ok).toBe(false);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(0);
    });
  });

  it("SKIPS a v2 link with no funded vault (no pdaAddress)", async () => {
    const t = convexTest(schema, modules);
    const { clipId } = await seedContentRewardClip(t, CR);
    await t.run((ctx) => ctx.db.insert("campaigns", { ...baseCampaign, contentRewardId: CR, onchainVersion: 2 })); // v2 but unfunded
    const res = await t.mutation(api.submissions.bridgeContentRewardToCampaign, {
      clipId, contentRewardId: CR, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, platformPostId: "tt_1", authSecret: SECRET,
    });
    expect(res.ok).toBe(false);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("submissions").collect()).toHaveLength(0);
    });
  });

  it("returns {ok:false} for an empty contentRewardId (no submission)", async () => {
    const t = convexTest(schema, modules);
    const { clipId } = await seedContentRewardClip(t, CR);
    const res = await t.mutation(api.submissions.bridgeContentRewardToCampaign, {
      clipId, contentRewardId: "", influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, authSecret: SECRET,
    });
    expect(res.ok).toBe(false);
  });

  it("throws when the secret is wrong (the funded-vault gate never leaks to an unauthed caller)", async () => {
    const t = convexTest(schema, modules);
    const { clipId } = await seedContentRewardClip(t, CR);
    await t.run((ctx) =>
      ctx.db.insert("campaigns", { ...baseCampaign, contentRewardId: CR, pdaAddress: "PdaFunded1", onchainVersion: 2 }),
    );
    await expect(
      t.mutation(api.submissions.bridgeContentRewardToCampaign, {
        clipId, contentRewardId: CR, influencerMint: MINT, influencerName: "Vello Bot",
        submitterWallet: WALLET, authSecret: "wrong",
      }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("idempotent: bridging the same content_reward twice yields ONE submission (count stays 1)", async () => {
    const t = convexTest(schema, modules);
    const { clipId } = await seedContentRewardClip(t, CR);
    const campaignId = await t.run((ctx) =>
      ctx.db.insert("campaigns", { ...baseCampaign, contentRewardId: CR, pdaAddress: "PdaFunded2", onchainVersion: 2 }),
    );
    const base = { clipId, contentRewardId: CR, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET, authSecret: SECRET };
    await t.mutation(api.submissions.bridgeContentRewardToCampaign, { ...base, platformPostId: "tt_1" });
    await t.mutation(api.submissions.bridgeContentRewardToCampaign, { ...base, platformPostId: "tt_1" });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("submissions").collect()).toHaveLength(1);
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(1);
    });
  });
});

// The payout gate the drip + manual "Post now" callers MUST feed: a bridged
// submission only becomes measurable (→ attested on-chain → USDC-claimed) when it
// carries a DURABLE post id. A postUrl-only row is "submitted" yet NEVER "due" —
// the exact stranding that leaves an auto-posted content_reward clip unpaid. This
// locks the contract the caller fix depends on.
describe("dueForVerification: a bridged content_reward submission is measurable ONLY with a durable post id", () => {
  const CR = "ryze-cr-due-1";
  const hour = 3_600_000;
  const now = 10_000_000_000;

  async function bridgeMatured(t: ReturnType<typeof convexTest>, extra: Record<string, unknown>) {
    const { clipId } = await seedContentRewardClip(t, CR);
    await seedInfluencer(t, AGENT_WALLET); // so dueForVerification's agentWallet join resolves
    await t.run((ctx) =>
      ctx.db.insert("campaigns", { ...baseCampaign, contentRewardId: CR, pdaAddress: "PdaDue1", onchainVersion: 2 }),
    );
    return t.mutation(api.submissions.bridgeContentRewardToCampaign, {
      clipId, contentRewardId: CR, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: WALLET, postedAt: now - 2 * hour, authSecret: SECRET, ...extra,
    });
  }

  it("WITH uploadPostRequestId → returned by dueForVerification (payable)", async () => {
    const t = convexTest(schema, modules);
    const res = await bridgeMatured(t, { uploadPostRequestId: "req_1" });
    expect(res.ok).toBe(true);
    const due = await t.query(api.submissions.dueForVerification, { authSecret: SECRET, windowMs: hour, nowMs: now });
    expect(due).toHaveLength(1);
    expect(due[0].uploadPostRequestId).toBe("req_1");
  });

  it("WITH platformPostId → returned by dueForVerification (payable)", async () => {
    const t = convexTest(schema, modules);
    const res = await bridgeMatured(t, { platformPostId: "tt_1" });
    expect(res.ok).toBe(true);
    const due = await t.query(api.submissions.dueForVerification, { authSecret: SECRET, windowMs: hour, nowMs: now });
    expect(due).toHaveLength(1);
    expect(due[0].platformPostId).toBe("tt_1");
  });

  it("postUrl-ONLY (the dropped-id bug) → 'submitted' but NEVER due → never attested, never paid", async () => {
    const t = convexTest(schema, modules);
    const res = await bridgeMatured(t, { postUrl: "https://tiktok.com/@x/video/1" });
    expect(res.ok).toBe(true);
    // The row exists and is "submitted" (a postUrl makes it a real post)…
    await t.run(async (ctx) => {
      const [s] = await ctx.db.query("submissions").collect();
      expect(s.status).toBe("submitted");
    });
    // …but WITHOUT a durable id it is never measured → the agent is stranded.
    const due = await t.query(api.submissions.dueForVerification, { authSecret: SECRET, windowMs: hour, nowMs: now });
    expect(due).toHaveLength(0);
  });
});

describe("submitClipToCampaign — an agent joining ANOTHER user's campaign submits under its OWN identity", () => {
  it("lands the submission under the passed campaignId with the agent's mint + owner wallet (not the campaign creator)", async () => {
    const t = convexTest(schema, modules);
    const otherCreator = "OtherCreator111111111111111111111111111111";
    const AGENT_OWNER = "AgentOwner11111111111111111111111111111111";
    const { campaignId, clipA } = await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", { ...baseCampaign, creatorWallet: otherCreator });
      const now = Date.now();
      const jobId = await ctx.db.insert("clipJobs", {
        mintAddress: MINT, sourceUrl: "https://x/v.mp4", sourceType: "campaign_asset",
        campaignId, status: "posting", createdAt: now, updatedAt: now,
      });
      const clipA = await ctx.db.insert("clips", {
        jobId, mintAddress: MINT, title: "Clip A", reason: "r", startSeconds: 0, endSeconds: 20,
        viralScore: 90, captionText: "c", status: "posted", createdAt: now, updatedAt: now,
      });
      return { campaignId, clipA };
    });
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot",
      submitterWallet: AGENT_OWNER, postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok", authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const sub = (await ctx.db.get(res.submissionId!)) as Doc<"submissions"> | null;
      expect(sub?.campaignId).toBe(campaignId);          // the joined (other user's) campaign
      expect(sub?.influencerMint).toBe(MINT);            // identity = the agent
      expect(sub?.submitterWallet).toBe(AGENT_OWNER);    // = the agent's owner…
      expect(sub?.submitterWallet).not.toBe(otherCreator); // …NOT the campaign creator
    });
  });
});

describe("idempotency: post_content submitForCampaign + the clip-path submitClipToCampaign for the same (campaign, mint)", () => {
  it("yields exactly ONE submission row and ONE incrementSubmissions", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seed(t);
    // post_content's submit fires first (creates the row + increments the count).
    const r1 = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok", postedAt: 100, authSecret: SECRET,
    });
    // The inline/drip clip submit fires for the SAME pair → must reuse, not double.
    const r2 = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Vello Bot", submitterWallet: WALLET,
      postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok", postedAt: 100, authSecret: SECRET,
    });
    expect(r2.submissionId).toBe(r1.submissionId);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("submissions").collect()).toHaveLength(1);
      const campaign = await ctx.db.get(campaignId);
      expect(campaign?.submissionsCount).toBe(1); // ONLY one increment despite two submits
      const clip = await ctx.db.get(clipA);
      expect(clip?.submissionId).toBe(r1.submissionId); // the clip-path submit linked it
    });
  });
});

// FIX B — the CHOKE-POINT restriction gate inside the two money-binding mutations.
// A restricted-12 campaign's funded on-chain vault must NEVER be bound for a
// submitter whose account is not the single allowed one — covering ANY caller
// (drip scheduler, direct HTTP with a forged campaignId, future callers), not just
// the run-task post_content path. The allowed account is resolved by REVERSE
// wallet→email lookup (users.walletAddress ∪ walletLinks), fail-closed.
describe("restricted-campaign bind gate (FIX B choke point)", () => {
  const RESTRICTED_CR_ID = "879d3634-f98f-43f4-b2ac-0c228d80f4a8"; // "Trade with Shrimp" (restricted 12)
  const RESTRICTED_TITLE = "Trade with Shrimp Clipping Push";
  const ALLOWED_WALLET = "AllowedWalletPrimaliq1111111111111111111111";
  const OUTSIDER_WALLET = "OutsiderWallet2222222222222222222222222222";

  // Seed a restricted mirror campaign + a posted clip + the single ALLOWED account
  // (email RESTRICTED_CAMPAIGN_EMAIL → ALLOWED_WALLET via users.walletAddress).
  async function seedRestricted(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", {
        ...baseCampaign,
        title: RESTRICTED_TITLE,
        contentRewardId: RESTRICTED_CR_ID,
        origin: "clipping_fr",
        onchainVersion: 2,
      });
      const now = Date.now();
      const jobId = await ctx.db.insert("clipJobs", {
        mintAddress: MINT, sourceUrl: "https://x/v.mp4", sourceType: "campaign_asset",
        campaignId, status: "posting", createdAt: now, updatedAt: now,
      });
      const clipA = await ctx.db.insert("clips", {
        jobId, mintAddress: MINT, title: "Clip A", reason: "r", startSeconds: 0, endSeconds: 20,
        viralScore: 90, captionText: "c", status: "posted", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("users", {
        supabaseId: "sb-allowed", email: RESTRICTED_CAMPAIGN_EMAIL, walletAddress: ALLOWED_WALLET, status: "active",
      });
      return { campaignId, clipA };
    });
  }

  it("submitForCampaign: restricted campaign + NON-allowed submitter → skipped, no submission row, count unchanged", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seedRestricted(t);
    const res = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Outsider Bot", submitterWallet: OUTSIDER_WALLET,
      postUrl: "https://tiktok.com/@x/video/9", platform: "tiktok", uploadPostRequestId: "req-9", postedAt: Date.now(), authSecret: SECRET,
    });
    expect(res.ok).toBe(false);
    expect((res as { skipped?: string }).skipped).toBe("restricted");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("submissions").collect()).toHaveLength(0);
      const c = await ctx.db.get(campaignId);
      expect(c?.submissionsCount).toBe(0);
    });
  });

  it("submitForCampaign: restricted campaign + ALLOWED submitter → records the submission", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seedRestricted(t);
    const res = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Allowed Bot", submitterWallet: ALLOWED_WALLET,
      postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok", uploadPostRequestId: "req-1", postedAt: Date.now(), authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const subs = await ctx.db.query("submissions").collect();
      expect(subs).toHaveLength(1);
      expect(subs[0]?.submitterWallet).toBe(ALLOWED_WALLET);
    });
  });

  it("submitForCampaign: NON-restricted campaign records unchanged (gate is a no-op for the other 99%)", async () => {
    const t = convexTest(schema, modules);
    const { campaignId } = await seed(t); // baseCampaign — NOT one of the restricted 12
    const res = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Anyone Bot", submitterWallet: OUTSIDER_WALLET,
      postUrl: "https://tiktok.com/@x/video/2", platform: "tiktok", uploadPostRequestId: "req-2", postedAt: Date.now(), authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("submissions").collect()).toHaveLength(1);
    });
  });

  it("reverse lookup unions walletLinks: allowed account whose wallet is a walletLinks row (not the primary) → records", async () => {
    const t = convexTest(schema, modules);
    const LINK_WALLET = "LinkOnlyWallet33333333333333333333333333333";
    const campaignId = await t.run(async (ctx) => {
      const cid = await ctx.db.insert("campaigns", {
        ...baseCampaign, title: "Argos Clipping", contentRewardId: "8f6fd91f-57e7-4a22-a3e7-26f96c44a81d", origin: "clipping_fr", onchainVersion: 2,
      });
      const uid = await ctx.db.insert("users", { supabaseId: "sb-allowed-2", email: RESTRICTED_CAMPAIGN_EMAIL, status: "active" });
      await ctx.db.insert("walletLinks", { userId: uid, walletAddress: LINK_WALLET, createdAt: Date.now() });
      return cid;
    });
    const res = await t.mutation(api.submissions.submitForCampaign, {
      campaignId, influencerMint: MINT, influencerName: "Allowed Bot", submitterWallet: LINK_WALLET,
      uploadPostRequestId: "req-3", postedAt: Date.now(), authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
  });

  it("submitClipToCampaign: restricted campaign + NON-allowed submitter → skipped, no submission, clip NOT linked", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seedRestricted(t);
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Outsider Bot", submitterWallet: OUTSIDER_WALLET,
      postUrl: "https://tiktok.com/@x/video/9", platform: "tiktok", uploadPostRequestId: "req-9", postedAt: Date.now(), authSecret: SECRET,
    });
    expect(res.ok).toBe(false);
    expect((res as { skipped?: string }).skipped).toBe("restricted");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("submissions").collect()).toHaveLength(0);
      const clip = await ctx.db.get(clipA);
      expect(clip?.submissionId).toBeUndefined();
    });
  });

  it("submitClipToCampaign: restricted campaign + ALLOWED submitter → records + links the clip", async () => {
    const t = convexTest(schema, modules);
    const { campaignId, clipA } = await seedRestricted(t);
    const res = await t.mutation(api.submissions.submitClipToCampaign, {
      clipId: clipA, campaignId, influencerMint: MINT, influencerName: "Allowed Bot", submitterWallet: ALLOWED_WALLET,
      postUrl: "https://tiktok.com/@x/video/1", platform: "tiktok", uploadPostRequestId: "req-1", postedAt: Date.now(), authSecret: SECRET,
    });
    expect(res.ok).toBe(true);
    await t.run(async (ctx) => {
      const clip = await ctx.db.get(clipA);
      expect(clip?.submissionId).toBe(res.submissionId);
    });
  });
});
