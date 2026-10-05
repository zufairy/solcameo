// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFunctionName } from "convex/server";

/**
 * F2: the keeper's decision for a confirm-ambiguous settlement whose embedded
 * signature getSignatureStatus reports as UNKNOWN. The ONLY safe re-transfer is
 * when the tx's blockhash is provably expired (cluster tip > lastValidBlockHeight)
 * — everything else MUST defer, never re-transfer on uncertainty.
 *
 * The second suite drives the FULL keeper (POST → recoverOne) with mocked Convex /
 * RPC / sweep collaborators to prove the NO-DOUBLE-SPEND invariant on the custodial
 * (non-idempotent transferUsdc) path: a stranded row that carries a prior confirm
 * sig is VERIFIED on-chain BEFORE any re-transfer — a landed sig is marked paid
 * (sweep never re-runs), an in-window sig is deferred (sweep never re-runs).
 */
const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET = "TREASURY_WALLET";
  process.env.INTERNAL_CRON_SECRET = "cron-secret";
  process.env.PLATFORM_FEE_PAYER_SECRET = "fee-payer-secret"; // sponsored-gas signer the pre-flight checks
  return {
    queryMock: vi.fn(),
    mutationMock: vi.fn(),
    sweepMock: vi.fn(),
    resolveMock: vi.fn(),
    getSigStatusMock: vi.fn(),
    getHeightMock: vi.fn(),
    getSolBalanceStrictMock: vi.fn(),
    loadKeypairMock: vi.fn(),
    sendAlertMock: vi.fn(),
  };
});

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({ query: h.queryMock, mutation: h.mutationMock })),
}));
vi.mock("@/lib/server/requireAuth", () => ({ checkInternalSecret: () => true }));
vi.mock("@/lib/trader/usdcTransfer", () => ({
  getSignatureStatus: h.getSigStatusMock,
  getCurrentBlockHeight: h.getHeightMock,
  getSolBalanceStrict: h.getSolBalanceStrictMock, // fee-payer SOL pre-flight (strict: null on RPC error)
  loadKeypair: h.loadKeypairMock,
}));
vi.mock("@/lib/economy/vaultSweep", () => ({
  sweepAgentTabOnchain: h.sweepMock,
  resolveAgentOnchainUsdc: h.resolveMock,
  ONCHAIN_FEE_ALREADY_PROCESSED: "onchain:fee-record-exists",
}));
vi.mock("@/lib/server/alert", () => ({ sendAlert: h.sendAlertMock }));

import { POST } from "./route";
import { decideUnknownSettlement } from "@/lib/economy/recoveryDecisions";
import { buildInflight } from "@/lib/economy/settlementSentinel";

describe("decideUnknownSettlement (F2 blockhash-expiry rule)", () => {
  it("re-transfers when the blockhash is PROVABLY expired (tip > lvbh)", () => {
    // The dropped tx can never land — its blockhash window has closed.
    expect(decideUnknownSettlement({ lastValidBlockHeight: 100, currentHeight: 101 })).toBe("retransfer");
    expect(decideUnknownSettlement({ lastValidBlockHeight: 100, currentHeight: 5_000 })).toBe("retransfer");
  });

  it("DEFERS while still in-window (tip <= lvbh) — the sig could still land", () => {
    expect(decideUnknownSettlement({ lastValidBlockHeight: 100, currentHeight: 100 })).toBe("defer"); // boundary: not yet expired
    expect(decideUnknownSettlement({ lastValidBlockHeight: 100, currentHeight: 99 })).toBe("defer");
    expect(decideUnknownSettlement({ lastValidBlockHeight: 100, currentHeight: 1 })).toBe("defer");
  });

  it("DEFERS when lvbh is unknown (legacy row written before F2) — can't prove expiry", () => {
    expect(decideUnknownSettlement({ lastValidBlockHeight: undefined, currentHeight: 9_999_999 })).toBe("defer");
  });

  it("DEFERS when the live tip couldn't be read (getBlockHeight errored → null)", () => {
    // Conservative: NEVER re-transfer on uncertainty, even if lvbh is known.
    expect(decideUnknownSettlement({ lastValidBlockHeight: 100, currentHeight: null })).toBe("defer");
  });

  it("DEFERS when BOTH lvbh and tip are unavailable", () => {
    expect(decideUnknownSettlement({ lastValidBlockHeight: undefined, currentHeight: null })).toBe("defer");
  });
});

// ── Full keeper (POST → recoverOne): verify-before-retransfer no-double-spend ──

const MINT = "MintZZZ";
/** Mutation function-names the keeper invoked, in call order. */
const mutationNames = () => h.mutationMock.mock.calls.map((c) => getFunctionName(c[0]));

/** A stranded row (returned by listStrandedSettlements) whose sentinel carries a
 *  prior confirm-ambiguous sig + lvbh, with an EXPIRED lease (so it's claimable). */
function strandedWithPriorSig(sig: string, lvbh: number) {
  return {
    settlementId: "strand1",
    mintAddress: MINT,
    amountUsdc: 4,
    coversUsageIds: [],
    sentinel: buildInflight("tok", Date.now() - 60_000, sig, lvbh),
    at: Date.now() - 20 * 60_000,
  };
}

function makeReq() {
  return {} as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.queryMock.mockResolvedValue([]); // safe default: no stranded rows (per-test suites override)
  h.mutationMock.mockImplementation(async (ref: unknown) => {
    switch (getFunctionName(ref as Parameters<typeof getFunctionName>[0])) {
      case "usage:claimSettlement": return { claimed: true, amountUsdc: 4, coversUsageIds: [], mintAddress: MINT };
      default: return { ok: true };
    }
  });
  h.resolveMock.mockResolvedValue(10);
  // Fee-payer pre-flight defaults: a valid key + HEALTHY SOL so the existing suites
  // proceed unchanged. The pre-flight suite overrides the balance / key per test.
  h.loadKeypairMock.mockReturnValue({ publicKey: { toBase58: () => "FEEPAYER_PUBKEY" } });
  h.getSolBalanceStrictMock.mockResolvedValue(1.0);
});

describe("POST /api/economy/recover-settlements — verify-before-retransfer (no double-spend)", () => {
  it("persists RPC cooldown and stops the batch at the first rate limit", async () => {
    const first = { ...strandedWithPriorSig("unused", 500), sentinel: null };
    h.queryMock.mockImplementation(async (ref: unknown) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      if (name === "usage:listStrandedSettlements") return [first, { ...first, settlementId: "strand2" }];
      if (name === "influencers:getByMintServer") return { agentWallet: "walletZ" };
      return null;
    });
    h.sweepMock.mockResolvedValue({ ok: false, reason: "rpc_rate_limited", retryDelayMs: 300_000 });
    const response = await POST(makeReq());
    expect((await response.json()).scanned).toBe(1);
    expect(h.sweepMock).toHaveBeenCalledTimes(1);
    const release = h.mutationMock.mock.calls.find(c => getFunctionName(c[0]) === "usage:releaseSettlement");
    expect(release?.[1]).toMatchObject({ retryDelayMs: 300_000 });
    expect(mutationNames()).not.toContain("usage:markSettlementPaid");
  });
  it("(e) a prior sig that LANDED is marked paid WITHOUT re-sweeping (never double-transfers)", async () => {
    const stranded = strandedWithPriorSig("PRIOR_SIG", 500);
    h.queryMock.mockImplementation(async (ref: unknown) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      if (name === "usage:listStrandedSettlements") return [stranded];
      if (name === "influencers:getByMintServer") return { agentWallet: "walletZ" };
      return null;
    });
    h.getSigStatusMock.mockResolvedValue("landed"); // the prior transfer DID land

    const res = await POST(makeReq());
    const json = await res.json();

    // Verified on-chain → marked paid with the SAME prior sig, and NEVER re-swept.
    expect(h.getSigStatusMock).toHaveBeenCalledWith("PRIOR_SIG");
    expect(h.sweepMock).not.toHaveBeenCalled(); // <-- no re-transfer = no double-spend
    const paid = h.mutationMock.mock.calls.find((c) => getFunctionName(c[0]) === "usage:markSettlementPaid");
    expect(paid?.[1]).toMatchObject({ txSignature: "PRIOR_SIG" });
    expect(json.outcomes[0]).toMatchObject({ result: "paid", txSignature: "PRIOR_SIG", verified: true });
  });

  it("(e') a prior sig that is UNKNOWN but still IN-WINDOW is deferred, NOT re-swept", async () => {
    const stranded = strandedWithPriorSig("PENDING_SIG", 1_000);
    h.queryMock.mockImplementation(async (ref: unknown) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      if (name === "usage:listStrandedSettlements") return [stranded];
      if (name === "influencers:getByMintServer") return { agentWallet: "walletZ" };
      return null;
    });
    h.getSigStatusMock.mockResolvedValue("unknown");
    h.getHeightMock.mockResolvedValue(900); // tip 900 <= lvbh 1000 → still in-window

    const res = await POST(makeReq());
    const json = await res.json();

    expect(h.sweepMock).not.toHaveBeenCalled(); // never re-transfer on uncertainty
    expect(mutationNames()).toContain("usage:markSettlementConfirmAmbiguous"); // re-annotated, not released
    expect(mutationNames()).not.toContain("usage:markSettlementPaid");
    expect(json.outcomes[0]).toMatchObject({ result: "ambiguous_left" });
  });

  it("re-drive of a custodial sweep that confirm-times-out again is STAMPED ambiguous, not released", async () => {
    // No prior sig (fresh strand) → the keeper re-sweeps; the custodial sweep itself
    // confirm-times-out → the keeper must stamp the NEW sig (never release it, which
    // would let a later pass re-transfer = double-spend).
    const stranded = { settlementId: "strand2", mintAddress: MINT, amountUsdc: 4, coversUsageIds: [], sentinel: null, at: Date.now() - 20 * 60_000 };
    h.queryMock.mockImplementation(async (ref: unknown) => {
      const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
      if (name === "usage:listStrandedSettlements") return [stranded];
      if (name === "influencers:getByMintServer") return { agentWallet: "walletZ" };
      return null;
    });
    h.sweepMock.mockResolvedValue({ ok: false, ambiguous: true, txSignature: "NEW_AMBIG_SIG", lastValidBlockHeight: 777 });

    const res = await POST(makeReq());
    const json = await res.json();

    const stamp = h.mutationMock.mock.calls.find((c) => getFunctionName(c[0]) === "usage:markSettlementConfirmAmbiguous");
    expect(stamp?.[1]).toMatchObject({ confirmSig: "NEW_AMBIG_SIG", lastValidBlockHeight: 777 });
    expect(mutationNames()).not.toContain("usage:releaseSettlement"); // NOT released
    expect(json.outcomes[0]).toMatchObject({ result: "ambiguous_left" });
  });
});

// ── C5: fee-payer SOL pre-flight — surface the silent settlement strand ───────────
// The CUSTODIAL compute-tab sweep (vault-LESS agents) pays gas from
// PLATFORM_FEE_PAYER_SECRET. A drained (or rotated-bad) fee-payer makes every such
// sweep fail PRE-broadcast (transferUsdc {ok:false, step:"fees"|"load-feepayer"} — no
// USDC ever moves, fail-closed) and strand SILENTLY: released + retried every tick
// with only a console.warn, no page. This suite proves the keeper now mirrors the
// oracle claim keeper's MIN_SIGNER_SOL guard — a distinct sendAlert + a fail-closed
// SKIP of the tick — while NEVER marking a settlement paid or moving any USDC.
describe("POST /api/economy/recover-settlements — fee-payer SOL pre-flight (silent-strand alert)", () => {
  it("underfunded fee-payer → alerts ONCE (fee-payer reason) and SKIPS the tick: no list, no mutation, no sweep (no transfer / no mark-paid)", async () => {
    h.getSolBalanceStrictMock.mockResolvedValue(0.001); // below the 0.05 SOL floor

    const res = await POST(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200); // fail-closed skip, not a 5xx error
    // Alerted exactly once, with the DISTINCT fee-payer-strand reason.
    expect(h.sendAlertMock).toHaveBeenCalledTimes(1);
    expect(h.sendAlertMock).toHaveBeenCalledWith(
      "settlement-signer-low-sol",
      expect.objectContaining({ signer: "fee-payer" }),
    );
    // No money handling AT ALL — the tick short-circuited before listing/claiming/sweeping.
    expect(h.sweepMock).not.toHaveBeenCalled();    // no transfer attempted
    expect(h.mutationMock).not.toHaveBeenCalled(); // nothing marked paid / released
    expect(h.queryMock).not.toHaveBeenCalled();    // stranded rows untouched, retry next tick
    expect(json).toMatchObject({ scanned: 0, recovered: 0 });
  });

  it("healthy fee-payer → NO alert; the tick proceeds to list stranded rows normally", async () => {
    h.getSolBalanceStrictMock.mockResolvedValue(1.0); // well above the floor
    h.queryMock.mockResolvedValue([]);                // nothing stranded this tick

    const res = await POST(makeReq());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(h.sendAlertMock).not.toHaveBeenCalled(); // healthy signer never pages
    expect(h.queryMock).toHaveBeenCalled();         // did NOT skip — proceeded normally
    expect(h.sweepMock).not.toHaveBeenCalled();     // nothing to sweep (empty list)
    expect(json).toMatchObject({ ok: true, scanned: 0 });
  });

  it("fee-payer balance UNREADABLE (RPC → null) → fail-OPEN: no alert, tick proceeds (never strand on a flaky RPC)", async () => {
    h.getSolBalanceStrictMock.mockResolvedValue(null);
    h.queryMock.mockResolvedValue([]);

    await POST(makeReq());

    expect(h.sendAlertMock).not.toHaveBeenCalled();
    expect(h.queryMock).toHaveBeenCalled(); // proceeded — an unknown balance is not a drained one
  });

  it("rotated/bad fee-payer key → alerts (distinct reason) and SKIPS the tick, no money handling", async () => {
    h.loadKeypairMock.mockImplementation(() => { throw new Error("bad base64 keypair"); });

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(h.sendAlertMock).toHaveBeenCalledTimes(1);
    expect(h.sendAlertMock).toHaveBeenCalledWith(
      "settlement-signer-bad-key",
      expect.objectContaining({ signer: "fee-payer" }),
    );
    expect(h.sweepMock).not.toHaveBeenCalled();
    expect(h.mutationMock).not.toHaveBeenCalled();
    expect(h.queryMock).not.toHaveBeenCalled();
  });
});
