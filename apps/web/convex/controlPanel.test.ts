/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { ControlTeam, ControlThread } from "./controlPanel";

type Loaded = { teams: ControlTeam[]; threads: ControlThread[] };

const modules = import.meta.glob("./**/*.ts");

async function twoUsers(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    a: await ctx.db.insert("users", { supabaseId: "did:a" }),
    b: await ctx.db.insert("users", { supabaseId: "did:b" }),
  }));
}

describe("controlPanel persistence", () => {
  it("threads + teams are per account, upsert in place, and clamp to the last 80", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await twoUsers(t);
    const msgs = Array.from({ length: 90 }, (_, i) => ({ id: `m${i}`, role: "user" as const, content: `hi ${i}`, at: i }));

    await t.mutation(internal.controlPanel.writeThread, { userId: a, key: "MINT1", messages: msgs });
    await t.mutation(internal.controlPanel.writeThread, { userId: a, key: "MINT1", messages: msgs.slice(0, 3) });
    await t.mutation(internal.controlPanel.writeTeam, { userId: a, teamId: "t1", name: "  Squad  ", memberMints: ["X", "X", "Y"], createdAt: 5 });

    const mine: Loaded = await t.query(internal.controlPanel.loadAll, { userId: a });
    expect(mine.threads).toHaveLength(1);
    expect(mine.threads[0].messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    expect(mine.teams).toEqual([{ teamId: "t1", name: "Squad", memberMints: ["X", "Y"], createdAt: 5 }]);

    const theirs = await t.query(internal.controlPanel.loadAll, { userId: b });
    expect(theirs).toEqual({ teams: [], threads: [] });

    await t.mutation(internal.controlPanel.writeThread, { userId: a, key: "MINT2", messages: msgs });
    const clamped: Loaded = await t.query(internal.controlPanel.loadAll, { userId: a });
    expect(clamped.threads.find((x) => x.key === "MINT2")!.messages).toHaveLength(80);
  });

  it("deleting a team removes its thread; saving an empty thread deletes it", async () => {
    const t = convexTest(schema, modules);
    const { a, b } = await twoUsers(t);
    const one = [{ id: "1", role: "user" as const, content: "yo", at: 1 }];
    await t.mutation(internal.controlPanel.writeTeam, { userId: a, teamId: "t1", name: "Squad", memberMints: ["X", "Y"], createdAt: 1 });
    await t.mutation(internal.controlPanel.writeThread, { userId: a, key: "team:t1", messages: one });
    await t.mutation(internal.controlPanel.writeThread, { userId: a, key: "MINT1", messages: one });
    // Another account can't delete it.
    await t.mutation(internal.controlPanel.removeTeam, { userId: b, teamId: "t1" });
    expect((await t.query(internal.controlPanel.loadAll, { userId: a })).teams).toHaveLength(1);

    await t.mutation(internal.controlPanel.removeTeam, { userId: a, teamId: "t1" });
    await t.mutation(internal.controlPanel.writeThread, { userId: a, key: "MINT1", messages: [] });
    expect(await t.query(internal.controlPanel.loadAll, { userId: a })).toEqual({ teams: [], threads: [] });
  });
});
