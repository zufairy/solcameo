/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINT = "Mint1111111111111111111111111111111111111";

describe("economyReconcile.checkAccount", () => {
  it("ok=true at genesis (shares match founder ledger, tab is 0)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    const res = await t.query(api.economyReconcile.checkAccount, { mintAddress: MINT });
    expect(res.ok).toBe(true);
    expect(res.issues).toHaveLength(0);
  });

  it("flags a shares mismatch between account and ledger", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      const a = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).unique();
      await ctx.db.patch(a!._id, { sharesOutstanding: a!.sharesOutstanding + 5 }); // drift
    });
    const res = await t.query(api.economyReconcile.checkAccount, { mintAddress: MINT });
    expect(res.ok).toBe(false);
    expect(res.issues.join(" ")).toMatch(/shares/i);
  });

  it("flags a tab mismatch vs unsettled usage rows", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: MINT });
    await t.run(async (ctx) => {
      await ctx.db.insert("usageLedger", {
        mintAddress: MINT, service: "render", qty: 1, unitPriceUsdc: 0.4, costUsdc: 0.4, at: Date.now(),
      });
      // account.unsettledTabUsdc left at 0 → mismatch with the 0.4 unsettled usage
    });
    const res = await t.query(api.economyReconcile.checkAccount, { mintAddress: MINT });
    expect(res.ok).toBe(false);
    expect(res.issues.join(" ")).toMatch(/tab/i);
  });
});
