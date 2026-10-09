import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ refresh: vi.fn(), mutation: vi.fn(), pay: vi.fn(), refund: vi.fn(), topUp: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { mutation = h.mutation; } }));
vi.mock("./agentWallet", () => ({ refreshAgentFunds: h.refresh }));
vi.mock("./generationPayment", () => ({ payForCharge: h.pay }));
vi.mock("./solSwap", () => ({ topUpAgentFromSol: h.topUp }));
vi.mock("./holderTier", () => ({ holderDiscountForMint: async () => 0 }));
vi.mock("./imageBilling", () => ({ refundImage: h.refund }));
import { chargeAgentGeneration } from "./agentGenerationBilling";
beforeEach(() => {
  vi.resetAllMocks();
  h.mutation.mockResolvedValue({ ok: true, costUsdc: 0.05 });
  h.pay.mockResolvedValue({ ok: true, txSignature: "confirmed" });
});
it("requires the agent wallet transfer for posting and even tiny captions", async () => {
  for (const service of ["social_post", "llm_message", "clip.captions"]) {
    expect((await chargeAgentGeneration("mint", "run", service)).ok).toBe(true);
    expect(h.mutation.mock.calls.at(-1)?.[1]).toMatchObject({ walletOnly: true, requireTransfer: true, idemKey: `run:skill:${service}` });
    expect(h.pay).toHaveBeenLastCalledWith("mint", { requireTransfer: true });
  }
});
it("rejects and reverses the booked charge when settlement fails", async () => {
  h.pay.mockResolvedValue({ ok: false, reason: "no treasury configured" });
  expect(await chargeAgentGeneration("mint", "run", "social_post")).toEqual({ ok: false, reason: "payment_failed" });
  expect(h.refund).toHaveBeenCalledWith("mint", "run");
});
it("a retry with confirmed payment does not transfer again", async () => {
  h.mutation.mockResolvedValue({ ok: true, costUsdc: 0.05, duplicate: true, paymentConfirmed: true });
  expect((await chargeAgentGeneration("mint", "run", "social_post")).ok).toBe(true);
  expect(h.pay).not.toHaveBeenCalled();
});
it("a pending transfer blocks a retry instead of charging twice", async () => {
  h.mutation.mockResolvedValue({ ok: false, reason: "payment_pending" });
  expect(await chargeAgentGeneration("mint", "run", "social_post")).toEqual({ ok: false, reason: "payment_pending" });
  expect(h.pay).not.toHaveBeenCalled();
});

it("accepts a charge already settled by a concurrent operation without a second transfer", async () => {
  h.mutation.mockResolvedValueOnce({ ok: true, costUsdc: 0.05 }).mockResolvedValueOnce({ ok: true, costUsdc: 0.05, paymentConfirmed: true, duplicate: true });
  h.pay.mockResolvedValue({ ok: false, reason: "nothing to settle" });
  expect((await chargeAgentGeneration("mint", "run", "social_post")).ok).toBe(true);
  expect(h.refund).not.toHaveBeenCalled();
});
