import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.VELLO_SETTLE_THRESHOLD_USDC = "0.05";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://x.convex.cloud";
  return { query: vi.fn(), mutation: vi.fn(), sweep: vi.fn(), onchain: vi.fn(), referral: vi.fn() };
});
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = h.query; mutation = h.mutation; } }));
vi.mock("@/convex/_generated/api", () => ({ api: { influencers: { getByMintServer: "getByMintServer" }, agentAccount: { reconcileEscrowToOnchainServer: "reconcile" }, usage: { settleTab: "settleTab", claimSettlement: "claim", markSettlementPaid: "paid", releaseSettlement: "release", markSettlementConfirmAmbiguous: "amb" } } }));
vi.mock("@/lib/economy/vaultSweep", () => ({ sweepAgentTabOnchain: h.sweep, resolveAgentOnchainUsdc: h.onchain, ONCHAIN_FEE_ALREADY_PROCESSED: "processed" }));
vi.mock("@/lib/server/referrals", () => ({ accrueReferralForSettlement: h.referral }));
import { settleAgentEconomics } from "./settleAgent";

beforeEach(() => {
  vi.resetAllMocks();
  h.query.mockResolvedValue({ agentWallet: "AGENT" });
  h.onchain.mockResolvedValue(5);
  h.mutation.mockImplementation(async (name: string) => {
    if (name === "reconcile") return { ok: true, unsettledTabUsdc: 0.03 };
    if (name === "settleTab") return { settled: true, settlementId: "s1", amountUsdc: 0.03 };
    if (name === "claim") return { claimed: true, amountUsdc: 0.03 };
    return {};
  });
  h.sweep.mockResolvedValue({ ok: true, txSignature: "SIG" });
});

describe("settleAgentEconomics", () => {
  it("returns the confirmed payment without waiting for a stalled referral service", async () => {
    h.referral.mockReturnValue(new Promise(() => {}));
    expect(await settleAgentEconomics("mint", { immediate: true })).toMatchObject({ status: "settled", txSignature: "SIG" });
  });

  it("applies refund credit even when the reconciled tab is negative without sweeping", async () => {
    h.mutation.mockImplementation(async (name: string) => name === "reconcile" ? { ok: true, unsettledTabUsdc: -0.5 } : { settled: false, credited: true, coveredUsdc: 0.4 });
    expect(await settleAgentEconomics("mint", { immediate: true })).toEqual({ status: "credited", coveredUsdc: 0.4 });
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it("batches a tiny tab below the configured threshold", async () => {
    expect(await settleAgentEconomics("mint")).toMatchObject({ status: "accruing", reason: "below threshold" });
    expect(h.sweep).not.toHaveBeenCalled();
  });
  it("pays even a tiny tab on-chain right away when asked to, the way a finished video does", async () => {
    expect(await settleAgentEconomics("mint", { immediate: true })).toMatchObject({ status: "settled", amountUsdc: 0.03, txSignature: "SIG" });
    expect(h.sweep).toHaveBeenCalledWith({ mintAddress: "mint", settlementId: "s1", amountUsdc: 0.03 });
  });
  it("waits for a custom batch threshold, then pays the whole tab in one transfer", async () => {
    expect(await settleAgentEconomics("mint", { threshold: 0.25 })).toMatchObject({ status: "accruing", reason: "below threshold" });
    h.mutation.mockImplementation(async (name: string) => (name === "reconcile" ? { ok: true, unsettledTabUsdc: 0.3 } : name === "settleTab" ? { settled: true, settlementId: "s2", amountUsdc: 0.3 } : name === "claim" ? { claimed: true, amountUsdc: 0.3 } : {}));
    expect(await settleAgentEconomics("mint", { threshold: 0.25 })).toMatchObject({ status: "settled", amountUsdc: 0.3 });
  });
  it("has nothing to pay when the tab is empty", async () => {
    h.mutation.mockImplementation(async (name: string) => (name === "reconcile" ? { ok: true, unsettledTabUsdc: 0 } : {}));
    expect((await settleAgentEconomics("mint", { immediate: true })).status).toBe("accruing");
    expect(h.sweep).not.toHaveBeenCalled();
  });
});
