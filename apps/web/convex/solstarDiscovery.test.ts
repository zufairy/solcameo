/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
it("sorts public episodes newest first and hides unapproved characters", async () => {
  const t = convexTest(schema, modules);
  const prior = process.env.INTERNAL_CRON_SECRET;
  process.env.INTERNAL_CRON_SECRET = "discovery-test";
  try {
    await t.mutation(api.solstarCatalog.seedSample, {authSecret:"discovery-test"});
    const initial = await t.query(api.solstarDiscovery.latestVideos, {});
    expect(initial.length).toBeGreaterThan(0);
    expect(initial.every(e => e.sample)).toBe(true);
    const hidden = initial[0].characterId;
    await t.run(async ctx => { await ctx.db.patch(hidden, {status:"draft"}); });
    const visible = await t.query(api.solstarDiscovery.latestVideos, {});
    expect(visible.some(e => e.characterId === hidden)).toBe(false);
    expect(visible.map(e=>e.createdAt)).toEqual([...visible.map(e=>e.createdAt)].sort((a,b)=>b-a));
  } finally { if (prior === undefined) delete process.env.INTERNAL_CRON_SECRET; else process.env.INTERNAL_CRON_SECRET=prior; }
});
