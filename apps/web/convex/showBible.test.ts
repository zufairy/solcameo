/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "s3cret";

async function seedAgent(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("influencers", {
      mintAddress: "mint1",
      creatorWallet: "wallet1",
      name: "Lex",
      handle: "@lex",
      avatarUrl: "",
      niche: "law",
      language: "en",
      archetype: "commentator",
      description: "AI influencer",
      agentType: "influencer",
      personality: { warmth: 5, humor: 5, authority: 5, boldness: 5 },
      tvl: 0,
      monthlyEarnings: 0,
      sharePrice: 1,
      totalShares: 0,
      availableShares: 0,
      updatedAt: Date.now(),
    });
  });
}

test("setShowBible stores a normalized bible and bumps version on update", async () => {
  const t = convexTest(schema, modules);
  await seedAgent(t);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  await t.mutation(api.influencers.setShowBible, {
    mintAddress: "mint1",
    showBible: { premise: "cartoon lawyer reacts to news", format: { kinds: ["news-react"] } },
    authSecret: SECRET,
  });
  const a1 = await t.query(api.influencers.getByMint, { mintAddress: "mint1" });
  expect(a1?.showBible?.premise).toBe("cartoon lawyer reacts to news");
  expect(a1?.showBible?.version).toBe(1);

  await t.mutation(api.influencers.setShowBible, {
    mintAddress: "mint1",
    showBible: { premise: "cartoon lawyer reacts to news, now spicier", format: { kinds: ["news-react", "skit"] } },
    authSecret: SECRET,
  });
  const a2 = await t.query(api.influencers.getByMint, { mintAddress: "mint1" });
  expect(a2?.showBible?.version).toBe(2);
});

test("setShowBible rejects junk bibles and bad secrets", async () => {
  const t = convexTest(schema, modules);
  await seedAgent(t);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  await expect(t.mutation(api.influencers.setShowBible, {
    mintAddress: "mint1", showBible: { premise: "" }, authSecret: SECRET,
  })).rejects.toThrow(/invalid/i);
  await expect(t.mutation(api.influencers.setShowBible, {
    mintAddress: "mint1", showBible: { premise: "p", format: { kinds: ["x"] } }, authSecret: "wrong",
  })).rejects.toThrow(/unauthorized/i);
});

test("setAutonomyMode validates the mode and is secret-gated", async () => {
  const t = convexTest(schema, modules);
  await seedAgent(t);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  await t.mutation(api.influencers.setAutonomyMode, { mintAddress: "mint1", mode: "review-ideas", authSecret: SECRET });
  const a = await t.query(api.influencers.getByMint, { mintAddress: "mint1" });
  expect(a?.autonomyMode).toBe("review-ideas");
  await expect(t.mutation(api.influencers.setAutonomyMode, { mintAddress: "mint1", mode: "yolo", authSecret: SECRET }))
    .rejects.toThrow(/invalid/i);
  await expect(t.mutation(api.influencers.setAutonomyMode, { mintAddress: "mint1", mode: "full-auto", authSecret: "wrong" }))
    .rejects.toThrow(/unauthorized/i);
});

test("setRotationState and setTasteProfile round-trip", async () => {
  const t = convexTest(schema, modules);
  await seedAgent(t);
  process.env.INTERNAL_CRON_SECRET = SECRET;
  await t.mutation(api.influencers.setRotationState, {
    mintAddress: "mint1", rotationState: { hookIdx: 1, structureIdx: 0, settingIdx: 2, formatIdx: 1 }, authSecret: SECRET,
  });
  await t.mutation(api.influencers.setTasteProfile, {
    mintAddress: "mint1", tasteProfile: { prose: "loves courtroom absurdity", updatedAt: 123, eventCount: 3 }, authSecret: SECRET,
  });
  const a = await t.query(api.influencers.getByMint, { mintAddress: "mint1" });
  expect(a?.rotationState?.settingIdx).toBe(2);
  expect(a?.tasteProfile?.prose).toContain("courtroom");
});
