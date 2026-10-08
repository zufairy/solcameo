import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = m.query; mutation = m.mutation; } }));
vi.mock("@/lib/server/platformSnapshot", () => ({ platformSnapshot: async () => null }));
vi.mock("@/lib/server/solSwap", () => ({ usdcPerSol: async () => 150 }));
vi.mock("@/lib/solana/network", () => ({ getRpcCandidates: () => ["https://rpc.test"] }));
import { accrueReferralForWalletPayment } from "./referrals";
import { MARGIN_SHARE } from "@/lib/referrals/program";

beforeEach(() => { vi.resetAllMocks(); process.env.NEXT_PUBLIC_CONVEX_URL = "https://convex.test"; process.env.INTERNAL_CRON_SECRET = "s"; });

it("records the referrer's cut of the margin on a wallet-paid video, keyed by the transfer signature", async () => {
  m.query.mockResolvedValue({ referrerWallet: "REFERRER" });
  await accrueReferralForWalletPayment({ signature: "SIG", payer: "PAYER", amountUsdc: 10 });
  expect(m.mutation).toHaveBeenCalledTimes(1);
  expect(m.mutation.mock.calls[0][1]).toMatchObject({ settlementId: "wallet:SIG", referrerWallet: "REFERRER", refereeWallet: "PAYER", spendUsdc: 10, marginUsdc: +(10 * MARGIN_SHARE).toFixed(6) });
});
it("does nothing for a wallet nobody referred", async () => {
  m.query.mockResolvedValue(null);
  await accrueReferralForWalletPayment({ signature: "SIG", payer: "PAYER", amountUsdc: 10 });
  expect(m.mutation).not.toHaveBeenCalled();
});
it("never throws, so a payment can never be delayed by referrals", async () => {
  m.query.mockRejectedValue(new Error("convex down"));
  await expect(accrueReferralForWalletPayment({ signature: "SIG", payer: "PAYER", amountUsdc: 10 })).resolves.toBeUndefined();
});
