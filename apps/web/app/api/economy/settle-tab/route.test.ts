// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFunctionName } from "convex/server";

/**
 * MED-A: after a successful on-chain sweep + markSettlementPaid, the settle-tab
 * route must re-reconcile the escrow mirror to the post-sweep VAULT balance
 * (mirrors settleAgent step 5). Without it escrowUsdc stays stale-HIGH and
 * spendable over-reports. Convex + vaultSweep + auth are mocked so we assert the
 * route's call sequence, not the cluster. NOTE: Convex's `anyApi` proxy is NOT
 * identity-stable across property accesses, so we match FunctionReferences by
 * `getFunctionName` (a stable "module:fn" string) rather than by `===`.
 */

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET = "TREASURY_WALLET";
  process.env.INTERNAL_CRON_SECRET = "cron-secret";
  return { queryMock: vi.fn(), mutationMock: vi.fn(), sweepMock: vi.fn(), resolveMock: vi.fn() };
});

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({ query: h.queryMock, mutation: h.mutationMock })),
}));
vi.mock("@/lib/server/requireAuth", () => ({
  requireInternalOrUserAuth: vi.fn(async () => ({ internal: true })),
  requireOwnerWithSiws: vi.fn(() => null),
}));
vi.mock("@/lib/economy/vaultSweep", () => ({
  sweepAgentTabOnchain: h.sweepMock,
  resolveAgentOnchainUsdc: h.resolveMock,
  ONCHAIN_FEE_ALREADY_PROCESSED: "onchain:fee-record-exists",
}));

import { POST } from "./route";

const MINT = "MintAAA";
const RECONCILE = "agentAccount:reconcileEscrowToOnchainServer";
const MARK_PAID = "usage:markSettlementPaid";

function makeReq(body: unknown) {
  return { json: async () => body } as unknown as import("next/server").NextRequest;
}
/** function names of the mutations the route invoked, in call order */
const mutationNames = () => h.mutationMock.mock.calls.map((c) => getFunctionName(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  // The route issues exactly one query (getByMintServer) → return the agent.
  h.queryMock.mockResolvedValue({ agentWallet: "wallet123", creatorWallet: "creator123" });
  h.mutationMock.mockImplementation(async (ref: unknown) => {
    switch (getFunctionName(ref as Parameters<typeof getFunctionName>[0])) {
      case "usage:settleTab": return { settled: true, settlementId: "s1", amountUsdc: 6 };
      case "usage:claimSettlement": return { claimed: true, amountUsdc: 6, coversUsageIds: [], mintAddress: MINT };
      case "usage:markSettlementPaid": return {};
      case RECONCILE: return { ok: true };
      default: return {};
    }
  });
  h.sweepMock.mockResolvedValue({ ok: true, txSignature: "SIG123" });
  h.resolveMock.mockResolvedValue(42);
});

describe("POST /api/economy/settle-tab (MED-A: reconcile after pay)", () => {
  it("re-reconciles the mirror to the post-sweep balance AFTER marking the settlement paid", async () => {
    const res = await POST(makeReq({ mintAddress: MINT }));
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, settled: true, txSignature: "SIG123", amountUsdc: 6 });

    // read the post-sweep balance via the agent wallet fallback...
    expect(h.resolveMock).toHaveBeenCalledWith({ mintAddress: MINT, fallbackWallet: "wallet123" });

    // ...and push it into exactly one reconcile mutation
    const reconcileCalls = h.mutationMock.mock.calls.filter((c) => getFunctionName(c[0]) === RECONCILE);
    expect(reconcileCalls).toHaveLength(1);
    expect(reconcileCalls[0][1]).toMatchObject({ mintAddress: MINT, onchainUsdc: 42, authSecret: "cron-secret" });

    // ordering matters: the reconcile must come AFTER markSettlementPaid
    const order = mutationNames();
    expect(order.indexOf(RECONCILE)).toBeGreaterThan(order.indexOf(MARK_PAID));
    expect(order.indexOf(MARK_PAID)).toBeGreaterThanOrEqual(0);
  });

  it("does NOT reconcile when the sweep fails (released for idempotent retry)", async () => {
    h.sweepMock.mockResolvedValue({ ok: false });
    const res = await POST(makeReq({ mintAddress: MINT }));
    expect(res.status).toBe(502);
    expect(mutationNames()).not.toContain(RECONCILE);
  });
});
