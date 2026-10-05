/// <reference types="vite/client" />
/**
 * completeMint must be idempotent per session: once a session's draft is minted,
 * a retry (route resume after a mid-flight failure, or a duplicate tab) must NOT
 * re-consume the fee signature — otherwise the second call throws "Transaction
 * already processed" and dead-ends, stranding a paid $50. This locks that in.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const WALLET = "WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
// completeMint is now INTERNAL_CRON_SECRET-gated (the /api/nft/mint route forwards it).
const SECRET = "test-internal-cron-secret-completemint";
process.env.INTERNAL_CRON_SECRET = SECRET;

describe("nftAgents.completeMint — idempotent resume", () => {
  it("re-completing a minted session is a no-op (does not re-consume a fresh signature)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("nftDrafts", {
        sessionId: "s1", creatorWallet: WALLET, name: "A", niche: "lifestyle",
        avatarUrls: [], questionnaire: {}, mintStatus: "minted",
        mintTxSignature: "free_promo_first", mintAddress: "mint_1",
      });
    });
    // A resume attempt with a brand-new signature must NOT throw and must NOT
    // record the new signature (idempotent early return).
    await t.mutation(api.nftAgents.completeMint, {
      sessionId: "s1", mintTxSignature: "free_promo_second", mintAddress: "mint_1", creatorWallet: WALLET, authSecret: SECRET,
    });
    const consumed = await t.run(async (ctx) =>
      ctx.db.query("processedSignatures").withIndex("by_signature", (q) => q.eq("txSignature", "free_promo_second")).first(),
    );
    expect(consumed).toBeNull();
  });

  it("still consumes the signature on a first, non-minted completion", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("nftDrafts", {
        sessionId: "s2", creatorWallet: WALLET, name: "A", niche: "lifestyle",
        avatarUrls: [], questionnaire: {}, mintStatus: "draft",
      });
    });
    await t.mutation(api.nftAgents.completeMint, {
      sessionId: "s2", mintTxSignature: "free_promo_only", mintAddress: "mint_2", creatorWallet: WALLET, authSecret: SECRET,
    });
    const consumed = await t.run(async (ctx) =>
      ctx.db.query("processedSignatures").withIndex("by_signature", (q) => q.eq("txSignature", "free_promo_only")).first(),
    );
    expect(consumed).not.toBeNull();
    // And a replay of that same signature now throws (replay protection intact).
    await expect(
      t.mutation(api.nftAgents.completeMint, {
        sessionId: "s3", mintTxSignature: "free_promo_only", mintAddress: "mint_3", creatorWallet: WALLET, authSecret: SECRET,
      }),
    ).rejects.toThrow(/already processed/i);
  });
});
