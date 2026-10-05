/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { BuilderSessionRow } from "./adminBuilder";

const modules = import.meta.glob("./**/*.ts");
const WALLET = "Wa11et1111111111111111111111111111111111111";
const HOUR = 60 * 60 * 1000;

async function seedSession(t: ReturnType<typeof convexTest>, opts: {
  sessionId: string; lastActivityAt: number; mintAddress?: string; draftMintStatus?: string;
}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("builderSessions", {
      sessionId: opts.sessionId,
      wallet: WALLET,
      agentType: "influencer",
      projectName: `proj ${opts.sessionId}`,
      messages: [
        { role: "user" as const, content: "hello", at: opts.lastActivityAt - 1000 },
        { role: "assistant" as const, content: "hi there", at: opts.lastActivityAt },
      ],
      messageCount: 2,
      startedAt: opts.lastActivityAt - 1000,
      lastActivityAt: opts.lastActivityAt,
      mintAddress: opts.mintAddress,
    });
    if (opts.draftMintStatus) {
      await ctx.db.insert("nftDrafts", {
        sessionId: opts.sessionId,
        name: `agent ${opts.sessionId}`,
        niche: "tech",
        avatarUrls: [],
        questionnaire: {},
        mintStatus: opts.draftMintStatus,
      });
    }
  });
}

describe("adminBuilder.listBuilderSessionsData", () => {
  it("lists sessions newest-first with derived status and no transcript payload", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedSession(t, { sessionId: "s-minted", lastActivityAt: now - 1 * HOUR, draftMintStatus: "minted" });
    await seedSession(t, { sessionId: "s-active", lastActivityAt: now - 2 * HOUR, draftMintStatus: "draft" });
    await seedSession(t, { sessionId: "s-gone", lastActivityAt: now - 72 * HOUR });

    const rows: BuilderSessionRow[] = await t.query(internal.adminBuilder.listBuilderSessionsData, { filter: "all" });
    expect(rows.map((r) => r.sessionId)).toEqual(["s-minted", "s-active", "s-gone"]);
    expect(rows.find((r) => r.sessionId === "s-minted")!.status).toBe("minted");
    expect(rows.find((r) => r.sessionId === "s-active")!.status).toBe("draft");
    expect(rows.find((r) => r.sessionId === "s-gone")!.status).toBe("abandoned");
    expect(rows[0]).not.toHaveProperty("messages");
    expect(rows[0].lastMessagePreview).toBe("hi there");
    expect(rows[0].draftName).toBe("agent s-minted");
  });

  it("treats a session with its own mintAddress as minted even without a draft", async () => {
    const t = convexTest(schema, modules);
    await seedSession(t, {
      sessionId: "s-mint2", lastActivityAt: Date.now() - 100 * HOUR,
      mintAddress: "Mint1111111111111111111111111111111111111",
    });
    const rows: BuilderSessionRow[] = await t.query(internal.adminBuilder.listBuilderSessionsData, { filter: "all" });
    expect(rows[0].status).toBe("minted"); // mintAddress wins over the 48h abandoned rule
  });

  it("filter=not_minted excludes minted sessions; filter=minted excludes the rest", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedSession(t, { sessionId: "s-m", lastActivityAt: now, draftMintStatus: "minted" });
    await seedSession(t, { sessionId: "s-d", lastActivityAt: now, draftMintStatus: "draft" });

    const notMinted: BuilderSessionRow[] = await t.query(internal.adminBuilder.listBuilderSessionsData, { filter: "not_minted" });
    expect(notMinted.map((r) => r.sessionId)).toEqual(["s-d"]);
    const minted: BuilderSessionRow[] = await t.query(internal.adminBuilder.listBuilderSessionsData, { filter: "minted" });
    expect(minted.map((r) => r.sessionId)).toEqual(["s-m"]);
  });

  it("handles a session with an empty messages array (preview is empty, no crash)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("builderSessions", {
        sessionId: "s-empty", wallet: WALLET, messages: [], messageCount: 0,
        startedAt: Date.now(), lastActivityAt: Date.now(),
      });
    });
    const rows: BuilderSessionRow[] = await t.query(internal.adminBuilder.listBuilderSessionsData, { filter: "all" });
    expect(rows[0].lastMessagePreview).toBe("");
  });

  it("caps the scan window at the latest 300 sessions", async () => {
    const t = convexTest(schema, modules);
    const base = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 301; i++) {
        await ctx.db.insert("builderSessions", {
          sessionId: `s-${i}`, wallet: WALLET,
          messages: [{ role: "user" as const, content: `m${i}`, at: base + i }],
          messageCount: 1, startedAt: base + i, lastActivityAt: base + i,
        });
      }
    });
    const rows: BuilderSessionRow[] = await t.query(internal.adminBuilder.listBuilderSessionsData, { filter: "all" });
    expect(rows).toHaveLength(300);
    // the OLDEST session (s-0) fell out of the window
    expect(rows.some((r) => r.sessionId === "s-0")).toBe(false);
  });
});

describe("adminBuilder.getBuilderSessionData", () => {
  it("returns the full transcript plus joined draft, and null for unknown ids", async () => {
    const t = convexTest(schema, modules);
    await seedSession(t, { sessionId: "s-detail", lastActivityAt: Date.now(), draftMintStatus: "draft" });

    const detail = await t.query(internal.adminBuilder.getBuilderSessionData, { sessionId: "s-detail" });
    expect(detail).not.toBeNull();
    expect(detail!.session.messages).toHaveLength(2);
    expect(detail!.draft?.name).toBe("agent s-detail");
    expect(detail!.status).toBe("draft");

    const missing = await t.query(internal.adminBuilder.getBuilderSessionData, { sessionId: "nope" });
    expect(missing).toBeNull();
  });
});

describe("admin conversation account identity", () => {
  it("resolves the account name + email behind a session's wallet (via walletLinks)", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await seedSession(t, { sessionId: "s-who", lastActivityAt: now });
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { supabaseId: "did:privy:who", name: "Dana", email: "dana@example.com" });
      await ctx.db.insert("walletLinks", { userId, walletAddress: WALLET, createdAt: now });
    });

    const rows: BuilderSessionRow[] = await t.query(internal.adminBuilder.listBuilderSessionsData, { filter: "all" });
    expect(rows[0].accountName).toBe("Dana");
    expect(rows[0].accountEmail).toBe("dana@example.com");

    const detail = await t.query(internal.adminBuilder.getBuilderSessionData, { sessionId: "s-who" });
    expect(detail!.account).toEqual({ accountName: "Dana", accountEmail: "dana@example.com" });
  });

  it("live chats resolve identity from the verified DID and keep captured email", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { supabaseId: "did:privy:chat", name: "Sam", email: "sam@example.com" });
    });
    await t.mutation(api.liveChat.append, {
      sessionId: "lc-1", role: "user", content: "hi", at: now, userDid: "did:privy:chat", email: "sam@example.com", page: "/agents",
    });
    await t.mutation(api.liveChat.append, { sessionId: "lc-anon", role: "user", content: "yo", at: now + 1 });

    const rows = await t.query(internal.liveChat.listData, {});
    const known = rows.find((r) => r.sessionId === "lc-1")!;
    expect(known).toMatchObject({ accountName: "Sam", accountEmail: "sam@example.com", email: "sam@example.com", page: "/agents" });
    const anon = rows.find((r) => r.sessionId === "lc-anon")!;
    expect(anon.accountEmail).toBeUndefined();
  });
});
