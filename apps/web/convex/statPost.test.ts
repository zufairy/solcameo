/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const secret = "stat-test";
beforeEach(() => { process.env.INTERNAL_CRON_SECRET = secret; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
const stats = async (t: ReturnType<typeof convexTest>) => (await t.query(api.contentControl.state, { authSecret: secret })).posts.filter((p) => p.source === "stat");

describe("network stats posts", () => {
  it("posts nothing in the small hours, then one post per slot as the day's random hours pass", async () => {
    const t = convexTest(schema, modules);
    vi.setSystemTime(Date.UTC(2026, 9, 8, 3, 0, 0));
    await t.mutation(internal.contentControl.statCron, {});
    expect(await stats(t)).toHaveLength(0);
    vi.setSystemTime(Date.UTC(2026, 9, 8, 13, 30, 0)); // past the morning slot, before the evening one
    await t.mutation(internal.contentControl.statCron, {});
    await t.mutation(internal.contentControl.statCron, {}); // the same hour again must not repeat it
    expect(await stats(t)).toHaveLength(1);
    vi.setSystemTime(Date.UTC(2026, 9, 8, 22, 0, 0));
    await t.mutation(internal.contentControl.statCron, {});
    const posts = await stats(t);
    expect(posts).toHaveLength(2);
    for (const p of posts) expect(p).toMatchObject({ source: "stat", platforms: ["x"], status: "queued" });
  });
  it("posts a fresh one on demand with the chosen card, with no setup needed", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(api.contentControl.statNow, { authSecret: secret, kind: "leaderboard" });
    expect(first.queued).toBe(true);
    expect((await stats(t))[0]).toMatchObject({ statKind: "leaderboard" });
  });
});
