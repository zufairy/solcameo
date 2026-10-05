/// <reference types="vite/client" />
/**
 * Security regression tests: the money-moving economy mutations that were
 * publicly writable are now internal-secret gated (E2E hunt #27/34/39). A direct
 * client call (bypassing the SIWS-authed Next route) must be rejected — the gate
 * is the handler's first line, so no seed is needed for the reject path.
 */
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
process.env.INTERNAL_CRON_SECRET = process.env.INTERNAL_CRON_SECRET || "test-cron-secret";

describe("economy money-mutations are internal-secret gated", () => {
  it("shares.redeemShares rejects a direct call without the internal secret", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.shares.redeemShares, {
        mintAddress: "Mint1",
        holderWallet: "Holder1",
        sharesToBurn: 100,
        authSecret: "wrong",
      } as never),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("shares.markRedeemPaid rejects a direct call without the internal secret", async () => {
    const t = convexTest(schema, modules);
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("shareLedger", {
        mintAddress: "Mint1",
        wallet: "Holder1",
        kind: "redeem",
        shares: -100,
        navPerShare: 1,
        usdcAmount: 100,
        exitFeeUsdc: 2,
        at: 1,
      } as never),
    );
    await expect(
      t.mutation(api.shares.markRedeemPaid, {
        redeemRowId: rowId as Id<"shareLedger">,
        txSignature: "sig",
        authSecret: "wrong",
      } as never),
    ).rejects.toThrow(/unauthorized/i);
  });
});
