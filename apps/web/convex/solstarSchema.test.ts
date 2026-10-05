/// <reference types="vite/client" />
// convex/solstarSchema.test.ts
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { assertSecret } from "./lib/solstarAuth";

const modules = import.meta.glob("./**/*.ts");

describe("ss schema", () => {
  it("accepts a character, token, budget row and indexes by network", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const characterId = await ctx.db.insert("ssCharacters", {
        ownerWallet: "W", name: "Chef Bot", bio: "robot chef", referenceImageUrl: "/x.png",
        category: "food", status: "approved", rightsAttested: true, rightsReviewed: false, createdAt: 1,
      });
      const tokenId = await ctx.db.insert("ssTokens", {
        characterId, network: "paper", name: "Chef", ticker: "CHEF", description: "d",
        state: "paper", solReserve: 30_000_000_000n, tokenReserve: 1_000_000_000_000_000n, createdAt: 1,
      });
      await ctx.db.insert("ssBudgets", { tokenId, network: "paper", fundedLamports: 0n, reservedLamports: 0n, spentLamports: 0n });
      return { characterId, tokenId };
    });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("ssTokens").withIndex("by_network", (q) => q.eq("network", "devnet")).collect());
    expect(rows).toHaveLength(0);
    expect(ids.tokenId).toBeTruthy();
  });
  it("assertSecret rejects wrong or unset secret", () => {
    process.env.INTERNAL_CRON_SECRET = "s3cret";
    expect(() => assertSecret("nope")).toThrow("unauthorized");
    expect(() => assertSecret("s3cret")).not.toThrow();
    delete process.env.INTERNAL_CRON_SECRET;
    expect(() => assertSecret("")).toThrow("unauthorized");
  });
});
