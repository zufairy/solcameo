import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.test).*s");

// setAgentWallet is INTERNAL_CRON_SECRET-gated; give the test a known secret.
const AUTH = "test-internal-cron-secret";
process.env.INTERNAL_CRON_SECRET = AUTH;

/**
 * JOB-84 acceptance: `agentWalletSecret` (base64 Solana private key) must NEVER
 * be returned by any public Convex query. A leak here lets any unauthenticated
 * client read every agent's private key and drain on-chain USDC/SOL.
 *
 * These tests assert the secret is stripped from every public read path, while
 * remaining reachable server-side via the internal query + the server-secret
 * gated query used by the trader API routes.
 */
describe("agentWalletSecret exposure (JOB-84)", () => {
  const SECRET = "dGhpcy1pcy1hLWZha2UtNjQtYnl0ZS1zZWNyZXQta2V5LWZvci10ZXN0aW5n";
  const PUBKEY = "AgentWa11etPubKey1111111111111111111111111";
  const MINT = "MintAddr1111111111111111111111111111111111";
  const CREATOR = "CreatorWa11et11111111111111111111111111111";

  async function seed() {
    const t = convexTest(schema, modules);
    await t.mutation(internal.influencers.create, {
      mintAddress: MINT,
      creatorWallet: CREATOR,
      name: "Test Agent",
      handle: "@test",
      avatarUrl: "https://example.com/a.png",
      niche: "tech",
      language: "en",
      archetype: "analyst",
      description: "test",
      personality: { warmth: 1, humor: 1, authority: 1, boldness: 1 },
    });
    await t.mutation(api.influencers.setAgentWallet, {
      mintAddress: MINT,
      agentWallet: PUBKEY,
      agentWalletSecret: SECRET,
      authSecret: AUTH,
    });
    return t;
  }

  it("getByMint does not return agentWalletSecret", async () => {
    const t = await seed();
    const doc = await t.query(api.influencers.getByMint, { mintAddress: MINT });
    expect(doc).not.toBeNull();
    expect(doc).not.toHaveProperty("agentWalletSecret");
    // public key is safe to expose and the UI depends on it
    expect(doc?.agentWallet).toBe(PUBKEY);
  });

  it("listAll does not return agentWalletSecret on any doc", async () => {
    const t = await seed();
    const docs = await t.query(api.influencers.listAll, {});
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) expect(d).not.toHaveProperty("agentWalletSecret");
  });

  it("listByCreator does not return agentWalletSecret", async () => {
    const t = await seed();
    const docs = await t.query(api.influencers.listByCreator, { creatorWallet: CREATOR });
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) expect(d).not.toHaveProperty("agentWalletSecret");
  });

  it("getById does not return agentWalletSecret", async () => {
    const t = await seed();
    const all = await t.query(api.influencers.listAll, {});
    const id = all[0]._id;
    const doc = await t.query(api.influencers.getById, { id });
    expect(doc).not.toHaveProperty("agentWalletSecret");
  });

  it("nftAgents.resumeByMint does not return agentWalletSecret", async () => {
    const t = await seed();
    const bundle = await t.query(api.nftAgents.resumeByMint, { mintAddress: MINT });
    expect(bundle?.influencer).not.toHaveProperty("agentWalletSecret");
  });

  it("internal query getByMintInternal still exposes the secret server-side", async () => {
    const t = await seed();
    const doc = await t.query(internal.influencers.getByMintInternal, { mintAddress: MINT });
    expect(doc?.agentWalletSecret).toBe(SECRET);
  });
});
