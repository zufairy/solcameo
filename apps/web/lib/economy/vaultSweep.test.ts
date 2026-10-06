// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * HIGH-1 + MED-C: `sweepAgentTabOnchain` must split a collapsed settlement that
 * exceeds the vault's per-run cap into <=cap `debit_fee` chunks (cap READ from the
 * vault, not hardcoded), treat a FeeExceedsCap revert as TERMINAL (never the
 * retry-releasing { ok:false } — that loops forever), and use the on-chain
 * FeeRecord PDA (not an error substring) to detect an already-swept chunk after a
 * confirm-timeout. All agent-vault / Convex / Solana collaborators are mocked so
 * the sweep decision logic is exercised without a cluster.
 */

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET = "11111111111111111111111111111111";
  process.env.PLATFORM_VAULT_AUTHORITY_SECRET = "dummy-secret";
  process.env.PLATFORM_FEE_PAYER_SECRET = "fee-payer-secret";
  process.env.INTERNAL_CRON_SECRET = "cron-secret";
  return {
    queryMock: vi.fn(),
    debitFeeTxMock: vi.fn(),
    fetchVaultMock: vi.fn(),
    getAccountInfoMock: vi.fn(),
    getTokenAccountBalanceMock: vi.fn(),
    transferUsdcMock: vi.fn(),
    sendAlertMock: vi.fn(),
    feePayerReadyMock: vi.fn(),
    ensureGasMock: vi.fn(),
  };
});

vi.mock("convex/browser", () => ({
  ConvexHttpClient: vi.fn().mockImplementation(() => ({ query: h.queryMock, mutation: vi.fn() })),
}));
vi.mock("@/lib/solana/network", () => ({ getUsdcMint: () => "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" }));
vi.mock("@/lib/trader/usdcTransfer", () => ({
  loadKeypair: () => ({ publicKey: { toBase58: () => "AUTH", toBuffer: () => Buffer.alloc(32) } }),
  getUsdcBalance: vi.fn(),
  getUsdcBalanceForAta: vi.fn(),
  transferUsdc: h.transferUsdcMock,
}));
vi.mock("@/lib/economy/walletSecretAccess", () => ({ readAgentSecret: (s: string) => `decrypted:${s}` }));
vi.mock("@/lib/server/alert", () => ({ sendAlert: h.sendAlertMock }));
vi.mock("@/lib/server/solSwap", () => ({ feePayerReady: h.feePayerReadyMock, ensureAgentGas: h.ensureGasMock }));
vi.mock("@solana/spl-token", () => ({
  getAssociatedTokenAddress: vi.fn(async () => ({ toBase58: () => "TREASURY_ATA" })),
}));
vi.mock("@/lib/agentVault", () => ({
  getVaultConnection: vi.fn(),
  buildAgentVaultProgram: () => ({ provider: { connection: { getAccountInfo: h.getAccountInfoMock, getTokenAccountBalance: h.getTokenAccountBalanceMock } } }),
  debitFeeTx: h.debitFeeTxMock,
  fetchVault: h.fetchVaultMock,
  getVaultPda: () => [{ toBase58: () => "VAULT" }, 255],
  getFeeRecordPda: (_v: unknown, runId: Uint8Array) => [{ __runId: Buffer.from(runId).toString() }, 255],
  getVaultUsdcAta: vi.fn(async () => ({ toBase58: () => "VAULT_ATA" })),
  runIdToBytes: (s: string) => Buffer.from(s),
  USDC_DECIMALS: 6,
}));

import { getFunctionName } from "convex/server";
import { sweepAgentTabOnchain, planFeeChunks, ONCHAIN_FEE_EXCEEDS_CAP_TERMINAL, ONCHAIN_FEE_TREASURY_MISCONFIG_TERMINAL } from "./vaultSweep";

/** Dispatch the two `convex.query` refs the custodial path uses: agentAccount.get
 *  (returns the vault flags) and influencers.getByMintServer (returns the agent's
 *  custodial wallet + encrypted secret). */
function custodialQueryDispatch(overrides?: { vaultEnabled?: boolean; agentWallet?: string | null; agentWalletSecret?: string | null }) {
  return async (ref: unknown) => {
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    if (name === "agentAccount:get") return { vaultEnabled: overrides?.vaultEnabled ?? false };
    if (name === "influencers:getByMintServer") {
      return {
        agentWallet: overrides?.agentWallet === undefined ? "AGENT_WALLET" : overrides.agentWallet,
        agentWalletSecret: overrides?.agentWalletSecret === undefined ? "enc-secret" : overrides.agentWalletSecret,
      };
    }
    return null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.queryMock.mockResolvedValue({ vaultEnabled: true, vaultAgentId: "aa".repeat(32) });
  h.fetchVaultMock.mockResolvedValue({ maxFeePerRun: 5_000_000 }); // 5 USDC cap (base units)
  h.getAccountInfoMock.mockResolvedValue(null);                    // FeeRecord absent by default
  h.getTokenAccountBalanceMock.mockResolvedValue({ value: { amount: "100000000" } });
  h.debitFeeTxMock.mockImplementation(async ({ runId }: { runId: string }) => `sig-${runId}`);
  h.transferUsdcMock.mockResolvedValue({ ok: true, txSignature: "CUSTODIAL_SIG", lastValidBlockHeight: 999 });
  h.feePayerReadyMock.mockResolvedValue(true);
  h.ensureGasMock.mockResolvedValue({ ok: true, swapped: false });
});

describe("planFeeChunks (HIGH-1 cap-aware split)", () => {
  it("splits a >cap amount into ceil(amount/cap) chunks each <=cap, summing exactly", () => {
    const chunks = planFeeChunks(12, 5);
    expect(chunks).toEqual([5, 5, 2]);
    expect(chunks.length).toBe(Math.ceil(12 / 5));
    expect(chunks.every((c) => c <= 5)).toBe(true);
    expect(chunks.reduce((a, b) => a + b, 0)).toBeCloseTo(12, 6);
  });
  it("keeps a <=cap amount (and an exact multiple) as full chunks", () => {
    expect(planFeeChunks(4, 5)).toEqual([4]);
    expect(planFeeChunks(5, 5)).toEqual([5]);
    expect(planFeeChunks(10, 5)).toEqual([5, 5]); // two clip runs > $5, $10 daily cap
  });
  it("handles fractional remainders with no base-unit drift", () => {
    const chunks = planFeeChunks(5.5, 5);
    expect(chunks).toEqual([5, 0.5]);
    expect(chunks.every((c) => c <= 5)).toBe(true);
    expect(chunks.reduce((a, b) => a + b, 0)).toBeCloseTo(5.5, 6);
  });
  it("returns [] for a non-positive amount", () => {
    expect(planFeeChunks(0, 5)).toEqual([]);
    expect(planFeeChunks(-1, 5)).toEqual([]);
  });
});

describe("sweepAgentTabOnchain (chunked, cap-aware, on-chain idempotency)", () => {
  // The on-chain vault route is opt-in now; these cases exercise it.
  beforeEach(() => { process.env.VELLO_VAULT_SWEEP = "1"; });
  it("defers an empty vault without submitting a transaction or charging custody", async () => {
    h.getTokenAccountBalanceMock.mockResolvedValue({ value: { amount: "0" } });
    expect(await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "empty", amountUsdc: 3 }))
      .toMatchObject({ ok: false, reason: "vault_insufficient_usdc", retryDelayMs: 1_800_000 });
    expect(h.debitFeeTxMock).not.toHaveBeenCalled();
    expect(h.transferUsdcMock).not.toHaveBeenCalled();
  });

  it("stops on rate limits without additional FeeRecord reads or transaction attempts", async () => {
    h.getAccountInfoMock.mockRejectedValueOnce(new Error("429 Too Many Requests"));
    expect(await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "rate", amountUsdc: 3 }))
      .toMatchObject({ ok: false, reason: "rpc_rate_limited" });
    expect(h.getAccountInfoMock).toHaveBeenCalledTimes(1);
    expect(h.debitFeeTxMock).not.toHaveBeenCalled();
  });

  it("skips paid chunks even with an empty vault", async () => {
    h.getAccountInfoMock.mockResolvedValue({ data: Buffer.alloc(1) });
    h.getTokenAccountBalanceMock.mockResolvedValue({ value: { amount: "0" } });
    expect((await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "paid", amountUsdc: 3 })).ok).toBe(true);
    expect(h.getTokenAccountBalanceMock).not.toHaveBeenCalled();
    expect(h.debitFeeTxMock).not.toHaveBeenCalled();
  });

  it("defers an insufficient-funds simulation race without logging a retry storm", async () => {
    h.debitFeeTxMock.mockRejectedValueOnce(new Error("Program log: Error: insufficient funds"));
    expect(await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "race", amountUsdc: 3 }))
      .toMatchObject({ ok: false, reason: "vault_insufficient_usdc", retryDelayMs: 1_800_000 });
    expect(h.debitFeeTxMock).toHaveBeenCalledTimes(1);
  });

  it("never debits when the balance cannot be read", async () => {
    h.getTokenAccountBalanceMock.mockRejectedValueOnce(new Error("RPC unavailable"));
    expect((await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "unknown", amountUsdc: 3 })).ok).toBe(false);
    expect(h.debitFeeTxMock).not.toHaveBeenCalled();
  });

  it("resumes partial settlements without charging the paid chunk again", async () => {
    h.getTokenAccountBalanceMock
      .mockResolvedValueOnce({ value: { amount: "5000000" } })
      .mockResolvedValueOnce({ value: { amount: "0" } });
    expect((await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "partial", amountUsdc: 8 })).ok).toBe(false);
    expect(h.debitFeeTxMock).toHaveBeenCalledTimes(1);
    h.getAccountInfoMock.mockImplementation(async (pk: { __runId?: string }) =>
      pk.__runId === "partial#0" ? { data: Buffer.alloc(1) } : null);
    h.getTokenAccountBalanceMock.mockResolvedValue({ value: { amount: "3000000" } });
    expect((await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "partial", amountUsdc: 8 })).ok).toBe(true);
    expect(h.debitFeeTxMock.mock.calls.map(c => c[0].runId)).toEqual(["partial#0", "partial#1"]);
  });
  it("HIGH-1: splits a >cap settlement into <=cap debit_fee chunks (runIds #0,#1,#2)", async () => {
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "s1", amountUsdc: 12 });
    expect(res.ok).toBe(true);
    expect(h.debitFeeTxMock).toHaveBeenCalledTimes(3);
    const amounts = h.debitFeeTxMock.mock.calls.map((c) => c[0].amountUsdc);
    expect(amounts).toEqual([5, 5, 2]);
    expect(amounts.every((a: number) => a <= 5)).toBe(true);
    const runIds = h.debitFeeTxMock.mock.calls.map((c) => c[0].runId);
    expect(runIds).toEqual(["s1#0", "s1#1", "s1#2"]);
    expect(res.txSignature).toBe("sig-s1#2"); // last debit that actually broadcast
  });

  it("reads the cap from the vault (does NOT hardcode 5) — a 4-USDC cap yields [4,4,2]", async () => {
    h.fetchVaultMock.mockResolvedValue({ maxFeePerRun: 4_000_000 }); // 4 USDC cap
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "s5", amountUsdc: 10 });
    expect(res.ok).toBe(true);
    const amounts = h.debitFeeTxMock.mock.calls.map((c) => c[0].amountUsdc);
    expect(amounts).toEqual([4, 4, 2]); // <= 4 each — the real cap, not the mint-time 5
  });

  it("HIGH-1 TERMINAL: a FeeExceedsCap revert with a READ cap is terminal (real over-cap, no infinite loop)", async () => {
    // Cap READ = 5, chunk = 4 (<= cap) still reverts FeeExceedsCap → the on-chain
    // cap shrank below the chunk, so it can NEVER land → terminal (not a retry loop).
    h.fetchVaultMock.mockResolvedValue({ maxFeePerRun: 5_000_000 });
    h.getAccountInfoMock.mockResolvedValue(null); // FeeRecord absent → the fee never moved
    h.debitFeeTxMock.mockRejectedValue(new Error("Error Code: FeeExceedsCap. Error Number: 6002"));

    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "s2", amountUsdc: 4 });
    expect(res.ok).toBe(true);
    expect(res.txSignature).toBe(ONCHAIN_FEE_EXCEEDS_CAP_TERMINAL);
    expect(h.debitFeeTxMock).toHaveBeenCalledTimes(1); // did not loop
  });

  it("#22: a FeeExceedsCap revert when the cap READ FAILED is TRANSIENT, not terminal (never marks an unpaid fee paid)", async () => {
    // Cap can't be read → chunk by the default (5). A FeeExceedsCap here is almost
    // certainly a chunking artifact of a transient RPC blip, so release for a safe
    // retry (ok:false) instead of terminalizing — otherwise the agent's tab is
    // marked settled (re-credited) while the treasury was never actually paid.
    h.fetchVaultMock.mockResolvedValue(null); // cap read fails
    h.getAccountInfoMock.mockResolvedValue(null); // FeeRecord absent → the fee never moved
    h.debitFeeTxMock.mockRejectedValue(new Error("Error Code: FeeExceedsCap. Error Number: 6002"));

    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "s2b", amountUsdc: 8 });
    expect(res.ok).toBe(false); // released for a safe retry, NOT terminalized
    expect(res.txSignature).not.toBe(ONCHAIN_FEE_EXCEEDS_CAP_TERMINAL);
  });

  it("MED-C: a confirm-timeout whose FeeRecord EXISTS is treated as already-swept (idempotent)", async () => {
    h.debitFeeTxMock.mockRejectedValue(new Error("Transaction was not confirmed in 30.00 seconds"));
    h.getAccountInfoMock.mockResolvedValue({ data: Buffer.alloc(1) }); // FeeRecord present → it landed
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "s3", amountUsdc: 3 });
    expect(res.ok).toBe(true);               // NOT released for retry
    expect(res.txSignature).toBeUndefined(); // nothing new broadcast — already swept
    expect(h.getAccountInfoMock).toHaveBeenCalled(); // consulted on-chain truth, not a substring
  });

  it("a transient failure (FeeRecord absent, not a cap error) returns { ok:false } for a safe retry", async () => {
    h.debitFeeTxMock.mockRejectedValue(new Error("blockhash not found"));
    h.getAccountInfoMock.mockResolvedValue(null);
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "s4", amountUsdc: 3 });
    expect(res.ok).toBe(false);
  });

  it("re-drive is per-chunk idempotent: an already-swept chunk is skipped, the rest debit", async () => {
    // Chunk #0's FeeRecord already exists (swept on a prior pass); #1 and #2 debit fresh.
    h.getAccountInfoMock.mockImplementation(async (pk: { __runId?: string }) =>
      pk?.__runId === Buffer.from("s6#0").toString() ? { data: Buffer.alloc(1) } : null,
    );
    h.debitFeeTxMock.mockImplementation(async ({ runId }: { runId: string }) => {
      if (runId === "s6#0") throw new Error("account already in use");
      return `sig-${runId}`;
    });
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "s6", amountUsdc: 12 });
    expect(res.ok).toBe(true);
    const swept = h.debitFeeTxMock.mock.calls.map((c) => c[0].runId);
    expect(swept).toContain("s6#1");
    expect(swept).toContain("s6#2");
    expect(res.txSignature).toBe("sig-s6#2");
  });
});

describe("sweepAgentTabOnchain — CUSTODIAL fallback (no vault) + no-double-spend", () => {
  beforeEach(() => { delete process.env.VELLO_VAULT_SWEEP; });
  it("(a) a no-vault agent takes the custodial transferUsdc branch and does NOT throw", async () => {
    h.queryMock.mockImplementation(custodialQueryDispatch()); // vaultEnabled:false
    h.transferUsdcMock.mockResolvedValue({ ok: true, txSignature: "CUSTODIAL_SIG" });
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "c1", amountUsdc: 3 });
    expect(res.ok).toBe(true);
    expect(res.txSignature).toBe("CUSTODIAL_SIG");
    expect(h.transferUsdcMock).toHaveBeenCalledTimes(1);
    expect(h.debitFeeTxMock).not.toHaveBeenCalled(); // never touched the vault path
  });

  it("a vault-enabled agent is also paid from its own wallet to the generation wallet, never through the vault", async () => {
    const base = custodialQueryDispatch();
    h.queryMock.mockImplementation(async (ref: unknown) => (getFunctionName(ref as Parameters<typeof getFunctionName>[0]) === "agentAccount:get" ? { vaultEnabled: true, vaultAgentId: "ab".repeat(16) } : base(ref)));
    h.transferUsdcMock.mockResolvedValue({ ok: true, txSignature: "CUSTODIAL_SIG" });
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "v1", amountUsdc: 1.25 });
    expect(res).toEqual({ ok: true, txSignature: "CUSTODIAL_SIG" });
    expect(h.debitFeeTxMock).not.toHaveBeenCalled();
    expect(h.transferUsdcMock.mock.calls[0][0].toPubkey).toBe("EhXTsbTMTgkGhBdUGAWx5JL78Jmu1dZgDCVUFWJp3pSa");
  });

  it("with no usable fee payer the agent pays its own network fee, after topping up SOL from its USDC if needed", async () => {
    h.queryMock.mockImplementation(custodialQueryDispatch());
    h.feePayerReadyMock.mockResolvedValue(false);
    h.ensureGasMock.mockResolvedValue({ ok: true, swapped: true, signature: "GAS_SWAP" });
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "g1", amountUsdc: 2 });
    expect(res.ok).toBe(true);
    expect(h.ensureGasMock).toHaveBeenCalledWith("M", 2); // the 2 USDC owed is never spent on gas
    expect(h.transferUsdcMock.mock.calls[0][0].feePayerSecretBase64).toBeUndefined();
  });

  it("releases the settlement for a retry, moving nothing, when the agent cannot get network-fee SOL", async () => {
    h.queryMock.mockImplementation(custodialQueryDispatch());
    h.feePayerReadyMock.mockResolvedValue(false);
    h.ensureGasMock.mockResolvedValue({ ok: false, reason: "usdc_too_low" });
    expect(await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "g2", amountUsdc: 2 })).toEqual({ ok: false });
    expect(h.transferUsdcMock).not.toHaveBeenCalled();
  });

  it("(b) the custodial sweep targets the generation collection wallet from the agent wallet with sponsored gas", async () => {
    h.queryMock.mockImplementation(custodialQueryDispatch());
    h.transferUsdcMock.mockResolvedValue({ ok: true, txSignature: "CUSTODIAL_SIG" });
    await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "c2", amountUsdc: 2.5 });
    const arg = h.transferUsdcMock.mock.calls[0][0];
    // toPubkey is the treasury WALLET from env; transferUsdc derives its USDC ATA —
    // the exact same account the vault (debit_fee) path targets.
    expect(arg.toPubkey).toBe("EhXTsbTMTgkGhBdUGAWx5JL78Jmu1dZgDCVUFWJp3pSa");
    expect(arg.fromPubkey).toBe("AGENT_WALLET");
    expect(arg.fromSecretBase64).toBe("decrypted:enc-secret"); // via readAgentSecret
    expect(arg.amountUsdc).toBe(2.5);
    expect(arg.feePayerSecretBase64).toBe("fee-payer-secret"); // sponsored gas (PLATFORM_FEE_PAYER_SECRET)
  });

  it("(c) a custodial confirm-timeout returns { ok:false, ambiguous:true, txSignature, lvbh } — NEVER a plain releasable result", async () => {
    h.queryMock.mockImplementation(custodialQueryDispatch());
    h.transferUsdcMock.mockResolvedValue({
      ok: false, txSignature: "AMBIG_SIG", lastValidBlockHeight: 12345, step: "confirm-timeout", error: "not confirmed",
    });
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "c3", amountUsdc: 3 });
    expect(res.ok).toBe(false);
    expect(res.ambiguous).toBe(true);           // the caller must stamp confirm-ambiguous, NOT release
    expect(res.txSignature).toBe("AMBIG_SIG");
    expect(res.lastValidBlockHeight).toBe(12345); // blockhash-expiry proof for the keeper
  });

  it("(d) a custodial PRE-broadcast failure (no sig) is a plain releasable { ok:false } (no ambiguous, no sig)", async () => {
    h.queryMock.mockImplementation(custodialQueryDispatch());
    h.transferUsdcMock.mockResolvedValue({ ok: false, error: "insufficient SOL for fees", step: "fees" });
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "c4", amountUsdc: 3 });
    expect(res.ok).toBe(false);
    expect(res.ambiguous).toBeUndefined(); // nothing moved → safe to release + retry
    expect(res.txSignature).toBeUndefined();
  });

  it("throws (caller releases) when the agent has NEITHER a vault NOR a custodial wallet secret", async () => {
    h.queryMock.mockImplementation(custodialQueryDispatch({ agentWalletSecret: null }));
    await expect(sweepAgentTabOnchain({ mintAddress: "M", settlementId: "c4b", amountUsdc: 3 })).rejects.toThrow(/cannot sweep compute tab/);
    expect(h.transferUsdcMock).not.toHaveBeenCalled();
  });

  it("(f) an InvalidTreasury debit_fee revert (vault path) is TERMINAL + alerted, not the retry-releasing loop", async () => {
    process.env.VELLO_VAULT_SWEEP = "1";
    // vaultEnabled:true (default) → the vault path. The env-rotation strand: the
    // treasury ATA no longer matches the vault's configured treasury → 0x1775.
    h.getAccountInfoMock.mockResolvedValue(null); // FeeRecord absent → the fee never moved
    h.debitFeeTxMock.mockRejectedValue(
      new Error("Error Code: InvalidTreasury. Error Number: 6005. custom program error: 0x1775"),
    );
    const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: "c5", amountUsdc: 3 });
    expect(res.ok).toBe(true); // terminal-marked, NOT { ok:false } (which loops forever)
    expect(res.txSignature).toBe(ONCHAIN_FEE_TREASURY_MISCONFIG_TERMINAL);
    expect(h.sendAlertMock).toHaveBeenCalledWith(
      "compute-sweep-terminal-misconfig",
      expect.objectContaining({ settlementId: "c5", mint: "M" }),
    );
    expect(h.debitFeeTxMock).toHaveBeenCalledTimes(1); // did not loop
  });

  it("(f') Unauthorized / MintMismatch debit_fee reverts are likewise terminal + alerted", async () => {
    process.env.VELLO_VAULT_SWEEP = "1";
    for (const [i, msg] of [
      "Error Code: Unauthorized. Error Number: 6003. custom program error: 0x1773",
      "Error Code: MintMismatch. Error Number: 6004. custom program error: 0x1774",
    ].entries()) {
      vi.clearAllMocks();
      h.queryMock.mockResolvedValue({ vaultEnabled: true, vaultAgentId: "aa".repeat(32) });
      h.fetchVaultMock.mockResolvedValue({ maxFeePerRun: 5_000_000 });
      h.getAccountInfoMock.mockResolvedValue(null);
      h.debitFeeTxMock.mockRejectedValue(new Error(msg));
      const res = await sweepAgentTabOnchain({ mintAddress: "M", settlementId: `c6-${i}`, amountUsdc: 3 });
      expect(res.ok).toBe(true);
      expect(res.txSignature).toBe(ONCHAIN_FEE_TREASURY_MISCONFIG_TERMINAL);
      expect(h.sendAlertMock).toHaveBeenCalledTimes(1);
    }
  });
});
