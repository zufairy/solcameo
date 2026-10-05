import { describe, expect, it } from "vitest";
import {
  CLIPPING_FR_ORIGIN,
  CLIPPING_FR_DURATION_MS,
  contentRewardAmountToUsdc,
  clippingFrFundingRefusal,
  resolveMirrorAmounts,
  resolveMirrorDeadline,
  extractSourceLinks,
  buildClippingFrCreateArgs,
  planClippingFrMirror,
  runClippingFrMirror,
  type ClippingRewardSource,
  type MirrorCampaignRow,
  type MirrorOps,
  type MirrorPlanItem,
} from "./clippingFr";

const NOW = Date.UTC(2026, 6, 2, 12, 0, 0); // 2026-07-02T12:00Z

const reward = (over: Partial<ClippingRewardSource> = {}): ClippingRewardSource => ({
  id: "cr-1",
  campaign_name: "MrBeast Clips",
  type: "clipping",
  budget: 5000,
  currency: "MYR",
  reward_rate: 8,
  platforms: ["tiktok", "youtube"],
  thumbnail_url: "https://cdn.example.com/thumb.png",
  available_content: "Clip these https://youtu.be/abc123 and https://drive.google.com/file/d/xyz view",
  content_requirements: ["Min 15 seconds", "Keep the hook"],
  communityName: "Ryze",
  ownerName: "Owner Guy",
  status: "active",
  ...over,
});

const row = (over: Partial<MirrorCampaignRow> = {}): MirrorCampaignRow => ({
  _id: "camp-1",
  contentRewardId: "cr-1",
  origin: CLIPPING_FR_ORIGIN,
  pdaAddress: undefined,
  onchainVersion: undefined,
  budget: 50,
  ratePerThousandViews: 0.08,
  deadline: new Date(NOW + CLIPPING_FR_DURATION_MS).toISOString(),
  ...over,
});

describe("contentRewardAmountToUsdc", () => {
  it("converts MYR at the RM100 → 1 USDC scale (boss examples)", () => {
    expect(contentRewardAmountToUsdc(5000, "MYR")).toBe(50);
    expect(contentRewardAmountToUsdc(4300, "MYR")).toBe(43);
  });

  it("keeps sub-USDC precision without float dust", () => {
    expect(contentRewardAmountToUsdc(4321, "MYR")).toBe(43.21);
    expect(contentRewardAmountToUsdc(430, "MYR")).toBe(4.3);
    expect(contentRewardAmountToUsdc(8, "MYR")).toBe(0.08);
  });

  it("treats a missing currency as MYR (jobtepi default)", () => {
    expect(contentRewardAmountToUsdc(5000, undefined)).toBe(50);
  });

  it("passes USD/USDC through 1:1", () => {
    expect(contentRewardAmountToUsdc(25, "USD")).toBe(25);
    expect(contentRewardAmountToUsdc(10, "usdc")).toBe(10);
  });

  it("clamps junk to 0", () => {
    expect(contentRewardAmountToUsdc(0, "MYR")).toBe(0);
    expect(contentRewardAmountToUsdc(-5, "MYR")).toBe(0);
    expect(contentRewardAmountToUsdc(Number.NaN, "MYR")).toBe(0);
  });
});

describe("clippingFrFundingRefusal (RUST-4)", () => {
  it("allows a payable vault (budget > 0 AND rate > 0)", () => {
    expect(clippingFrFundingRefusal(50, 0.08)).toBeNull();
  });

  it("refuses a 0 (or null/negative/NaN) per-1k rate — the vault would pay nothing", () => {
    expect(clippingFrFundingRefusal(50, 0)).toMatch(/rate 0/i);
    expect(clippingFrFundingRefusal(50, null)).toMatch(/rate 0/i);
    expect(clippingFrFundingRefusal(50, -1)).toMatch(/rate 0/i);
    expect(clippingFrFundingRefusal(50, Number.NaN)).toMatch(/rate 0/i);
  });

  it("refuses a 0 budget even when the rate is positive", () => {
    expect(clippingFrFundingRefusal(0, 0.08)).toMatch(/budget 0/i);
    expect(clippingFrFundingRefusal(null, 0.08)).toMatch(/budget 0/i);
  });
});

describe("resolveMirrorAmounts (per-campaign manual override)", () => {
  const auto = { budgetUsdc: 50, ratePerThousandViews: 0.08 };

  it("keeps the RM→USDC auto values when there is no override", () => {
    expect(resolveMirrorAmounts(auto)).toEqual({ budgetUsdc: 50, ratePerThousandViews: 0.08, overridden: false });
    expect(resolveMirrorAmounts(auto, null)).toMatchObject({ budgetUsdc: 50, ratePerThousandViews: 0.08, overridden: false });
    expect(resolveMirrorAmounts(auto, {})).toMatchObject({ budgetUsdc: 50, ratePerThousandViews: 0.08, overridden: false });
  });

  it("lets an override REPLACE the auto deposit and rate", () => {
    expect(resolveMirrorAmounts(auto, { budgetUsdc: 30, ratePerThousandViews: 0.1 })).toEqual({
      budgetUsdc: 30,
      ratePerThousandViews: 0.1,
      overridden: true,
    });
  });

  it("overrides each field independently (the other keeps auto)", () => {
    expect(resolveMirrorAmounts(auto, { budgetUsdc: 30 })).toMatchObject({ budgetUsdc: 30, ratePerThousandViews: 0.08, overridden: true });
    expect(resolveMirrorAmounts(auto, { ratePerThousandViews: 0.2 })).toMatchObject({ budgetUsdc: 50, ratePerThousandViews: 0.2, overridden: true });
  });

  it("keeps auto for a null/undefined/non-finite field (a blank box never overrides)", () => {
    expect(resolveMirrorAmounts(auto, { budgetUsdc: null, ratePerThousandViews: undefined })).toMatchObject({
      budgetUsdc: 50,
      ratePerThousandViews: 0.08,
      overridden: false,
    });
    expect(resolveMirrorAmounts(auto, { budgetUsdc: Number.NaN })).toMatchObject({ budgetUsdc: 50, overridden: false });
  });

  it("marks NOT overridden when the override equals the auto value", () => {
    expect(resolveMirrorAmounts(auto, { budgetUsdc: 50, ratePerThousandViews: 0.08 }).overridden).toBe(false);
  });

  it("passes a ≤0 override THROUGH (not reverted to auto) so the funding guard can reject it", () => {
    const zero = resolveMirrorAmounts(auto, { budgetUsdc: 0, ratePerThousandViews: 0.08 });
    expect(zero.budgetUsdc).toBe(0);
    expect(clippingFrFundingRefusal(zero.budgetUsdc, zero.ratePerThousandViews)).toMatch(/budget 0/i);

    const negRate = resolveMirrorAmounts(auto, { budgetUsdc: 30, ratePerThousandViews: -1 });
    expect(negRate.ratePerThousandViews).toBe(-1);
    expect(clippingFrFundingRefusal(negRate.budgetUsdc, negRate.ratePerThousandViews)).toMatch(/rate 0/i);
  });
});

describe("resolveMirrorDeadline (per-campaign deadline override)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const auto = new Date(NOW + CLIPPING_FR_DURATION_MS).toISOString();

  it("keeps the auto 180d deadline when there is no override", () => {
    expect(resolveMirrorDeadline(auto, undefined, NOW)).toEqual({ deadline: auto, overridden: false, error: null });
    expect(resolveMirrorDeadline(auto, null, NOW)).toMatchObject({ deadline: auto, overridden: false, error: null });
    expect(resolveMirrorDeadline(auto, {}, NOW)).toMatchObject({ deadline: auto, overridden: false, error: null });
  });

  it("uses an in-window override (replaces the 180d default)", () => {
    const ms = NOW + 30 * DAY;
    expect(resolveMirrorDeadline(auto, { overrideDeadlineMs: ms }, NOW)).toEqual({
      deadline: new Date(ms).toISOString(),
      overridden: true,
      error: null,
    });
  });

  it("flags an override past the on-chain 365d maximum", () => {
    const ms = NOW + 400 * DAY;
    const res = resolveMirrorDeadline(auto, { overrideDeadlineMs: ms }, NOW);
    expect(res.deadline).toBe(new Date(ms).toISOString());
    expect(res.overridden).toBe(true);
    expect(res.error).toMatch(/1 year|maximum/i);
  });

  it("flags an override under the on-chain 6h minimum", () => {
    const ms = NOW + 60 * 60 * 1000; // 1h < 6h
    expect(resolveMirrorDeadline(auto, { overrideDeadlineMs: ms }, NOW).error).toMatch(/6 hours|minimum/i);
  });

  it("keeps auto for a null/undefined/non-finite override (a blank box never overrides)", () => {
    expect(resolveMirrorDeadline(auto, { overrideDeadlineMs: null }, NOW)).toMatchObject({ deadline: auto, overridden: false, error: null });
    expect(resolveMirrorDeadline(auto, { overrideDeadlineMs: Number.NaN }, NOW)).toMatchObject({ deadline: auto, overridden: false, error: null });
  });
});

describe("extractSourceLinks", () => {
  it("pulls http(s) URLs out of free text", () => {
    expect(extractSourceLinks("a https://youtu.be/abc b http://x.co/y c")).toEqual([
      "https://youtu.be/abc",
      "http://x.co/y",
    ]);
  });

  it("dedupes and caps the list", () => {
    const text = Array.from({ length: 12 }, (_, i) => `https://e.com/${i} https://e.com/${i}`).join(" ");
    expect(extractSourceLinks(text, 8)).toHaveLength(8);
  });

  it("returns [] for empty/undefined text", () => {
    expect(extractSourceLinks(undefined)).toEqual([]);
    expect(extractSourceLinks("no links here")).toEqual([]);
  });
});

describe("buildClippingFrCreateArgs", () => {
  const args = buildClippingFrCreateArgs(reward(), { creatorWallet: "AdminWallet111", nowMs: NOW });

  it("mirrors the reward into a marketing campaign at the converted USDC terms", () => {
    expect(args.creatorWallet).toBe("AdminWallet111");
    expect(args.title).toBe("MrBeast Clips");
    expect(args.brandName).toBe("Ryze");
    expect(args.budget).toBe(50);
    expect(args.ratePerThousandViews).toBe(0.08);
    expect(args.campaignType).toBe("marketing");
  });

  it("links back to the content reward and marks its origin", () => {
    expect(args.contentRewardId).toBe("cr-1");
    expect(args.origin).toBe(CLIPPING_FR_ORIGIN);
  });

  it("sets a deadline inside the on-chain [6h, 365d] window", () => {
    expect(args.deadline).toBe(new Date(NOW + CLIPPING_FR_DURATION_MS).toISOString());
  });

  it("carries sources, platforms and the thumbnail", () => {
    expect(args.contentLinks).toEqual([
      "https://youtu.be/abc123",
      "https://drive.google.com/file/d/xyz",
    ]);
    expect(args.platforms).toEqual(["tiktok", "youtube"]);
    expect(args.campaignImageUrl).toBe("https://cdn.example.com/thumb.png");
  });

  it("folds the requirements into the brief", () => {
    expect(args.brief).toContain("Min 15 seconds");
    expect(args.brief).toContain("Keep the hook");
  });

  it("passes the reward's content_requirements through to the mandatory requirements field", () => {
    expect(args.requirements).toEqual(["Min 15 seconds", "Keep the hook"]);
  });

  it("falls back to a generic clip rule so the now-mandatory field is never empty", () => {
    const noReqs = buildClippingFrCreateArgs(reward({ content_requirements: [] }), {
      creatorWallet: "w",
      nowMs: NOW,
    });
    expect(noReqs.requirements).toEqual(["Clip the source content and post as instructed."]);
  });

  it("falls back brandName owner → Jobtepi when the community is unnamed", () => {
    expect(
      buildClippingFrCreateArgs(reward({ communityName: undefined }), { creatorWallet: "w", nowMs: NOW }).brandName,
    ).toBe("Owner Guy");
    expect(
      buildClippingFrCreateArgs(reward({ communityName: undefined, ownerName: undefined }), {
        creatorWallet: "w",
        nowMs: NOW,
      }).brandName,
    ).toBe("Jobtepi");
  });
});

describe("planClippingFrMirror", () => {
  const opts = { creatorWallet: "AdminWallet111", nowMs: NOW };

  it("only plans clipping-type rewards", () => {
    const plan = planClippingFrMirror([reward({ type: "ugc" })], [], opts);
    expect(plan).toEqual([]);
  });

  it("plans a create for an unmirrored reward", () => {
    const plan = planClippingFrMirror([reward()], [], opts);
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe("create");
    if (plan[0].kind === "create") expect(plan[0].args.budget).toBe(50);
  });

  it("marks a reward done when ANY linked campaign is already funded v2", () => {
    const funded = row({ origin: undefined, pdaAddress: "Pda111", onchainVersion: 2 });
    const plan = planClippingFrMirror([reward()], [funded], opts);
    expect(plan[0]).toMatchObject({ kind: "done", campaignId: "camp-1" });
  });

  it("resumes an unfunded clipping-FR draft with the DRAFT's stored terms", () => {
    const draft = row({ budget: 43, ratePerThousandViews: 0.05 });
    const plan = planClippingFrMirror([reward({ budget: 9999 })], [draft], opts);
    expect(plan[0]).toMatchObject({
      kind: "resume",
      campaignId: "camp-1",
      budget: 43,
      ratePerThousandViews: 0.05,
    });
  });

  it("refreshes a resume deadline that is no longer inside the on-chain window", () => {
    const stale = row({ deadline: new Date(NOW - 1000).toISOString() });
    const plan = planClippingFrMirror([reward()], [stale], opts);
    if (plan[0].kind !== "resume") throw new Error("expected resume");
    expect(plan[0].deadline).toBe(new Date(NOW + CLIPPING_FR_DURATION_MS).toISOString());
  });

  it("ignores a stray unfunded NON-clipping-FR link and still plans a create", () => {
    const stray = row({ origin: undefined });
    const plan = planClippingFrMirror([reward()], [stray], opts);
    expect(plan[0].kind).toBe("create");
  });
});

// ── Orchestration ────────────────────────────────────────────────────────────

function makeOps(over: Partial<MirrorOps> = {}): { ops: MirrorOps; calls: string[] } {
  const calls: string[] = [];
  const ops: MirrorOps = {
    createRow: async () => {
      calls.push("createRow");
      return "camp-new";
    },
    checkFunding: async () => {
      calls.push("checkFunding");
      return { ok: true, needUsdc: false, needSol: false };
    },
    vaultFunded: async () => {
      calls.push("vaultFunded");
      return false;
    },
    signCreateCampaign: async () => {
      calls.push("sign");
      return { pdaAddress: "PdaSigned" };
    },
    derivePda: (id) => `Pda:${id}`,
    finalize: async () => {
      calls.push("finalize");
    },
    ...over,
  };
  return { ops, calls };
}

const createItem = (): MirrorPlanItem => ({
  kind: "create",
  reward: reward(),
  args: buildClippingFrCreateArgs(reward(), { creatorWallet: "w", nowMs: NOW }),
});

describe("runClippingFrMirror", () => {
  it("creates, signs and finalizes a fresh mirror", async () => {
    const { ops, calls } = makeOps();
    const { results, haltReason } = await runClippingFrMirror([createItem()], ops);
    expect(haltReason).toBeNull();
    expect(results).toEqual([
      expect.objectContaining({ rewardId: "cr-1", status: "funded", campaignId: "camp-new", pdaAddress: "PdaSigned" }),
    ]);
    expect(calls).toEqual(["checkFunding", "createRow", "sign", "finalize"]);
  });

  it("reports an already-funded reward without touching the wallet", async () => {
    const { ops, calls } = makeOps();
    const item: MirrorPlanItem = { kind: "done", reward: reward(), campaignId: "camp-1" };
    const { results } = await runClippingFrMirror([item], ops);
    expect(results[0].status).toBe("already-funded");
    expect(calls).toEqual([]);
  });

  it("skips signing when a resumed draft's vault already holds the budget", async () => {
    const { ops, calls } = makeOps({
      vaultFunded: async () => true,
    });
    const item: MirrorPlanItem = {
      kind: "resume",
      reward: reward(),
      campaignId: "camp-1",
      budget: 43,
      ratePerThousandViews: 0.05,
      deadline: new Date(NOW + CLIPPING_FR_DURATION_MS).toISOString(),
    };
    const { results } = await runClippingFrMirror([item], ops);
    expect(results[0]).toMatchObject({ status: "funded", pdaAddress: "Pda:camp-1" });
    expect(calls).toContain("finalize");
    expect(calls).not.toContain("sign");
  });

  it("halts the whole run when the wallet can't cover the next budget", async () => {
    const { ops, calls } = makeOps({
      checkFunding: async () => ({ ok: false, needUsdc: true, needSol: false }),
    });
    const { results, haltReason } = await runClippingFrMirror([createItem(), createItem()], ops);
    expect(haltReason).toBe("usdc");
    expect(results[0].status).toBe("halted-funds");
    expect(results[1].status).toBe("skipped");
    expect(calls).not.toContain("createRow"); // halted before inserting a draft row
  });

  it("finalizes without re-charging when the sign threw but the deposit landed", async () => {
    let vaultReads = 0;
    const { ops } = makeOps({
      vaultFunded: async () => {
        vaultReads += 1;
        return vaultReads > 1; // unfunded pre-sign, funded on the post-error re-read
      },
      signCreateCampaign: async () => {
        throw new Error("Transaction was not confirmed in 30.00 seconds");
      },
    });
    const item: MirrorPlanItem = {
      kind: "resume",
      reward: reward(),
      campaignId: "camp-1",
      budget: 43,
      ratePerThousandViews: 0.05,
      deadline: new Date(NOW + CLIPPING_FR_DURATION_MS).toISOString(),
    };
    const { results } = await runClippingFrMirror([item], ops);
    expect(results[0]).toMatchObject({ status: "funded", pdaAddress: "Pda:camp-1" });
  });

  it("fails one item on a deterministic revert and continues to the next", async () => {
    let signs = 0;
    const { ops } = makeOps({
      signCreateCampaign: async () => {
        signs += 1;
        if (signs === 1) throw new Error("AnchorError: InvalidDeadline. Error Code: 6002");
        return { pdaAddress: "PdaSigned" };
      },
    });
    const { results, haltReason } = await runClippingFrMirror([createItem(), createItem()], ops);
    expect(haltReason).toBeNull();
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toMatch(/deadline/i);
    expect(results[1].status).toBe("funded");
  });

  it("surfaces a finalize failure as failed-but-resumable", async () => {
    const { ops } = makeOps({
      finalize: async () => {
        throw new Error("Finalize failed");
      },
    });
    const { results } = await runClippingFrMirror([createItem()], ops);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toMatch(/finaliz/i);
  });

  it("reports progress after each item", async () => {
    const seen: number[] = [];
    const { ops } = makeOps();
    await runClippingFrMirror([createItem(), createItem()], ops, (done) => seen.push(done.length));
    expect(seen).toEqual([1, 2]);
  });

  it("REFUSES to fund a rate-0 vault (never signs a deposit that pays clippers nothing)", async () => {
    const { ops, calls } = makeOps();
    // A reward whose reward_rate is 0 → derived rate 0 → the vault would pay $0/1k.
    const zeroRate: MirrorPlanItem = {
      kind: "create",
      reward: reward({ reward_rate: 0 }),
      args: buildClippingFrCreateArgs(reward({ reward_rate: 0 }), { creatorWallet: "w", nowMs: NOW }),
    };
    const { results, haltReason } = await runClippingFrMirror([zeroRate], ops);
    expect(haltReason).toBeNull();
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toMatch(/rate 0|pays clippers nothing/i);
    // Never touched the wallet or inserted a row — refused before funding.
    expect(calls).not.toContain("sign");
    expect(calls).not.toContain("createRow");
  });

  it("refuses one bad-config item but still funds the rest of the run", async () => {
    const { ops } = makeOps();
    const bad: MirrorPlanItem = {
      kind: "create",
      reward: reward({ id: "cr-bad", reward_rate: 0 }),
      args: buildClippingFrCreateArgs(reward({ id: "cr-bad", reward_rate: 0 }), { creatorWallet: "w", nowMs: NOW }),
    };
    const { results } = await runClippingFrMirror([bad, createItem()], ops);
    expect(results[0].status).toBe("failed");
    expect(results[1].status).toBe("funded");
  });

  it("threads a per-campaign override into the deposit, the created row AND the finalize terms", async () => {
    const signed: Array<{ budget: number; rate: number }> = [];
    const created: Array<{ budget: number; rate: number }> = [];
    const finalized: Array<{ budget: number; rate: number }> = [];
    const { ops } = makeOps({
      createRow: async (args) => {
        created.push({ budget: args.budget, rate: args.ratePerThousandViews });
        return "camp-new";
      },
      signCreateCampaign: async (_id, budget, rate) => {
        signed.push({ budget, rate });
        return { pdaAddress: "PdaSigned" };
      },
      finalize: async (_id, _pda, terms) => {
        finalized.push({ budget: terms.budget, rate: terms.ratePerThousandViews });
      },
    });
    // auto would be 50 @ 0.08; operator overrides to 30 @ 0.10.
    const { results } = await runClippingFrMirror([createItem()], ops, undefined, {
      "cr-1": { budgetUsdc: 30, ratePerThousandViews: 0.1 },
    });
    expect(results[0].status).toBe("funded");
    expect(signed).toEqual([{ budget: 30, rate: 0.1 }]);
    expect(created).toEqual([{ budget: 30, rate: 0.1 }]); // draft persists the override so a resume matches the vault
    expect(finalized).toEqual([{ budget: 30, rate: 0.1 }]);
  });

  it("uses the RM→USDC auto values when no override is supplied for that reward", async () => {
    const signed: Array<{ budget: number; rate: number }> = [];
    const { ops } = makeOps({
      signCreateCampaign: async (_id, budget, rate) => {
        signed.push({ budget, rate });
        return { pdaAddress: "PdaSigned" };
      },
    });
    await runClippingFrMirror([createItem()], ops, undefined, { "other-reward": { budgetUsdc: 999 } });
    expect(signed).toEqual([{ budget: 50, rate: 0.08 }]);
  });

  it("REFUSES a ≤0 override (never signs a deposit that pays nothing)", async () => {
    const { ops, calls } = makeOps();
    const { results } = await runClippingFrMirror([createItem()], ops, undefined, {
      "cr-1": { budgetUsdc: 0, ratePerThousandViews: 0.08 },
    });
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toMatch(/budget 0|pays clippers nothing/i);
    expect(calls).not.toContain("sign");
    expect(calls).not.toContain("createRow");
  });

  // ── Deadline override plumbing ──────────────────────────────────────────────
  const DAY = 24 * 60 * 60 * 1000;

  it("uses the auto 180d deadline when no deadline override is supplied", async () => {
    const signedDeadlines: number[] = [];
    const { ops } = makeOps({
      signCreateCampaign: async (_id, _b, _r, deadlineUnix) => {
        signedDeadlines.push(deadlineUnix);
        return { pdaAddress: "PdaSigned" };
      },
    });
    // createItem()'s args carry deadline = NOW + 180d.
    await runClippingFrMirror([createItem()], ops, undefined, undefined, NOW);
    expect(signedDeadlines).toEqual([Math.floor((NOW + CLIPPING_FR_DURATION_MS) / 1000)]);
  });

  it("threads a per-campaign deadline override into the signed deadline AND the finalize terms", async () => {
    const signedDeadlines: number[] = [];
    const finalizedDeadlines: string[] = [];
    const { ops } = makeOps({
      signCreateCampaign: async (_id, _b, _r, deadlineUnix) => {
        signedDeadlines.push(deadlineUnix);
        return { pdaAddress: "PdaSigned" };
      },
      finalize: async (_id, _pda, terms) => {
        finalizedDeadlines.push(terms.deadline);
      },
    });
    const overrideMs = NOW + 30 * DAY; // in-window, replaces the auto 180d
    const { results } = await runClippingFrMirror([createItem()], ops, undefined, {
      "cr-1": { overrideDeadlineMs: overrideMs },
    }, NOW);
    expect(results[0].status).toBe("funded");
    expect(signedDeadlines).toEqual([Math.floor(overrideMs / 1000)]);
    expect(finalizedDeadlines).toEqual([new Date(overrideMs).toISOString()]);
  });

  it("REFUSES a deadline override past the 365d max (never reverts InvalidDeadline on-chain)", async () => {
    const { ops, calls } = makeOps();
    const tooFar = NOW + 400 * DAY;
    const { results, haltReason } = await runClippingFrMirror([createItem()], ops, undefined, {
      "cr-1": { overrideDeadlineMs: tooFar },
    }, NOW);
    expect(haltReason).toBeNull();
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toMatch(/1 year|maximum/i);
    expect(calls).not.toContain("sign");
    expect(calls).not.toContain("createRow");
  });

  it("REFUSES a deadline override under the 6h min but still funds the rest of the run", async () => {
    const { ops } = makeOps();
    const tooSoon: MirrorPlanItem = {
      kind: "create",
      reward: reward({ id: "cr-soon" }),
      args: buildClippingFrCreateArgs(reward({ id: "cr-soon" }), { creatorWallet: "w", nowMs: NOW }),
    };
    const { results } = await runClippingFrMirror([tooSoon, createItem()], ops, undefined, {
      "cr-soon": { overrideDeadlineMs: NOW + 60 * 60 * 1000 }, // 1h < 6h
    }, NOW);
    expect(results[0].status).toBe("failed");
    expect(results[0].error).toMatch(/6 hours|minimum/i);
    expect(results[1].status).toBe("funded");
  });

  it("single-row mirror is a pure slice of the batch (one item threads its own override end-to-end)", async () => {
    const signed: Array<{ budget: number; rate: number; deadline: number }> = [];
    const { ops } = makeOps({
      signCreateCampaign: async (_id, budget, rate, deadlineUnix) => {
        signed.push({ budget, rate, deadline: deadlineUnix });
        return { pdaAddress: "PdaSigned" };
      },
    });
    // The panel builds a one-element plan for a single-row mirror; the override map
    // still carries every row, but only the sliced item's override is applied.
    const overrideMs = NOW + 45 * DAY;
    const onlyItem = createItem(); // cr-1
    const { results } = await runClippingFrMirror([onlyItem], ops, undefined, {
      "cr-1": { budgetUsdc: 30, ratePerThousandViews: 0.1, overrideDeadlineMs: overrideMs },
      "other-reward": { budgetUsdc: 999 },
    }, NOW);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("funded");
    expect(signed).toEqual([{ budget: 30, rate: 0.1, deadline: Math.floor(overrideMs / 1000) }]);
  });
});
