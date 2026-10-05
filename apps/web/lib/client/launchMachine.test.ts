import { describe, it, expect } from "vitest";
import {
  decideBeforeSign,
  decideAfterSignError,
  campaignDeadlineError,
  classifyLaunchError,
  describeSolShortfall,
  CAMPAIGN_MIN_DURATION_MS,
  CAMPAIGN_MAX_DURATION_MS,
} from "./launchMachine";

describe("decideBeforeSign", () => {
  it("skips funding when the vault already holds the budget (timeout-but-landed)", () => {
    expect(decideBeforeSign({ vaultFunded: true, funding: { ok: false, needUsdc: true, needSol: false } }))
      .toEqual({ action: "skip-funding-finalize" });
  });
  it("routes to fund-wallet on a USDC shortfall", () => {
    expect(decideBeforeSign({ vaultFunded: false, funding: { ok: false, needUsdc: true, needSol: false } }))
      .toEqual({ action: "fund-wallet", reason: "usdc" });
  });
  it("routes to fund-wallet on a SOL shortfall", () => {
    expect(decideBeforeSign({ vaultFunded: false, funding: { ok: false, needUsdc: false, needSol: true } }))
      .toEqual({ action: "fund-wallet", reason: "sol" });
  });
  it("signs when funded-enough and vault empty", () => {
    expect(decideBeforeSign({ vaultFunded: false, funding: { ok: true, needUsdc: false, needSol: false } }))
      .toEqual({ action: "sign-escrow" });
  });
});

describe("decideAfterSignError", () => {
  it("finalizes if the vault turns out funded after a thrown/timeout", () => {
    expect(decideAfterSignError({ vaultFundedAfter: true })).toEqual({ action: "skip-funding-finalize" });
  });
  it("errors (never re-charges) if the vault is still empty", () => {
    expect(decideAfterSignError({ vaultFundedAfter: false })).toEqual({ action: "error", reason: "deposit-unconfirmed" });
  });
});

// The on-chain create_campaign bounds the deadline to
// [now + MIN_CAMPAIGN_DURATION_SECS (6h), now + MAX_CAMPAIGN_DURATION_SECS (365d)]
// and reverts InvalidDeadline (6002) outside that window. The form must reject
// BOTH ends before the wallet prompt — a too-far deadline (e.g. 2029) otherwise
// reverts on-chain, which the wallet surfaces as a misleading "not enough SOL /
// failed to simulate".
describe("campaignDeadlineError", () => {
  const NOW = Date.UTC(2026, 6, 2, 12, 0, 0); // 2026-07-02T12:00:00Z

  it("accepts a deadline comfortably inside the window (30 days out)", () => {
    expect(campaignDeadlineError(NOW + 30 * 24 * 60 * 60 * 1000, NOW)).toBeNull();
  });

  it("rejects a deadline sooner than the 6h program minimum", () => {
    const err = campaignDeadlineError(NOW + 60 * 60 * 1000, NOW); // 1h out
    expect(err).toMatch(/6 hours|minimum/i);
  });

  it("rejects a deadline past the 1-year program maximum (the 2029 bug)", () => {
    const yr2029 = Date.UTC(2029, 11, 12, 0, 0, 0);
    const err = campaignDeadlineError(yr2029, NOW);
    expect(err).toMatch(/1 year|maximum/i);
  });

  it("rejects an unparseable/NaN deadline", () => {
    expect(campaignDeadlineError(NaN, NOW)).toBeTruthy();
  });

  it("accepts exactly the min boundary and rejects just under it", () => {
    expect(campaignDeadlineError(NOW + CAMPAIGN_MIN_DURATION_MS, NOW)).toBeNull();
    expect(campaignDeadlineError(NOW + CAMPAIGN_MIN_DURATION_MS - 1000, NOW)).toBeTruthy();
  });

  it("accepts exactly the max boundary and rejects just over it", () => {
    expect(campaignDeadlineError(NOW + CAMPAIGN_MAX_DURATION_MS, NOW)).toBeNull();
    expect(campaignDeadlineError(NOW + CAMPAIGN_MAX_DURATION_MS + 1000, NOW)).toBeTruthy();
  });

  it("exposes bounds that match the on-chain constants (6h / 365d)", () => {
    expect(CAMPAIGN_MIN_DURATION_MS).toBe(6 * 60 * 60 * 1000);
    expect(CAMPAIGN_MAX_DURATION_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });
});

// After createCampaignTx throws, a DETERMINISTIC on-chain constraint revert must
// NOT be surfaced as "click Launch again" (it will fail identically forever) —
// the user must fix the input. A transient timeout/network throw stays retry-safe.
describe("classifyLaunchError", () => {
  it("marks an InvalidDeadline revert deterministic with an actionable, jargon-free message", () => {
    const r = classifyLaunchError(
      "AnchorError thrown in programs/vello-escrow/src/lib.rs:163. Error Code: InvalidDeadline. Error Number: 6002. Error Message: Campaign deadline must be in the future.",
    );
    expect(r.deterministic).toBe(true);
    expect(r.message).toMatch(/deadline/i);
    expect(r.message).not.toMatch(/AnchorError|lib\.rs|Error Number/);
  });

  it("marks an InvalidAmount revert deterministic", () => {
    expect(classifyLaunchError("Error Code: InvalidAmount").deterministic).toBe(true);
  });

  it("marks other AnchorError constraint reverts deterministic (retry won't help)", () => {
    expect(classifyLaunchError("AnchorError: Error Code: ConstraintSeeds").deterministic).toBe(true);
  });

  it("treats a confirmation timeout as transient (retry-safe)", () => {
    const r = classifyLaunchError("Transaction was not confirmed in 30.00 seconds");
    expect(r.deterministic).toBe(false);
  });

  it("marks an 'account already in use' revert deterministic (campaign already created — don't loop 'click again')", () => {
    // A landed-but-timed-out first attempt leaves the campaign PDA initialized. A
    // retry re-inits it → System-Program "already in use". Looping "click Launch
    // again" never helps; guide the user to resume the existing campaign instead.
    const r = classifyLaunchError("failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: account already in use");
    expect(r.deterministic).toBe(true);
    expect(r.message).toMatch(/already.*(created|funded|launch)|resume/i);
    expect(r.message).not.toMatch(/click Launch again/i);
  });

  it("treats an empty/unknown error as transient (retry-safe, never blocks a landed deposit)", () => {
    expect(classifyLaunchError("").deterministic).toBe(false);
  });
});

// A 0-SOL wallet can't pay gas for create_campaign. Instead of a dead-end "top up
// SOL" message, give the amount, the exact wallet address to fund, and a
// network-aware way to get SOL (devnet faucet vs mainnet exchange withdrawal).
describe("describeSolShortfall", () => {
  const ADDR = "GvrTJiAp5yRyaP97CZhTbZzntib9dxNzg6Y5vuXd2nET";

  it("names an amount, the wallet address, and a devnet faucet hint on devnet", () => {
    const m = describeSolShortfall({ network: "devnet", walletAddress: ADDR });
    expect(m).toMatch(/SOL/);
    expect(m).toContain(ADDR);
    expect(m).toMatch(/faucet/i);
    expect(m).toMatch(/0\.0\d/); // a concrete small amount
  });

  it("gives an exchange-withdrawal hint (no faucet) on mainnet", () => {
    const m = describeSolShortfall({ network: "mainnet-beta", walletAddress: ADDR });
    expect(m).toContain(ADDR);
    expect(m).toMatch(/exchange|withdraw|buy/i);
    expect(m).not.toMatch(/faucet/i);
  });

  it("still returns actionable copy when the address is missing", () => {
    const m = describeSolShortfall({ network: "devnet", walletAddress: "" });
    expect(m).toMatch(/SOL/);
    expect(m.length).toBeGreaterThan(0);
  });
});
