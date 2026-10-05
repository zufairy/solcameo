/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "agent-description-test-secret";

beforeAll(() => {
  process.env.INTERNAL_CRON_SECRET = SECRET;
});

async function seedAgent() {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) => ctx.db.insert("influencers", {
    mintAddress: "DescriptionTestMint",
    creatorWallet: "DescriptionTestOwner",
    name: "Signal Cutter",
    handle: "signal_cutter",
    avatarUrl: "",
    niche: "technology podcasts",
    language: "English",
    archetype: "sharp and direct",
    description: "uploaded",
    agentType: "clipping",
    personality: { warmth: 50, humor: 50, authority: 70, boldness: 70 },
    tvl: 0,
    monthlyEarnings: 0,
    sharePrice: 1,
    totalShares: 1000,
    availableShares: 1000,
  }));
  return { t, id };
}

describe("canonical agent descriptions", () => {
  it("backfills malformed existing descriptions", async () => {
    const { t, id } = await seedAgent();
    const result = await t.mutation(api.influencers.standardizeAllDescriptions, { authSecret: SECRET });
    const agent = await t.run((ctx) => ctx.db.get(id));

    expect(result).toEqual({ total: 1, updated: 1 });
    expect(agent?.description).toBe("Signal Cutter is an AI clipper focused on technology podcasts. It turns long videos into concise, high-retention social clips with a sharp and direct style.");
  });

  it("rebuilds the description when persona facts change", async () => {
    const { t, id } = await seedAgent();
    await t.mutation(api.influencers.update, {
      id,
      name: "Signal Cutter",
      handle: "signal_cutter",
      avatarUrl: "",
      niche: "founder interviews",
      language: "English",
      archetype: "calm expert",
      description: "arbitrary copy that must not persist",
      personality: { warmth: 50, humor: 50, authority: 70, boldness: 70 },
      authSecret: SECRET,
    });
    const agent = await t.run((ctx) => ctx.db.get(id));
    expect(agent?.description).toContain("focused on founder interviews");
    expect(agent?.description).not.toContain("arbitrary copy");
  });
});
