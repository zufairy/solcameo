/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "MintSP5111111111111111111111111111111111";

// nftAgents.saveInfluencer is now INTERNAL_CRON_SECRET-gated (server-route-only); the
// test supplies the secret the /api/nft/mint route forwards.
const SECRET = "test-internal-cron-secret-nftagents";
process.env.INTERNAL_CRON_SECRET = SECRET;

const baseArgs = {
  sessionId: "session-test-001",
  mintAddress: MINT,
  creatorWallet: "Creator1111111111111111111111111111111111",
  name: "Test Agent",
  handle: "@test",
  avatarUrl: "https://example.com/a.png",
  niche: "tech",
  language: "en",
  archetype: "builder",
  description: "d",
  agentType: "influencer",
  authSecret: SECRET,
};

describe("saveInfluencer creates the economic account", () => {
  it("an agentAccount exists (empty pool) after minting an agent", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.nftAgents.saveInfluencer, baseArgs);
    const acct = await t.query(api.agentAccount.get, { mintAddress: MINT });
    expect(acct).not.toBeNull();
    expect(acct!.sharesOutstanding).toBe(0);
    expect(acct!.escrowUsdc).toBe(0);
    expect(acct!.plannedSupply).toBe(1_000_000);
    expect(acct!.status).toBe("active");
  });

  it("is idempotent — re-saving the same agent does not create a second account", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.nftAgents.saveInfluencer, baseArgs);
    await t.mutation(api.nftAgents.saveInfluencer, { ...baseArgs, name: "Renamed" });
    const all = await t.run(async (ctx) =>
      ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect());
    expect(all).toHaveLength(1);
  });
});
