/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, afterEach, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "test-internal-cron-secret-distributions";
const MINT = "Mint1111111111111111111111111111111111111";

const baseRow = {
  mintAddress: MINT,
  totalPayoutUsdc: 100,
  investorUsdc: 100,
  builderUsdc: 0,
  protocolUsdc: 0,
  splits: [],
  status: "credited",
};

describe("distributions.record — idempotency", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("dedups per submissionId when no trancheKey (v1 path unchanged)", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);

    const first = await t.mutation(api.distributions.record, {
      ...baseRow, submissionId: "sub_v1", authSecret: SECRET,
    });
    const second = await t.mutation(api.distributions.record, {
      ...baseRow, submissionId: "sub_v1", authSecret: SECRET,
    });
    expect(second).toBe(first); // same submission → same row, no-op

    const rows = await t.run((ctx) =>
      ctx.db.query("distributions").withIndex("by_submission", (q) => q.eq("submissionId", "sub_v1")).collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("records a DISTINCT row per tranche key (multi-tranche under-credit fix)", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);

    // Same submission, two tranches (cumulative net 117 then 195).
    const t1 = await t.mutation(api.distributions.record, {
      ...baseRow, submissionId: "sub_v2", trancheKey: "sub_v2:117",
      totalPayoutUsdc: 117, investorUsdc: 117, authSecret: SECRET,
    });
    const t2 = await t.mutation(api.distributions.record, {
      ...baseRow, submissionId: "sub_v2", trancheKey: "sub_v2:195",
      totalPayoutUsdc: 78, investorUsdc: 78, authSecret: SECRET,
    });
    expect(t2).not.toBe(t1); // distinct tranches → distinct rows

    const rows = await t.run((ctx) =>
      ctx.db.query("distributions").withIndex("by_submission", (q) => q.eq("submissionId", "sub_v2")).collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.totalPayoutUsdc).sort((a, b) => a - b)).toEqual([78, 117]);
  });

  it("a true re-crank of the SAME tranche stays a no-op", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);

    const first = await t.mutation(api.distributions.record, {
      ...baseRow, submissionId: "sub_v2b", trancheKey: "sub_v2b:117", authSecret: SECRET,
    });
    const dup = await t.mutation(api.distributions.record, {
      ...baseRow, submissionId: "sub_v2b", trancheKey: "sub_v2b:117", authSecret: SECRET,
    });
    expect(dup).toBe(first); // identical tranche key → same row

    const rows = await t.run((ctx) =>
      ctx.db.query("distributions").withIndex("by_tranche", (q) => q.eq("trancheKey", "sub_v2b:117")).collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("getByTranche finds the tranche row; getBySubmission returns the first", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    await t.mutation(api.distributions.record, {
      ...baseRow, submissionId: "sub_v2c", trancheKey: "sub_v2c:50", authSecret: SECRET,
    });

    const byTranche = await t.query(api.distributions.getByTranche, { trancheKey: "sub_v2c:50" });
    expect(byTranche?.trancheKey).toBe("sub_v2c:50");
    const missing = await t.query(api.distributions.getByTranche, { trancheKey: "sub_v2c:999" });
    expect(missing).toBeNull();
  });

  it("throws unauthorized without the secret", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.distributions.record, { ...baseRow, submissionId: "x", authSecret: "nope" }),
    ).rejects.toThrow(/unauthorized/);
  });
});
