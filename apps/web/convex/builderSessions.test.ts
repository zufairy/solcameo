/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SESSION = "sess-test-1";
const WALLET = "Wa11et1111111111111111111111111111111111111";

function msg(i: number, role: "user" | "assistant" = "user", content = `message ${i}`) {
  return { role, content, at: 1_000_000 + i };
}

describe("builderSessions.sync", () => {
  it("creates a session doc on first sync", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.builderSessions.sync, {
      sessionId: SESSION,
      wallet: WALLET,
      agentType: "influencer",
      projectName: "My Agent",
      messages: [msg(1, "user"), msg(2, "assistant")],
    });
    const doc = await t.run(async (ctx) =>
      ctx.db.query("builderSessions").withIndex("by_session", (q) => q.eq("sessionId", SESSION)).unique());
    expect(doc).not.toBeNull();
    expect(doc!.wallet).toBe(WALLET);
    expect(doc!.messages).toHaveLength(2);
    expect(doc!.messageCount).toBe(2);
    expect(doc!.startedAt).toBe(1_000_001);
    expect(doc!.lastActivityAt).toBe(1_000_002);
  });

  it("upserts by sessionId — second sync updates, never duplicates", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.builderSessions.sync, {
      sessionId: SESSION, wallet: WALLET, messages: [msg(1)],
    });
    await t.mutation(api.builderSessions.sync, {
      sessionId: SESSION, wallet: WALLET, messages: [msg(1), msg(2), msg(3)],
      mintAddress: "Mint1111111111111111111111111111111111111",
    });
    const all = await t.run(async (ctx) =>
      ctx.db.query("builderSessions").withIndex("by_session", (q) => q.eq("sessionId", SESSION)).collect());
    expect(all).toHaveLength(1);
    expect(all[0].messages).toHaveLength(3);
    expect(all[0].mintAddress).toBe("Mint1111111111111111111111111111111111111");
  });

  it("does not lose agentType/projectName/mintAddress when a later sync omits them", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.builderSessions.sync, {
      sessionId: SESSION, wallet: WALLET, agentType: "trader", projectName: "Alpha",
      mintAddress: "Mint1111111111111111111111111111111111111", messages: [msg(1)],
    });
    await t.mutation(api.builderSessions.sync, {
      sessionId: SESSION, wallet: WALLET, messages: [msg(1), msg(2)],
    });
    const doc = await t.run(async (ctx) =>
      ctx.db.query("builderSessions").withIndex("by_session", (q) => q.eq("sessionId", SESSION)).unique());
    expect(doc!.agentType).toBe("trader");
    expect(doc!.projectName).toBe("Alpha");
    expect(doc!.mintAddress).toBe("Mint1111111111111111111111111111111111111");
  });

  it("caps stored messages at the last 200 but keeps the true messageCount", async () => {
    const t = convexTest(schema, modules);
    const many = Array.from({ length: 250 }, (_, i) => msg(i + 1));
    await t.mutation(api.builderSessions.sync, {
      sessionId: SESSION, wallet: WALLET, messages: many,
    });
    const doc = await t.run(async (ctx) =>
      ctx.db.query("builderSessions").withIndex("by_session", (q) => q.eq("sessionId", SESSION)).unique());
    expect(doc!.messages).toHaveLength(200);
    expect(doc!.messages[0].content).toBe("message 51"); // first 50 trimmed
    expect(doc!.messageCount).toBe(250);
    expect(doc!.startedAt).toBe(1_000_001); // first of the original 250, not the trimmed window
  });

  it("truncates each message content to 2,000 chars", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.builderSessions.sync, {
      sessionId: SESSION, wallet: WALLET,
      messages: [{ role: "user", content: "x".repeat(5_000), at: 1 }],
    });
    const doc = await t.run(async (ctx) =>
      ctx.db.query("builderSessions").withIndex("by_session", (q) => q.eq("sessionId", SESSION)).unique());
    expect(doc!.messages[0].content).toHaveLength(2_000);
  });
});
