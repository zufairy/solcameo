/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
process.env.INTERNAL_CRON_SECRET = "test-draft-secret";

const campaign = {
  creatorWallet: "creator-wallet", brandName: "Brand", brandLogoUrl: "https://example.com/logo.png",
  title: "Original", brief: "A real brief", budget: 50, ratePerThousandViews: 0.2,
  campaignType: "marketing" as const, targetNiche: ["tech"], targetLanguage: ["en"],
  deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  status: "open" as const, submissionsCount: 0,
};

describe("campaigns.updateDraft", () => {
  it("lets the signed server edit an unfunded draft", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("campaigns", campaign));
    await t.mutation(api.campaigns.updateDraft, { authSecret: "test-draft-secret", id, patch: { title: "Updated", budget: 75 } });
    expect((await t.run((ctx) => ctx.db.get(id)))?.title).toBe("Updated");
  });

  it("rejects unauthorized and funded edits", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("campaigns", campaign));
    await expect(t.mutation(api.campaigns.updateDraft, { authSecret: "wrong", id, patch: { title: "No" } })).rejects.toThrow("unauthorized");
    await t.run((ctx) => ctx.db.patch(id, { pdaAddress: "vault", onchainVersion: 2 }));
    await expect(t.mutation(api.campaigns.updateDraft, { authSecret: "test-draft-secret", id, patch: { title: "No" } })).rejects.toThrow("Funded");
  });

  it("rejects a budget below its payout rate", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) => ctx.db.insert("campaigns", campaign));
    await expect(t.mutation(api.campaigns.updateDraft, { authSecret: "test-draft-secret", id, patch: { budget: 0.1 } })).rejects.toThrow("Budget");
  });
});
