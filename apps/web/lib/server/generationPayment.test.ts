import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ settle: vi.fn(), mutation: vi.fn(), refresh: vi.fn(), pay: vi.fn() }));
vi.mock("@/lib/economy/settleAgent", () => ({ settleAgentEconomics: m.settle }));
import { payForCharge } from "./generationPayment";

beforeEach(() => vi.resetAllMocks());

describe("payForCharge", () => {
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
    vi.doMock("./generationPayment", () => ({ payForCharge: m.pay }));
    vi.doMock("@/convex/_generated/api", () => ({ api: { usage: { recordUsage: "recordUsage", refundRunFees: "refundRunFees" } } }));
    return import("./exploreBilling");
  };
  beforeEach(() => { process.env.NEXT_PUBLIC_CONVEX_URL = "https://x.convex.cloud"; });

  it("charges, pays on-chain, and only then allows the render", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValue({ ok: true, costUsdc: 0.55 });
    m.pay.mockResolvedValue({ ok: true, txSignature: "SIG" });
    expect(await chargeExploreRun("mint", "run1", 0.5)).toEqual({ ok: true, costUsdc: 0.55 });
    expect(m.pay).toHaveBeenCalledWith("mint");
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
    m.mutation.mockResolvedValue({ ok: true, costUsdc: 0.55, duplicate: true });
    expect((await chargeExploreRun("mint", "run3", 0.5)).ok).toBe(true);
    expect(m.pay).not.toHaveBeenCalled();
  });
  it("never reaches the chain when the agent cannot cover the charge", async () => {
    const { chargeExploreRun } = await load();
    m.mutation.mockResolvedValue({ ok: false, reason: "needs_funding" });
    expect(await chargeExploreRun("mint", "run4", 0.5)).toEqual({ ok: false, reason: "needs_funding" });
    expect(m.pay).not.toHaveBeenCalled();
  });
});
