import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ after: vi.fn(), settle: vi.fn(), mutation: vi.fn(), refresh: vi.fn(), pay: vi.fn(), topUp: vi.fn() }));
vi.mock("@/lib/economy/settleAgent", () => ({ settleAgentEconomics: m.settle }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => { m.after(); void fn(); } }));
import { payForCharge, payOrBatch, BATCH_SETTLE_USDC } from "./generationPayment";

beforeEach(() => vi.resetAllMocks());

describe("payForCharge", () => {
  it("accepts atomically applied refund credits but rejects an empty settlement", async () => {
    m.settle.mockResolvedValue({ status: "credited", coveredUsdc: 0.4 });
    expect(await payForCharge("agent")).toEqual({ ok: true, credited: true });
    m.settle.mockResolvedValue({ status: "accruing", tabUsdc: 0, reason: "nothing to settle" });
    expect(await payForCharge("agent")).toEqual({ ok: false, reason: "nothing to settle" });
  });

  it("settles the whole tab immediately and reports the on-chain signature", async () => {
    m.settle.mockResolvedValue({ status: "settled", amountUsdc: 1.2, txSignature: "SIG", tabUsdc: 0 });
    expect(await payForCharge("agent")).toEqual({ ok: true, txSignature: "SIG" });
    expect(m.settle).toHaveBeenCalledWith("agent", { immediate: true });
  });
  it("fails when the payment did not settle, so generation can be blocked", async () => {
    m.settle.mockResolvedValue({ status: "accruing", tabUsdc: 1, reason: "custodial sweep confirm-ambiguous" });
    expect(await payForCharge("agent")).toEqual({ ok: false, reason: "custodial sweep confirm-ambiguous" });
    m.settle.mockResolvedValue({ status: "skipped", reason: "no agent wallet" });
    expect((await payForCharge("agent")).ok).toBe(false);
  });
  it("never settles the same agent twice at once", async () => {
    let running = 0, peak = 0;
    m.settle.mockImplementation(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 15)); running--; return { status: "settled", amountUsdc: 1, txSignature: "S", tabUsdc: 0 }; });
    await Promise.all([payForCharge("a"), payForCharge("a"), payForCharge("a")]);
    expect(peak).toBe(1);
    expect(m.settle).toHaveBeenCalledTimes(3);
  });
});

describe("generation billing pays on-chain before work starts", () => {
  const load = async () => {
    vi.resetModules();
    vi.doMock("convex/browser", () => ({ ConvexHttpClient: class { mutation = m.mutation; } }));
    vi.doMock("./agentWallet", () => ({ refreshAgentFunds: m.refresh }));
    vi.doMock("./holderTier", () => ({ holderDiscountForMint: async () => 0 }));
    vi.doMock("./generationPayment", () => ({ payOrBatch: m.pay }));
    vi.doMock("./solSwap", () => ({ topUpAgentFromSol: m.topUp }));
    vi.doMock("@/convex/_generated/api", () => ({ api: { usage: { recordUsage: "recordUsage", refundRunFees: "refundRunFees" } } }));
    return import("./exploreBilling");
  };
  beforeEach(() => { process.env.NEXT_PUBLIC_CONVEX_URL = "https://x.convex.cloud"; });

  it("charges, pays on-chain, and only then allows the render", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValue({ ok: true, costUsdc: 0.55 });
    m.pay.mockResolvedValue({ ok: true, txSignature: "SIG" });
    expect(await chargeExploreRun("mint", "run1", 0.5)).toEqual({ ok: true, costUsdc: 0.55 });
    expect(m.pay).toHaveBeenCalledWith("mint", 0.55);
  });
  it("refunds and refuses when the on-chain payment fails, so nothing is generated", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValue({ ok: true, costUsdc: 0.55 });
    m.pay.mockResolvedValue({ ok: false, reason: "no treasury" });
    expect(await chargeExploreRun("mint", "run2", 0.5)).toEqual({ ok: false, reason: "payment_failed" });
    expect(m.mutation).toHaveBeenCalledWith("refundRunFees", expect.objectContaining({ jobId: "run2" }));
  });
  it("does not pay twice for a retried run that was already booked and paid", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValue({ ok: true, costUsdc: 0.55, duplicate: true, paymentConfirmed: true });
    expect((await chargeExploreRun("mint", "run3", 0.5)).ok).toBe(true);
    expect(m.pay).not.toHaveBeenCalled();
  });
  it("settles a retried reservation that has no payment proof before allowing work", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValue({ ok: true, costUsdc: 0.55, duplicate: true, paymentConfirmed: false });
    m.pay.mockResolvedValue({ ok: false, reason: "sweep deferred" });
    expect(await chargeExploreRun("mint", "unpaid-retry", 0.5)).toEqual({ ok: false, reason: "payment_failed" });
    expect(m.pay).toHaveBeenCalledWith("mint", 0.55);
  });
  it("reports a signing-key mismatch and refunds the reservation", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValue({ ok: true, costUsdc: 0.55 });
    m.pay.mockResolvedValue({ ok: false, reason: "wallet_signing_unavailable" });
    expect(await chargeExploreRun("mint", "key-failure", 0.5)).toEqual({ ok: false, reason: "wallet_signing_unavailable" });
    expect(m.mutation).toHaveBeenLastCalledWith("refundRunFees", expect.objectContaining({ jobId: "key-failure" }));
  });
  it("never reaches the chain when the agent cannot cover the charge", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValue({ ok: false, reason: "needs_funding" });
    m.topUp.mockResolvedValue({ ok: false, reason: "no_sol" });
    expect(await chargeExploreRun("mint", "run4", 0.5)).toEqual({ ok: false, reason: "needs_funding" });
    expect(m.pay).not.toHaveBeenCalled();
  });
  it("swaps SOL for the shortfall when USDC is short, then charges and pays as normal", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValueOnce({ ok: false, reason: "needs_funding" }).mockResolvedValueOnce({ ok: true, costUsdc: 0.55 });
    m.topUp.mockResolvedValue({ ok: true, swapped: true, signature: "SWAP" });
    m.pay.mockResolvedValue({ ok: true, txSignature: "SIG" });
    expect(await chargeExploreRun("mint", "run5", 0.5)).toEqual({ ok: true, costUsdc: 0.55 });
    expect(m.topUp).toHaveBeenCalledWith("mint", expect.closeTo(0.575, 3));
    expect(m.pay).toHaveBeenCalledWith("mint", 0.55);
  });
  it("still says needs_funding when neither USDC nor SOL can cover it", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValue({ ok: false, reason: "needs_funding" });
    m.topUp.mockResolvedValue({ ok: false, reason: "no_sol" });
    expect(await chargeExploreRun("mint", "run6", 0.5)).toEqual({ ok: false, reason: "needs_funding" });
    expect(m.pay).not.toHaveBeenCalled();
  });
});

describe("payOrBatch (pay first, or batch the tiny charges)", () => {
  beforeEach(() => m.settle.mockResolvedValue({ status: "settled", amountUsdc: 0.3, txSignature: "SIG", tabUsdc: 0 }));
  it("pays real spend on-chain first and reports a failed payment", async () => {
    expect(await payOrBatch("a", 0.5)).toEqual({ ok: true, txSignature: "SIG" });
    expect(m.settle).toHaveBeenCalledWith("a", { immediate: true });
    m.settle.mockResolvedValue({ status: "skipped", reason: "no wallet" });
    expect((await payOrBatch("a", 0.044)).ok).toBe(false);
  });
  it("leaves a tiny charge on the tab and sweeps it only once the tab reaches the batch size", async () => {
    expect(await payOrBatch("a", 0.003)).toEqual({ ok: true, batched: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(m.settle).toHaveBeenCalledWith("a", { threshold: BATCH_SETTLE_USDC });
    expect(m.settle).not.toHaveBeenCalledWith("a", { immediate: true });
  });
});
