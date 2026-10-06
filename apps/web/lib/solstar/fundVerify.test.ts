import { describe, expect, it } from "vitest";
import { verifyFundingTx, type ParsedFundingTx } from "./fundVerify";

const o = { payer: "PAYER", treasury: "TREASURY", feeWallet: "FEE" };
const t = (source: string, destination: string, lamports: number) => ({ program: "system", parsed: { type: "transfer", info: { source, destination, lamports } } });
const tx = (ixs: ReturnType<typeof t>[], err: unknown = null, payer = "PAYER"): ParsedFundingTx => ({
  meta: { err },
  transaction: { message: { accountKeys: [{ pubkey: payer, signer: true }], instructions: ixs } },
});

describe("verifyFundingTx", () => {
  it("accepts 97/3 and credits the treasury leg", () => {
    expect(verifyFundingTx(tx([t("PAYER", "TREASURY", 970), t("PAYER", "FEE", 30)]), o)).toEqual({ ok: true, netLamports: 970n, feeLamports: 30n });
  });
  it("rejects a missing or short fee", () => {
    expect(verifyFundingTx(tx([t("PAYER", "TREASURY", 1000)]), o)).toEqual({ ok: false, reason: "fee_missing" });
    expect(verifyFundingTx(tx([t("PAYER", "TREASURY", 980), t("PAYER", "FEE", 20)]), o)).toEqual({ ok: false, reason: "fee_missing" });
  });
  it("rejects failed tx, wrong signer, no treasury leg", () => {
    expect(verifyFundingTx(tx([t("PAYER", "TREASURY", 970), t("PAYER", "FEE", 30)], { InstructionError: 1 }), o)).toEqual({ ok: false, reason: "tx_failed" });
    expect(verifyFundingTx(tx([t("PAYER", "TREASURY", 970), t("PAYER", "FEE", 30)], null, "OTHER"), o)).toEqual({ ok: false, reason: "wrong_signer" });
    expect(verifyFundingTx(tx([t("PAYER", "FEE", 30)]), o)).toEqual({ ok: false, reason: "no_treasury_transfer" });
  });
  it("ignores transfers not sent by the payer", () => {
    expect(verifyFundingTx(tx([t("X", "TREASURY", 970), t("PAYER", "FEE", 30)]), o)).toEqual({ ok: false, reason: "no_treasury_transfer" });
  });
});
