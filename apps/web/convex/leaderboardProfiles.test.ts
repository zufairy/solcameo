/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
describe("public leaderboard identities", () => {
  it("resolves linked and legacy wallets without exposing account fields", async () => {
    const t = convexTest(schema, modules);
    await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { supabaseId: "private-id", email: "private@example.com", name: "Creator", image: "https://example.com/avatar.png", walletAddress: "primary" });
      await ctx.db.insert("walletLinks", { userId, walletAddress: "linked", createdAt: 1 });
    });
    const result = await t.query(api.users.leaderboardProfiles, { wallets: ["linked", "primary", "missing", "linked"] });
    expect(result).toEqual([
      { wallet: "linked", name: "Creator", image: "https://example.com/avatar.png" },
      { wallet: "primary", name: "Creator", image: "https://example.com/avatar.png" },
      { wallet: "missing" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(await t.query(api.users.leaderboardProfiles, { wallets: Array(101).fill("primary") })).toEqual([]);
  });
});
