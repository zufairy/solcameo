import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { assertAdminUser } from "./lib/auth";

const modules = import.meta.glob("./**/!(*.test).*s");

describe("assertAdminUser", () => {
  const base = { _id: "x", _creationTime: 0, supabaseId: "s" } as never;

  it("allows an active admin", () => {
    expect(() => assertAdminUser({ ...(base as object), isAdmin: true, status: "active" } as never)).not.toThrow();
  });
  it("rejects non-admins, suspended admins, and null", () => {
    expect(() => assertAdminUser({ ...(base as object), isAdmin: false } as never)).toThrow(/admin access required/i);
    expect(() => assertAdminUser({ ...(base as object), isAdmin: true, status: "suspended" } as never)).toThrow(/admin access required/i);
    expect(() => assertAdminUser(null)).toThrow(/admin access required/i);
  });
});

describe("upsertFromSupabase admin seeding", () => {
  const prevSeed = process.env.ADMIN_SEED_EMAILS;
  afterEach(() => {
    if (prevSeed === undefined) delete process.env.ADMIN_SEED_EMAILS;
    else process.env.ADMIN_SEED_EMAILS = prevSeed;
  });

  it("does NOT auto-grant admin to the first user (no first-user backdoor)", async () => {
    delete process.env.ADMIN_SEED_EMAILS;
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u1", email: "1@x.com" });
    await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u2", email: "2@x.com" });

    const u1 = await t.query(internal.users.getBySupabaseId, { supabaseId: "u1" });
    const u2 = await t.query(internal.users.getBySupabaseId, { supabaseId: "u2" });
    expect(u1?.isAdmin).toBe(false);
    expect(u2?.isAdmin).toBe(false);
  });

  it("grants admin ONLY to emails in ADMIN_SEED_EMAILS (case-insensitive)", async () => {
    process.env.ADMIN_SEED_EMAILS = "admin@x.com, other@x.com";
    const t = convexTest(schema, modules);
    await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u1", email: "1@x.com" });
    await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u2", email: "Admin@X.com" });

    const u1 = await t.query(internal.users.getBySupabaseId, { supabaseId: "u1" });
    const u2 = await t.query(internal.users.getBySupabaseId, { supabaseId: "u2" });
    expect(u1?.isAdmin).toBe(false);
    expect(u2?.isAdmin).toBe(true);
  });

  it("grants admin to OWNER emails even with ADMIN_SEED_EMAILS unset", async () => {
    delete process.env.ADMIN_SEED_EMAILS;
    const t = convexTest(schema, modules);
    // Owner emails are always admin (case-insensitive), independent of the env.
    await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "owner1", email: "zufairyk@gmail.com" });
    await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "owner2", email: "PrimalIQLabs@Gmail.com" });
    await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "rando", email: "rando@x.com" });

    expect((await t.query(internal.users.getBySupabaseId, { supabaseId: "owner1" }))?.isAdmin).toBe(true);
    expect((await t.query(internal.users.getBySupabaseId, { supabaseId: "owner2" }))?.isAdmin).toBe(true);
    expect((await t.query(internal.users.getBySupabaseId, { supabaseId: "rando" }))?.isAdmin).toBe(false);
  });

  it("promotes an EXISTING owner account on next sign-in (re-check, not just insert)", async () => {
    delete process.env.ADMIN_SEED_EMAILS;
    const t = convexTest(schema, modules);
    // Simulate a pre-existing non-admin row (created before the owner floor existed).
    const id = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "o", email: "primaliqlabs@gmail.com" });
    // First insert already grants it here; force it false to mimic a legacy row, then
    // re-run the upsert (a fresh sign-in) and confirm it flips back to admin.
    await t.run(async (ctx: any) => { await ctx.db.patch(id, { isAdmin: false }); });
    await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "o", email: "primaliqlabs@gmail.com" });
    expect((await t.query(internal.users.getBySupabaseId, { supabaseId: "o" }))?.isAdmin).toBe(true);
  });

  it("is idempotent for a returning user", async () => {
    const t = convexTest(schema, modules);
    const id1 = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u1", email: "1@x.com" });
    const id2 = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u1", name: "Renamed" });
    expect(id1).toBe(id2);
    const u = await t.query(internal.users.getBySupabaseId, { supabaseId: "u1" });
    expect(u?.name).toBe("Renamed");
  });
});

describe("linkWalletInternal", () => {
  it("links a wallet and rejects one already owned by another account", async () => {
    const t = convexTest(schema, modules);
    const u1 = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u1" });
    const u2 = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u2" });

    await t.mutation(internal.users.linkWalletInternal, { userId: u1, walletAddress: "WALLET_A", walletType: "external" });
    const linked = await t.query(internal.users.getBySupabaseId, { supabaseId: "u1" });
    expect(linked?.walletAddress).toBe("WALLET_A");

    await expect(
      t.mutation(internal.users.linkWalletInternal, { userId: u2, walletAddress: "WALLET_A", walletType: "external" }),
    ).rejects.toThrow(/already linked/i);
  });

  it("links MULTIPLE wallets to one account and lists them all", async () => {
    const t = convexTest(schema, modules);
    const u1 = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u1" });

    await t.mutation(internal.users.linkWalletInternal, { userId: u1, walletAddress: "WALLET_A", walletType: "external" });
    await t.mutation(internal.users.linkWalletInternal, { userId: u1, walletAddress: "WALLET_B", walletType: "external" });

    const wallets = await t.query(internal.users.listWalletsInternal, { userId: u1 });
    expect(wallets).toContain("WALLET_A");
    expect(wallets).toContain("WALLET_B");
    expect(wallets).toHaveLength(2);

    // The most-recently-linked wallet is the active/primary one.
    const u = await t.query(internal.users.getBySupabaseId, { supabaseId: "u1" });
    expect(u?.walletAddress).toBe("WALLET_B");
  });

  it("unlinks one wallet while keeping the rest, repromoting primary", async () => {
    const t = convexTest(schema, modules);
    const u1 = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u1" });
    await t.mutation(internal.users.linkWalletInternal, { userId: u1, walletAddress: "WALLET_A", walletType: "external" });
    await t.mutation(internal.users.linkWalletInternal, { userId: u1, walletAddress: "WALLET_B", walletType: "external" });

    // Unlink the active primary (WALLET_B) → WALLET_A should remain & become primary.
    await t.mutation(internal.users.unlinkWalletInternal, { userId: u1, walletAddress: "WALLET_B" });
    const wallets = await t.query(internal.users.listWalletsInternal, { userId: u1 });
    expect(wallets).toEqual(["WALLET_A"]);
    const u = await t.query(internal.users.getBySupabaseId, { supabaseId: "u1" });
    expect(u?.walletAddress).toBe("WALLET_A");
  });

  it("frees a wallet after unlink so another account can claim it", async () => {
    const t = convexTest(schema, modules);
    const u1 = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u1" });
    const u2 = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u2" });
    await t.mutation(internal.users.linkWalletInternal, { userId: u1, walletAddress: "WALLET_A", walletType: "external" });
    await t.mutation(internal.users.unlinkWalletInternal, { userId: u1, walletAddress: "WALLET_A" });

    // Now u2 can link it without the "already linked" guard firing.
    await t.mutation(internal.users.linkWalletInternal, { userId: u2, walletAddress: "WALLET_A", walletType: "external" });
    const wallets = await t.query(internal.users.listWalletsInternal, { userId: u2 });
    expect(wallets).toContain("WALLET_A");
  });
});

describe("admin mutations (internal db ops)", () => {
  it("setUserFlagsData toggles admin + status", async () => {
    const t = convexTest(schema, modules);
    const u = await t.mutation(internal.users.upsertFromSupabase, { supabaseId: "u1" });
    await t.mutation(internal.admin.setUserFlagsData, { userId: u, status: "suspended" });
    const after = await t.query(internal.users.getBySupabaseId, { supabaseId: "u1" });
    expect(after?.status).toBe("suspended");
  });
});
