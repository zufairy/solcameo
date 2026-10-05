/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import { computePayoutUsdc } from "./campaigns";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const baseCampaign = {
  creatorWallet: "Creator11111111111111111111111111111111111",
  brandName: "Acme",
  brandLogoUrl: "https://example.com/logo.svg",
  title: "Launch clip campaign",
  brief: "Make a clip",
  budget: 1000,
  ratePerThousandViews: 5,
  targetNiche: ["tech"],
  targetLanguage: ["en"],
  status: "open",
  submissionsCount: 1,
  deadline: "2026-12-31",
};

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const campaignId = await ctx.db.insert("campaigns", baseCampaign);
    const submissionId = await ctx.db.insert("submissions", {
      campaignId,
      influencerMint: "Mint1111111111111111111111111111111111111",
      influencerName: "Vello Bot",
      submitterWallet: "Submitter111111111111111111111111111111111",
      status: "pending",
    });
    return { campaignId, submissionId };
  });
}

describe("computePayoutUsdc", () => {
  it("prices at rate per thousand views", () => {
    // 50,000 views @ $5/1k = $250
    expect(computePayoutUsdc(50_000, 5, 1000)).toBe(250);
  });

  it("clamps to remaining budget", () => {
    // 50,000 views @ $5/1k = $250, but budget only 100
    expect(computePayoutUsdc(50_000, 5, 100)).toBe(100);
  });

  it("is zero with no views or no rate", () => {
    expect(computePayoutUsdc(0, 5, 1000)).toBe(0);
    expect(computePayoutUsdc(50_000, 0, 1000)).toBe(0);
  });

  it("caps a single submission at maxPayoutUsdc (marketing per-submission cap)", () => {
    // 50,000 views @ $5/1k = $250, but the per-submission cap is $50.
    expect(computePayoutUsdc(50_000, 5, 1000, 50)).toBe(50);
    // Under the cap → unaffected.
    expect(computePayoutUsdc(2_000, 5, 1000, 50)).toBe(10);
    // Cap binds BEFORE the budget clamp, and budget still clamps below the cap.
    expect(computePayoutUsdc(50_000, 5, 30, 50)).toBe(30);
    // 0 / undefined cap → no cap.
    expect(computePayoutUsdc(50_000, 5, 1000, 0)).toBe(250);
    expect(computePayoutUsdc(50_000, 5, 1000, undefined)).toBe(250);
  });

  it("keeps exact USDC values (integer base units) unchanged", () => {
    // 1500 views @ $5/1k = $7.5 — exact at 6dp, floor is a no-op.
    expect(computePayoutUsdc(1500, 5, 1000)).toBe(7.5);
  });

  it("FLOORS to USDC precision (truncates, never rounds up) to match on-chain", () => {
    // 333 views @ $1/1k = 0.333 exactly — within 6dp, unchanged.
    expect(computePayoutUsdc(333, 1, 1000)).toBe(0.333);
    // 1 view @ $1/1k = 0.001 — exact.
    expect(computePayoutUsdc(1, 1, 1000)).toBe(0.001);
    // 1500 views @ $0.001/1k = 0.0015 → exact at 6dp.
    expect(computePayoutUsdc(1500, 0.001, 1000)).toBeCloseTo(0.0015, 9);
    // Round-vs-floor divergence. raw = (1/1000)*0.0015 = 0.0000015 → ×1e6 = 1.5
    // base units. Round → 2 base units (0.000002, promises MORE than the chain
    // pays); floor → 1 base unit (0.000001). The chain truncates, so we MUST
    // floor.
    expect(computePayoutUsdc(1, 0.0015, 1000)).toBe(0.000001);
    // raw = (1/1000)*0.0019 = 0.0000019 → ×1e6 = 1.9 → floor → 0.000001
    // (round would give 0.000002).
    expect(computePayoutUsdc(1, 0.0019, 1000)).toBe(0.000001);
  });
});

describe("campaigns.markVerified", () => {
  it("approves: sets verified status, view count, and payout", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    const res = await t.mutation(internal.campaigns.markVerified, {
      submissionId,
      decision: "approved",
      viewCount: 40_000,
      scoreHash: "abc123",
      attestationTx: "TxSig111",
    });

    expect(res).toMatchObject({
      alreadyProcessed: false,
      status: "verified",
      payoutAmountUsdc: 200, // 40k @ $5/1k
    });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub).toMatchObject({
      status: "verified",
      verificationDecision: "approved",
      viewCount: 40_000,
      scoreHash: "abc123",
      attestationTx: "TxSig111",
      payoutAmountUsdc: 200,
    });
    expect(sub?.verifiedAt).toBeTypeOf("number");
  });

  it("rejects: sets rejected status and no payout", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    const res = await t.mutation(internal.campaigns.markVerified, {
      submissionId,
      decision: "rejected",
      viewCount: 40_000,
    });

    expect(res).toMatchObject({ status: "rejected", payoutAmountUsdc: 0 });
    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.status).toBe("rejected");
    expect(sub?.payoutAmountUsdc).toBeUndefined();
  });

  it("is idempotent on retries", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    const args = {
      submissionId,
      decision: "approved" as const,
      viewCount: 40_000,
    };
    const first = await t.mutation(internal.campaigns.markVerified, args);
    const second = await t.mutation(internal.campaigns.markVerified, {
      ...args,
      viewCount: 999_999, // would change payout if reprocessed
    });

    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.payoutAmountUsdc).toBe(200); // unchanged from first

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.viewCount).toBe(40_000);
  });

  it("throws on unknown submission", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);
    // Delete it, then reference the now-stale id.
    await t.run((ctx) => ctx.db.delete(submissionId));

    await expect(
      t.mutation(internal.campaigns.markVerified, {
        submissionId,
        decision: "approved",
        viewCount: 1000,
      }),
    ).rejects.toThrow(/Submission not found/);
  });
});

describe("campaigns.markVerified — budget clamping across many submissions", () => {
  it("never pays out more than the campaign budget in total", async () => {
    const t = convexTest(schema, modules);

    // One campaign: budget 1000, $5/1k views. Each approval below earns
    // 50k @ $5/1k = $250 raw — so 10 unclamped would total $2500 (2.5x budget).
    const campaignId = await t.run((ctx) =>
      ctx.db.insert("campaigns", { ...baseCampaign, budget: 1000, ratePerThousandViews: 5 }),
    );

    const submissionIds = await t.run(async (ctx) => {
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(
          await ctx.db.insert("submissions", {
            campaignId,
            // Distinct mint per submission so distributions stay independent.
            influencerMint: `Mint${String(i).padStart(38, "0")}`,
            influencerName: "Vello Bot",
            submitterWallet: "Submitter111111111111111111111111111111111",
            status: "submitted",
          }),
        );
      }
      return ids;
    });

    let total = 0;
    const payouts: number[] = [];
    for (const submissionId of submissionIds) {
      const res = await t.mutation(internal.campaigns.markVerified, {
        submissionId: submissionId as any,
        decision: "approved",
        viewCount: 50_000,
      });
      if (typeof res.payoutAmountUsdc !== "number") throw new Error(`markVerified skipped: ${JSON.stringify(res)}`);
      payouts.push(res.payoutAmountUsdc);
      total += res.payoutAmountUsdc;

      // Invariant: spentUsdc tracks the running total and never exceeds budget.
      const c = await t.run((ctx) => ctx.db.get(campaignId));
      expect(c?.spentUsdc ?? 0).toBeCloseTo(total, 6);
      expect(c?.spentUsdc ?? 0).toBeLessThanOrEqual(1000);
    }

    // SUM of all payouts is clamped to the budget — NOT 10 * 250 = 2500.
    expect(total).toBeCloseTo(1000, 6);

    // Campaign records the full spend, never over budget.
    const finalCampaign = await t.run((ctx) => ctx.db.get(campaignId));
    expect(finalCampaign?.spentUsdc).toBeCloseTo(1000, 6);
    expect(finalCampaign?.spentUsdc ?? 0).toBeLessThanOrEqual(1000);

    // First four exhaust the budget (250*4 = 1000); the rest get 0.
    expect(payouts.slice(0, 4)).toEqual([250, 250, 250, 250]);
    expect(payouts.slice(4)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("campaigns.markVerified — onchainVersion gate (v1 dispatches, v2 is a pure mirror)", () => {
  /** Pending scheduled `distributions.dispatch` jobs after a markVerified call. */
  async function scheduledDispatches(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      // The scheduled function's name is the module path to dispatch.
      return jobs.filter((j) => j.name.includes("distributions") && j.name.includes("dispatch"));
    });
  }

  async function seedVersioned(
    t: ReturnType<typeof convexTest>,
    onchainVersion: number | undefined,
  ) {
    return await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert("campaigns", {
        ...baseCampaign,
        ...(onchainVersion !== undefined ? { onchainVersion } : {}),
      });
      const submissionId = await ctx.db.insert("submissions", {
        campaignId,
        influencerMint: "Mint1111111111111111111111111111111111111",
        influencerName: "Vello Bot",
        submitterWallet: "Submitter111111111111111111111111111111111",
        status: "submitted",
      });
      return { campaignId, submissionId };
    });
  }

  it("v1 (onchainVersion undefined): approves + schedules distributions.dispatch (legacy, unchanged)", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seedVersioned(t, undefined);

    const res = await t.mutation(internal.campaigns.markVerified, {
      submissionId,
      decision: "approved",
      viewCount: 40_000,
      attestationTx: "TxSig111",
    });
    expect(res).toMatchObject({ status: "verified", payoutAmountUsdc: 200 });

    const dispatches = await scheduledDispatches(t);
    expect(dispatches).toHaveLength(1);

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub).toMatchObject({ status: "verified", verificationDecision: "approved", payoutAmountUsdc: 200 });
  });

  it("v1 (onchainVersion === 1): still schedules dispatch", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seedVersioned(t, 1);

    await t.mutation(internal.campaigns.markVerified, {
      submissionId,
      decision: "approved",
      viewCount: 40_000,
    });
    expect(await scheduledDispatches(t)).toHaveLength(1);
  });

  it("v2 (onchainVersion === 2): mirrors the submission but DOES NOT schedule dispatch", async () => {
    const t = convexTest(schema, modules);
    const { submissionId, campaignId } = await seedVersioned(t, 2);

    const res = await t.mutation(internal.campaigns.markVerified, {
      submissionId,
      decision: "approved",
      viewCount: 40_000,
      scoreHash: "abc123",
      attestationTx: "OnChainSig222",
    });

    // Mirror still records the verified state + payout estimate + attestation.
    expect(res).toMatchObject({ status: "verified", payoutAmountUsdc: 200 });
    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub).toMatchObject({
      status: "verified",
      verificationDecision: "approved",
      viewCount: 40_000,
      scoreHash: "abc123",
      attestationTx: "OnChainSig222",
      payoutAmountUsdc: 200,
    });
    // spentUsdc mirror still decrements (mirror of on-chain reserved).
    const c = await t.run((ctx) => ctx.db.get(campaignId));
    expect(c?.spentUsdc).toBe(200);

    // The keeper pays v2 on-chain — markVerified must NOT schedule dispatch.
    expect(await scheduledDispatches(t)).toHaveLength(0);
  });

  it("v2 rejected: mirrors rejected, never schedules dispatch", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seedVersioned(t, 2);
    const res = await t.mutation(internal.campaigns.markVerified, {
      submissionId,
      decision: "rejected",
      viewCount: 40_000,
    });
    expect(res).toMatchObject({ status: "rejected", payoutAmountUsdc: 0 });
    expect(await scheduledDispatches(t)).toHaveLength(0);
  });

  // viaWebhook gate: the /oracle/attestation webhook must NOT settle a v2 (on-chain)
  // submission — the oracle worker owns that rail (it carries the real on-chain
  // attestationTx). The worker path (no viaWebhook) still settles v2; v1 webhook
  // settles as before.
  it("v2 + viaWebhook: NO-OP skip (does not mutate the submission)", async () => {
    const t = convexTest(schema, modules);
    const { submissionId, campaignId } = await seedVersioned(t, 2);

    const res = await t.mutation(internal.campaigns.markVerified, {
      submissionId,
      decision: "approved",
      viewCount: 40_000,
      attestationTx: "WebhookSig",
      viaWebhook: true,
    });

    // Returns the skip sentinel, never settles.
    expect(res).toMatchObject({ ok: false, skipped: "v2 handled by oracle worker" });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.status).toBe("submitted"); // unchanged
    expect(sub?.verificationDecision).toBeUndefined();
    expect(sub?.payoutAmountUsdc).toBeUndefined();
    expect(sub?.attestationTx).toBeUndefined();
    // spentUsdc mirror untouched.
    const c = await t.run((ctx) => ctx.db.get(campaignId));
    expect(c?.spentUsdc ?? 0).toBe(0);
    // And nothing dispatched.
    expect(await scheduledDispatches(t)).toHaveLength(0);
  });

  it("v1 + viaWebhook: settles as before (still dispatches)", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seedVersioned(t, undefined);

    const res = await t.mutation(internal.campaigns.markVerified, {
      submissionId,
      decision: "approved",
      viewCount: 40_000,
      attestationTx: "WebhookSig",
      viaWebhook: true,
    });
    expect(res).toMatchObject({ status: "verified", payoutAmountUsdc: 200 });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub).toMatchObject({
      status: "verified",
      verificationDecision: "approved",
      payoutAmountUsdc: 200,
    });
    // v1 still pays via the off-chain dispatch.
    expect(await scheduledDispatches(t)).toHaveLength(1);
  });

  it("v2 via worker (no viaWebhook): settles the on-chain mirror as before", async () => {
    const t = convexTest(schema, modules);
    const { submissionId, campaignId } = await seedVersioned(t, 2);

    const res = await t.mutation(internal.campaigns.markVerified, {
      submissionId,
      decision: "approved",
      viewCount: 40_000,
      attestationTx: "OnChainSig",
      // viaWebhook intentionally omitted — this is the worker path.
    });
    expect(res).toMatchObject({ status: "verified", payoutAmountUsdc: 200 });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub).toMatchObject({
      status: "verified",
      verificationDecision: "approved",
      attestationTx: "OnChainSig",
      payoutAmountUsdc: 200,
    });
    const c = await t.run((ctx) => ctx.db.get(campaignId));
    expect(c?.spentUsdc).toBe(200);
    // v2 keeper pays on-chain — still no off-chain dispatch.
    expect(await scheduledDispatches(t)).toHaveLength(0);
  });
});

describe("oracle.markPaidOnchain", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws unauthorized without the secret", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);
    await expect(
      t.mutation(api.oracle.markPaidOnchain, {
        authSecret: "nope",
        submissionId,
        paidUsdc: 100,
        payoutTxSignature: "ClaimSig111",
      }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("patches paidUsdc + payoutTxSignature + claimPda on the submission", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    const res = await t.mutation(api.oracle.markPaidOnchain, {
      authSecret: SECRET,
      submissionId,
      paidUsdc: 200,
      payoutTxSignature: "ClaimSig222",
      claimPda: "ClaimPda222",
    });
    expect(res).toMatchObject({ ok: true });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.paidUsdc).toBe(200);
    expect(sub?.payoutTxSignature).toBe("ClaimSig222");
    expect(sub?.claimPda).toBe("ClaimPda222");
  });

  it("omits claimPda when not provided", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    await t.mutation(api.oracle.markPaidOnchain, {
      authSecret: SECRET,
      submissionId,
      paidUsdc: 50,
      payoutTxSignature: "ClaimSig333",
    });
    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.paidUsdc).toBe(50);
    expect(sub?.payoutTxSignature).toBe("ClaimSig333");
    expect(sub?.claimPda).toBeUndefined();
  });

  it("patches claimDone + navCreditedUsdc when provided (terminal tranche)", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    await t.mutation(api.oracle.markPaidOnchain, {
      authSecret: SECRET,
      submissionId,
      paidUsdc: 200,
      payoutTxSignature: "ClaimSigDone",
      claimDone: true,
      navCreditedUsdc: 195,
    });
    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.paidUsdc).toBe(200);
    expect(sub?.claimDone).toBe(true);
    expect(sub?.navCreditedUsdc).toBe(195);
  });

  it("never writes undefined over an existing claimDone/navCreditedUsdc (omitted args)", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    // First tick sets the mirror fields.
    await t.mutation(api.oracle.markPaidOnchain, {
      authSecret: SECRET,
      submissionId,
      paidUsdc: 100,
      payoutTxSignature: "ClaimSig1",
      navCreditedUsdc: 97,
    });
    // Second tick OMITS them (e.g. a deferred/failed credit) — must not clobber.
    await t.mutation(api.oracle.markPaidOnchain, {
      authSecret: SECRET,
      submissionId,
      paidUsdc: 100,
      payoutTxSignature: "ClaimSig2",
    });
    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.navCreditedUsdc).toBe(97); // preserved, not overwritten with undefined
    expect(sub?.claimDone).toBeUndefined(); // never set
  });

  it("returns ok:false on an unknown submission", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);
    await t.run((ctx) => ctx.db.delete(submissionId));
    const res = await t.mutation(api.oracle.markPaidOnchain, {
      authSecret: SECRET,
      submissionId,
      paidUsdc: 10,
      payoutTxSignature: "ClaimSigGone",
    });
    expect(res).toMatchObject({ ok: false });
  });
});

describe("oracle.refreshAttestation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws unauthorized without the secret", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);
    await expect(
      t.mutation(api.oracle.refreshAttestation, {
        authSecret: "nope",
        submissionId,
        attestationTx: "NewSig",
      }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("patches ONLY attestationTx (+ timestamps) and never touches decision/status/payout", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    // Seed an already-settled approved+attested row (the dueForReattest shape).
    const { submissionId } = await seed(t);
    await t.run((ctx) =>
      ctx.db.patch(submissionId, {
        status: "verified",
        verificationDecision: "approved",
        viewCount: 40_000,
        payoutAmountUsdc: 200,
        paidUsdc: 50,
        attestationTx: "OldSig",
      }),
    );

    const res = await t.mutation(api.oracle.refreshAttestation, {
      authSecret: SECRET,
      submissionId,
      attestationTx: "FreshSig",
    });
    expect(res).toMatchObject({ ok: true });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    // attestationTx advanced + a reattest timestamp written.
    expect(sub?.attestationTx).toBe("FreshSig");
    expect(sub?.lastReattestAt).toBeTypeOf("number");
    expect(sub?.verifiedAt).toBeTypeOf("number");
    // Settlement fields are UNTOUCHED — a re-attest is a pure slot refresh.
    expect(sub?.status).toBe("verified");
    expect(sub?.verificationDecision).toBe("approved");
    expect(sub?.payoutAmountUsdc).toBe(200);
    expect(sub?.paidUsdc).toBe(50);
    expect(sub?.viewCount).toBe(40_000);
  });

  it("returns ok:false on an unknown submission", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);
    await t.run((ctx) => ctx.db.delete(submissionId));
    const res = await t.mutation(api.oracle.refreshAttestation, {
      authSecret: SECRET,
      submissionId,
      attestationTx: "Sig",
    });
    expect(res).toMatchObject({ ok: false });
  });
});

describe("/oracle/attestation webhook", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects unauthorized requests", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    const res = await t.fetch("/oracle/attestation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId, decision: "approved", viewCount: 1000 }),
    });
    expect(res.status).toBe(401);
  });

  it("processes an authorized attestation", async () => {
    vi.stubEnv("ORACLE_WEBHOOK_SECRET", "shh-secret");
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    const res = await t.fetch("/oracle/attestation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-oracle-secret": "shh-secret",
      },
      body: JSON.stringify({
        submissionId,
        decision: "approved",
        viewCount: 20_000,
        scoreHash: "deadbeef",
        attestationTx: "Tx222",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, status: "verified", payoutAmountUsdc: 100 });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.status).toBe("verified");
    expect(sub?.attestationTx).toBe("Tx222");
  });

  it("400s on invalid payload", async () => {
    vi.stubEnv("ORACLE_WEBHOOK_SECRET", "shh-secret");
    const t = convexTest(schema, modules);

    const res = await t.fetch("/oracle/attestation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-oracle-secret": "shh-secret",
      },
      body: JSON.stringify({ decision: "maybe" }),
    });
    expect(res.status).toBe(400);
  });
});

const SECRET = "cron-secret-xyz";

/** Insert a campaign once; tests seed submissions against it. */
async function seedCampaign(t: ReturnType<typeof convexTest>) {
  return await t.run((ctx) => ctx.db.insert("campaigns", baseCampaign));
}

/** Insert a submission with overridable fields (status defaults to "submitted"). */
async function seedSub(
  t: ReturnType<typeof convexTest>,
  campaignId: Awaited<ReturnType<typeof seedCampaign>>,
  overrides: Record<string, unknown> = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("submissions", {
      campaignId,
      influencerMint: "Mint1111111111111111111111111111111111111",
      influencerName: "Vello Bot",
      submitterWallet: "Submitter111111111111111111111111111111111",
      status: "submitted",
      ...overrides,
    }),
  );
}

describe("submissions.dueForVerification", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws unauthorized when the secret is missing", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.submissions.dueForVerification, { authSecret: "anything" }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("throws unauthorized when the secret is wrong", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.submissions.dueForVerification, { authSecret: "nope" }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("returns only matured + has-id + unsettled submitted rows", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);

    const now = 10_000_000_000;
    const hour = 3_600_000;

    // INCLUDED: submitted, has platformPostId, posted > 1h ago.
    const included = await seedSub(t, campaignId, {
      status: "submitted",
      platformPostId: "tt_123",
      postedAt: now - 2 * hour,
    });

    // EXCLUDED: already settled by the oracle (verificationDecision set).
    await seedSub(t, campaignId, {
      status: "verified",
      verificationDecision: "approved",
      platformPostId: "tt_settled",
      postedAt: now - 2 * hour,
    });

    // EXCLUDED: no measurable post id.
    await seedSub(t, campaignId, {
      status: "submitted",
      postUrl: "https://t.co/noid",
      postedAt: now - 2 * hour,
    });

    // EXCLUDED: too recent (within the maturation window).
    await seedSub(t, campaignId, {
      status: "submitted",
      platformPostId: "tt_recent",
      postedAt: now - 5 * 60_000, // 5 min ago, inside 1h window
    });

    // EXCLUDED: pending status (not "submitted").
    await seedSub(t, campaignId, {
      status: "pending",
      platformPostId: "tt_pending",
      postedAt: now - 2 * hour,
    });

    // EXCLUDED: failed status.
    await seedSub(t, campaignId, {
      status: "failed",
      platformPostId: "tt_failed",
      postedAt: now - 2 * hour,
    });

    const due = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: hour,
      nowMs: now,
    });

    expect(due.map((d) => d._id)).toEqual([included]);
  });

  it("treats uploadPostRequestId as a measurable id", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);
    const now = 10_000_000_000;

    const id = await seedSub(t, campaignId, {
      status: "submitted",
      uploadPostRequestId: "req_abc",
      postedAt: now - 7_200_000,
    });

    const due = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: 3_600_000,
      nowMs: now,
    });
    expect(due.map((d) => d._id)).toEqual([id]);
  });

  it("falls back to _creationTime when postedAt is absent", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);

    // No postedAt — its _creationTime (now) is well before a far-future nowMs.
    const id = await seedSub(t, campaignId, {
      status: "submitted",
      platformPostId: "tt_nopostedat",
    });

    const due = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: 3_600_000,
      nowMs: Date.now() + 86_400_000, // a day from now → matured
    });
    expect(due.map((d) => d._id)).toEqual([id]);
  });

  it("respects the limit", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);
    const now = 10_000_000_000;

    for (let i = 0; i < 5; i++) {
      await seedSub(t, campaignId, {
        status: "submitted",
        platformPostId: `tt_${i}`,
        postedAt: now - 7_200_000,
      });
    }

    const due = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: 3_600_000,
      nowMs: now,
      limit: 2,
    });
    expect(due).toHaveLength(2);
  });

  it("returns a measurable row even when >500 stuck postUrl-only rows precede it", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);
    const now = 10_000_000_000;
    const hour = 3_600_000;

    // 500 matured "submitted" rows with ONLY a postUrl (no measurable id) — these
    // are permanently stuck and never settle. Seeded FIRST so they sort oldest.
    await t.run(async (ctx) => {
      for (let i = 0; i < 500; i++) {
        await ctx.db.insert("submissions", {
          campaignId,
          influencerMint: "Mint1111111111111111111111111111111111111",
          influencerName: "Vello Bot",
          submitterWallet: "Submitter111111111111111111111111111111111",
          status: "submitted",
          postUrl: `https://t.co/stuck${i}`,
          postedAt: now - 2 * hour,
        });
      }
    });

    // ONE measurable matured row inserted AFTER the 500 stuck rows (index > 500).
    const measurable = await seedSub(t, campaignId, {
      status: "submitted",
      platformPostId: "tt_measurable",
      postedAt: now - 2 * hour,
    });

    const due = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: hour,
      nowMs: now,
    });

    expect(due.map((d) => d._id)).toEqual([measurable]);
  });

  it("carries the shape the oracle route needs", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);
    const now = 10_000_000_000;

    const id = await seedSub(t, campaignId, {
      status: "submitted",
      platform: "tiktok",
      postUrl: "https://tiktok.com/@a/video/1",
      platformPostId: "tt_777",
      uploadPostRequestId: "req_777",
      postedAt: now - 7_200_000,
    });

    const [row] = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: 3_600_000,
      nowMs: now,
    });

    expect(row).toMatchObject({
      _id: id,
      campaignId,
      influencerMint: "Mint1111111111111111111111111111111111111",
      submitterWallet: "Submitter111111111111111111111111111111111",
      platform: "tiktok",
      postUrl: "https://tiktok.com/@a/video/1",
      platformPostId: "tt_777",
      uploadPostRequestId: "req_777",
      postedAt: now - 7_200_000,
    });
    expect(row.creationTimeMs).toBeTypeOf("number");
  });
});

describe("oracle.settleFromOracle", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws unauthorized without the secret", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);
    await expect(
      t.mutation(api.oracle.settleFromOracle, {
        authSecret: "nope",
        submissionId,
        decision: "approved",
        viewCount: 1000,
      }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("settles an approved submission and is idempotent on retry", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    const first = await t.mutation(api.oracle.settleFromOracle, {
      authSecret: SECRET,
      submissionId,
      decision: "approved",
      viewCount: 40_000,
      scoreHash: "abc123",
      attestationTx: "TxSig111",
    });
    expect(first).toMatchObject({
      alreadyProcessed: false,
      status: "verified",
      payoutAmountUsdc: 200, // 40k @ $5/1k
    });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub).toMatchObject({
      status: "verified",
      verificationDecision: "approved",
      viewCount: 40_000,
      scoreHash: "abc123",
      attestationTx: "TxSig111",
      payoutAmountUsdc: 200,
    });

    // Second call with a different viewCount must NOT reprocess.
    const second = await t.mutation(api.oracle.settleFromOracle, {
      authSecret: SECRET,
      submissionId,
      decision: "approved",
      viewCount: 999_999,
    });
    expect(second).toMatchObject({ alreadyProcessed: true, payoutAmountUsdc: 200 });
    const after = await t.run((ctx) => ctx.db.get(submissionId));
    expect(after?.viewCount).toBe(40_000);
  });

  it("persists softFlags as reviewFlags on an approved settlement", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    const res = await t.mutation(api.oracle.settleFromOracle, {
      authSecret: SECRET,
      submissionId,
      decision: "approved",
      viewCount: 40_000,
      softFlags: ["engagement:low_ratio"],
    });
    expect(res).toMatchObject({ status: "verified" });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.status).toBe("verified");
    expect(sub?.reviewFlags).toEqual(["engagement:low_ratio"]);
  });

  it("persists the oracle-resolved postUrl + platformPostId (per-post View link), never clobbering a good value with empty", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    // First settle carries the resolved permalink + native id from analytics.
    await t.mutation(api.oracle.settleFromOracle, {
      authSecret: SECRET,
      submissionId,
      decision: "approved",
      viewCount: 40_000,
      postUrl: "https://tiktok.com/@x/video/42",
      platformPostId: "tt_42",
    });
    let sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.postUrl).toBe("https://tiktok.com/@x/video/42");
    expect(sub?.platformPostId).toBe("tt_42");

    // A later measurement that resolved NO link must NOT wipe the stored one.
    await t.mutation(api.oracle.settleFromOracle, {
      authSecret: SECRET,
      submissionId,
      decision: "approved",
      viewCount: 50_000,
      postUrl: "",
      platformPostId: "",
    });
    sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.postUrl).toBe("https://tiktok.com/@x/video/42"); // preserved
    expect(sub?.platformPostId).toBe("tt_42"); // preserved
  });
});

describe("oracle.markForReview", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws unauthorized without the secret", async () => {
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);
    await expect(
      t.mutation(api.oracle.markForReview, {
        authSecret: "nope",
        submissionId,
        reason: "facebook reach is a proxy metric",
      }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("sets needs_review status + reviewReason", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);
    const submissionId = await seedSub(t, campaignId, { status: "submitted" });

    const res = await t.mutation(api.oracle.markForReview, {
      authSecret: SECRET,
      submissionId,
      reason: "facebook reach is a proxy metric",
    });
    expect(res).toMatchObject({ ok: true });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.status).toBe("needs_review");
    expect(sub?.reviewReason).toBe("facebook reach is a proxy metric");
  });

  it("is idempotent — does not re-mark an already needs_review row", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);
    const submissionId = await seedSub(t, campaignId, { status: "submitted" });

    await t.mutation(api.oracle.markForReview, {
      authSecret: SECRET,
      submissionId,
      reason: "first reason",
    });
    const second = await t.mutation(api.oracle.markForReview, {
      authSecret: SECRET,
      submissionId,
      reason: "second reason",
    });
    expect(second).toMatchObject({ ok: true, alreadyMarked: true });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    // The first reason survives — a re-mark never overrides.
    expect(sub?.reviewReason).toBe("first reason");
  });

  it("never overrides an already-settled (verified/rejected) row", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);

    // Settle it first (verified).
    await t.mutation(api.oracle.settleFromOracle, {
      authSecret: SECRET,
      submissionId,
      decision: "approved",
      viewCount: 40_000,
    });

    const res = await t.mutation(api.oracle.markForReview, {
      authSecret: SECRET,
      submissionId,
      reason: "too late",
    });
    expect(res).toMatchObject({ ok: true, alreadyMarked: true });

    const sub = await t.run((ctx) => ctx.db.get(submissionId));
    expect(sub?.status).toBe("verified");
    expect(sub?.reviewReason).toBeUndefined();
  });

  it("returns ok:false on an unknown submission", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const { submissionId } = await seed(t);
    await t.run((ctx) => ctx.db.delete(submissionId));

    const res = await t.mutation(api.oracle.markForReview, {
      authSecret: SECRET,
      submissionId,
    });
    expect(res).toMatchObject({ ok: false });
  });

  it("removes the row from dueForVerification once marked", async () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", SECRET);
    const t = convexTest(schema, modules);
    const campaignId = await seedCampaign(t);
    const now = 10_000_000_000;
    const hour = 3_600_000;

    const submissionId = await seedSub(t, campaignId, {
      status: "submitted",
      platformPostId: "tt_review",
      postedAt: now - 2 * hour,
    });

    // It's due before marking.
    const before = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: hour,
      nowMs: now,
    });
    expect(before.map((d) => d._id)).toContain(submissionId);

    await t.mutation(api.oracle.markForReview, {
      authSecret: SECRET,
      submissionId,
      reason: "unsupported platform",
    });

    // It has left the "submitted" scan — no longer due.
    const after = await t.query(api.submissions.dueForVerification, {
      authSecret: SECRET,
      windowMs: hour,
      nowMs: now,
    });
    expect(after.map((d) => d._id)).not.toContain(submissionId);
  });
});
