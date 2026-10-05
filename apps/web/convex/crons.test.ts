/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("crons.getAgentAccountsDue", () => {
  it("returns only accounts with unsettledTabUsdc >= threshold (VELLO_SETTLE_THRESHOLD_USDC, default 0.05)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.agentAccount.create, { mintAddress: "MintDue11111111111111111111111111111111" });
    await t.mutation(internal.agentAccount.create, { mintAddress: "MintLow11111111111111111111111111111111" });
    await t.run(async (ctx) => {
      const due = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", "MintDue11111111111111111111111111111111")).unique();
      await ctx.db.patch(due!._id, { unsettledTabUsdc: 7 });
      const low = await ctx.db.query("agentAccount").withIndex("by_mint", (q) => q.eq("mintAddress", "MintLow11111111111111111111111111111111")).unique();
      await ctx.db.patch(low!._id, { unsettledTabUsdc: 0.02 }); // below the 0.05 default threshold
    });
    const res = await t.query(internal.crons.getAgentAccountsDue, {});
    const mints = res.map((r: { mintAddress: string }) => r.mintAddress);
    expect(mints).toContain("MintDue11111111111111111111111111111111");
    expect(mints).not.toContain("MintLow11111111111111111111111111111111");
  });
});

describe("crons.runDueOracle — failure observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("warns with the status code on a non-2xx response and returns {ok:false}", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = convexTest(schema, modules);

    const res = await t.action(internal.crons.runDueOracle, {});

    expect(res).toEqual({ ok: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("401");
  });

  it("warns 'unreachable' on a network error and returns {ok:false}", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = convexTest(schema, modules);

    const res = await t.action(internal.crons.runDueOracle, {});

    expect(res).toEqual({ ok: false });
    // appFetch narrates its own "trying next origin" line before giving up (the
    // network error is retried against the canonical origin), so assert the
    // handler's diagnosis is present rather than pinning a warn COUNT.
    expect(warn.mock.calls.some((c) => String(c[0]).includes("unreachable"))).toBe(true);
  });

  it("does NOT warn on a 2xx response and returns {ok:true}", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = convexTest(schema, modules);

    const res = await t.action(internal.crons.runDueOracle, {});

    expect(res).toEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });
});
