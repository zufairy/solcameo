import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.test).*s");

/**
 * /wallet dashboard wiring (see docs/superpowers/specs/2026-06-30-wallet-dashboard-stats-wiring-spec.md).
 *
 * Two root causes the dashboard must overcome:
 *  - IDENTITY: agents are keyed to the wallet they were minted under, so the page
 *    must query the user's FULL linked-wallet set (listByCreators), not one wallet.
 *  - VALUE: influencers.tvl has no live writer; real locked USDC is
 *    agentAccount.escrowUsdc, so the read queries must source TVL from escrow.
 */

const PERSONALITY = { warmth: 1, humor: 1, authority: 1, boldness: 1 };

async function makeAgent(
  t: TestConvex<typeof schema>,
  opts: { mint: string; creator: string; escrowUsdc?: number; monthlyEarnings?: number; secret?: string },
) {
  await t.mutation(internal.influencers.create, {
    mintAddress: opts.mint,
    creatorWallet: opts.creator,
    name: `Agent ${opts.mint.slice(0, 6)}`,
    handle: `@${opts.mint.slice(0, 6)}`,
    avatarUrl: "https://example.com/a.png",
    niche: "tech",
    language: "en",
    archetype: "analyst",
    description: "test",
    personality: PERSONALITY,
  });
  // Seed the agent wallet + secret directly (setAgentWallet is INTERNAL_CRON_SECRET
  // gated) so the secret-stripping assertion has something to strip.
  // Also seed the REAL economic account (escrow); buyShares is secret-gated too, so
  // write the account directly to set a known escrow balance for the read-path test.
  await t.run(async (ctx) => {
    if (opts.secret) {
      const inf0 = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", opts.mint))
        .unique();
      if (inf0) await ctx.db.patch(inf0._id, { agentWallet: `pub-${opts.mint}`, agentWalletSecret: opts.secret });
    }
    const existing = await ctx.db
      .query("agentAccount")
      .withIndex("by_mint", (q) => q.eq("mintAddress", opts.mint))
      .unique();
    const doc = {
      mintAddress: opts.mint,
      sharesOutstanding: 0,
      escrowUsdc: opts.escrowUsdc ?? 0,
      liquidUsdc: opts.escrowUsdc ?? 0,
      unsettledTabUsdc: 0,
      status: "active" as const,
      seedSharePrice: 10,
      plannedSupply: 1000,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("agentAccount", doc);
    // Reflect real earnings on the influencer row (addEarnings would do this in prod).
    if (opts.monthlyEarnings != null) {
      const inf = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", opts.mint))
        .unique();
      if (inf) await ctx.db.patch(inf._id, { monthlyEarnings: opts.monthlyEarnings });
    }
  });
}

describe("wallet dashboard stats wiring", () => {
  it("listByCreator sources tvl from agentAccount.escrowUsdc, not the dead column", async () => {
    const t = convexTest(schema, modules);
    await makeAgent(t, { mint: "mintA", creator: "walletA", escrowUsdc: 500 });
    const rows = await t.query(api.influencers.listByCreator, { creatorWallet: "walletA" });
    expect(rows).toHaveLength(1);
    expect(rows[0].tvl).toBe(500); // escrow, NOT the stored influencers.tvl (0)
  });

  it("listByCreators unions multiple wallets and applies real tvl", async () => {
    const t = convexTest(schema, modules);
    await makeAgent(t, { mint: "mA", creator: "wA", escrowUsdc: 100 });
    await makeAgent(t, { mint: "mB", creator: "wB", escrowUsdc: 250 });
    await makeAgent(t, { mint: "mC", creator: "wOther", escrowUsdc: 999 });

    const rows = await t.query(api.influencers.listByCreators, { creatorWallets: ["wA", "wB"] });
    expect(rows).toHaveLength(2);
    const tvlByMint = Object.fromEntries(rows.map((r) => [r.mintAddress, r.tvl]));
    expect(tvlByMint).toEqual({ mA: 100, mB: 250 }); // wOther excluded
  });

  it("listByCreators dedupes the same mint across/within wallets", async () => {
    const t = convexTest(schema, modules);
    await makeAgent(t, { mint: "dup", creator: "wDup", escrowUsdc: 42 });
    // Insert a second historical row for the SAME mint under the same creator.
    await t.run(async (ctx) => {
      const first = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", "dup"))
        .first();
      if (!first) throw new Error("seed missing");
      const { _id, _creationTime, ...rest } = first;
      void _id; void _creationTime;
      await ctx.db.insert("influencers", rest);
    });
    const rows = await t.query(api.influencers.listByCreators, { creatorWallets: ["wDup", "wDup"] });
    expect(rows).toHaveLength(1);
    expect(rows[0].tvl).toBe(42);
  });

  it("listByCreators never leaks agentWalletSecret", async () => {
    const t = convexTest(schema, modules);
    await makeAgent(t, { mint: "mS", creator: "wS", escrowUsdc: 10, secret: "c2VjcmV0LWtleQ==" });
    const rows = await t.query(api.influencers.listByCreators, { creatorWallets: ["wS"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("agentWalletSecret");
    expect(rows[0].agentWallet).toBe("pub-mS");
  });

  it("getMarketStats totals real escrow tvl, not the stored column", async () => {
    const t = convexTest(schema, modules);
    await makeAgent(t, { mint: "g1", creator: "wA", escrowUsdc: 300, monthlyEarnings: 30 });
    await makeAgent(t, { mint: "g2", creator: "wB", escrowUsdc: 700, monthlyEarnings: 0 });
    const stats = await t.query(api.influencers.getMarketStats, {});
    expect(stats.totalTvl).toBe(1000);
    expect(stats.totalAgents).toBe(2);
    expect(stats.totalMonthlyEarnings).toBe(30);
    // APR averaged over funded agents: g1 = (30*12)/300 = 1.2 → 120%; g2 funded but 0 earnings → 0.
    expect(Math.round(stats.avgApr)).toBe(60);
  });

  it("getByMint and listAll source tvl from escrow (consistent with the list queries)", async () => {
    const t = convexTest(schema, modules);
    await makeAgent(t, { mint: "one", creator: "wOne", escrowUsdc: 123 });
    const doc = await t.query(api.influencers.getByMint, { mintAddress: "one" });
    expect(doc?.tvl).toBe(123);
    const all = await t.query(api.influencers.listAll, {});
    expect(all.find((d) => d.mintAddress === "one")?.tvl).toBe(123);
  });

  it("getMarketStats does NOT double-count escrow when a mint has duplicate rows", async () => {
    const t = convexTest(schema, modules);
    await makeAgent(t, { mint: "dm", creator: "wDm", escrowUsdc: 300, monthlyEarnings: 30 });
    // A historical duplicate influencer row for the SAME mint (no unique constraint in Convex).
    await t.run(async (ctx) => {
      const first = await ctx.db
        .query("influencers")
        .withIndex("by_mint", (q) => q.eq("mintAddress", "dm"))
        .first();
      if (!first) throw new Error("seed missing");
      const { _id, _creationTime, ...rest } = first;
      void _id; void _creationTime;
      await ctx.db.insert("influencers", rest);
    });
    const stats = await t.query(api.influencers.getMarketStats, {});
    expect(stats.totalTvl).toBe(300); // escrow counted once per mint, NOT 600
    expect(stats.totalAgents).toBe(1); // deduped by mint
    expect(stats.totalMonthlyEarnings).toBe(30);
  });
});

describe("campaigns.listByCreators derived status + union", () => {
  const baseCampaign = (creator: string, overrides: Record<string, unknown> = {}) => ({
    creatorWallet: creator,
    brandName: "Brand",
    title: "Title",
    brief: "Brief",
    budget: 1000,
    ratePerThousandViews: 5,
    targetNiche: ["tech"],
    targetLanguage: ["en"],
    requirements: ["Follow the brief."],
    deadline: new Date(Date.now() + 7 * 86400_000).toISOString(),
    ...overrides,
  });

  it("derives open / ended / completed and unions wallets", async () => {
    const t = convexTest(schema, modules);
    // open: future deadline, unspent
    await t.mutation(api.campaigns.create, baseCampaign("wA"));
    // ended: past deadline
    await t.mutation(api.campaigns.create, baseCampaign("wA", { title: "Past", deadline: new Date(Date.now() - 86400_000).toISOString() }));
    // completed: budget spent (patched after create)
    const completedId = await t.mutation(api.campaigns.create, baseCampaign("wB", { title: "Spent" }));
    await t.run(async (ctx) => { await ctx.db.patch(completedId, { spentUsdc: 1000 }); });
    // a campaign under a wallet we won't query
    await t.mutation(api.campaigns.create, baseCampaign("wOther", { title: "Hidden" }));

    const rows = await t.query(api.campaigns.listByCreators, { creatorWallets: ["wA", "wB"] });
    expect(rows).toHaveLength(3); // wOther excluded
    const statusByTitle = Object.fromEntries(rows.map((c) => [c.title, c.status]));
    expect(statusByTitle["Title"]).toBe("open");
    expect(statusByTitle["Past"]).toBe("ended");
    expect(statusByTitle["Spent"]).toBe("completed");
  });
});
