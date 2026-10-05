/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { memoryDedupKey } from "./agentTasks";

const modules = import.meta.glob("./**/*.ts");
const MINT = "MemGateTestMint1111111111111111111111111";
const SECRET = "test-internal-cron-secret-memgate";
process.env.INTERNAL_CRON_SECRET = SECRET;

const rec = (over: { kind?: string; summary?: string; importance?: number }) => ({
  mintAddress: MINT,
  kind: over.kind ?? "lesson",
  summary: over.summary ?? "A useful lesson about hooks",
  importance: over.importance ?? 70,
  authSecret: SECRET,
});

async function memoryCount(t: TestConvex<typeof schema>): Promise<number> {
  return t.run(async (ctx) => (await ctx.db.query("agentMemory").withIndex("by_mint", (q) => q.eq("mintAddress", MINT)).collect()).length);
}

describe("memoryDedupKey", () => {
  it("collapses digit-only differences (near-duplicate cycle memories)", () => {
    expect(memoryDedupKey("performance", "Wallet: $5 USDC, healthy"))
      .toBe(memoryDedupKey("performance", "Wallet: $6 USDC, healthy"));
  });
  it("distinguishes different kinds", () => {
    expect(memoryDedupKey("lesson", "same text")).not.toBe(memoryDedupKey("warning", "same text"));
  });
  it("distinguishes genuinely different summaries", () => {
    expect(memoryDedupKey("lesson", "hooks matter")).not.toBe(memoryDedupKey("lesson", "captions matter"));
  });
});

describe("recordMemory gate", () => {
  it("rejects a bad secret", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.agentTasks.recordMemory, { ...rec({}), authSecret: "wrong" })).rejects.toThrow(/unauthorized/);
  });

  it("DROPS a low-importance (routine) memory below the floor", async () => {
    const t = convexTest(schema, modules);
    const r = await t.mutation(api.agentTasks.recordMemory, rec({ importance: 45, summary: "Wallet: $5 USDC, healthy", kind: "performance" }));
    expect(r).toMatchObject({ skipped: "low-importance" });
    expect(await memoryCount(t)).toBe(0);
  });

  it("KEEPS a meaningful memory at/above the floor", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.agentTasks.recordMemory, rec({ importance: 65, summary: "Made a strong video about AI agents" }));
    expect(await memoryCount(t)).toBe(1);
  });

  it("DEDUPS a near-identical memory (same normalised kind+summary)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.agentTasks.recordMemory, rec({ importance: 55, kind: "performance", summary: "Wallet: $5 USDC, healthy day 1" }));
    // Same lesson re-derived next cycle — only the digits differ → deduped.
    const r2 = await t.mutation(api.agentTasks.recordMemory, rec({ importance: 55, kind: "performance", summary: "Wallet: $6 USDC, healthy day 2" }));
    expect(r2).toMatchObject({ skipped: "duplicate" });
    expect(await memoryCount(t)).toBe(1);
  });

  it("KEEPS two genuinely distinct meaningful memories", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.agentTasks.recordMemory, rec({ importance: 60, summary: "Audience loves close-up texture shots" }));
    await t.mutation(api.agentTasks.recordMemory, rec({ importance: 60, summary: "Jump cuts every 2 seconds boost retention" }));
    expect(await memoryCount(t)).toBe(2);
  });
});
