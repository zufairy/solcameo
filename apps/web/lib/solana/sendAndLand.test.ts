import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, MessageV0, VersionedTransaction, SystemProgram, PublicKey } from "@solana/web3.js";

const h = vi.hoisted(() => ({ rpcTry: vi.fn(), land: vi.fn() }));
vi.mock("./rpc", () => ({ rpcTry: h.rpcTry, rpcCandidates: () => ["https://rpc.test"] }));
vi.mock("./landTransaction", () => ({ computeBudgetInstructions: () => [], estimatePriorityPrice: async () => 1000, landTransaction: h.land }));
import { sendAndLand } from "./fundWallet";

function signedTx() {
  const kp = Keypair.generate();
  const msg = MessageV0.compile({ payerKey: kp.publicKey, instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey("11111111111111111111111111111111"), lamports: 1 })], recentBlockhash: "11111111111111111111111111111111" });
  const tx = new VersionedTransaction(msg);
  tx.sign([kp]);
  return tx;
}

beforeEach(() => { h.rpcTry.mockReset(); h.land.mockReset(); });

describe("sendAndLand", () => {
  it("sends once with preflight, then keeps re-broadcasting until it confirms", async () => {
    h.rpcTry.mockResolvedValue("sig");
    h.land.mockResolvedValue("confirmed");
    const out = await sendAndLand(signedTx(), 12345);
    expect(out.result).toBe("confirmed");
    expect(out.signature.length).toBeGreaterThan(60);
    expect(h.land.mock.calls[0][0]).toMatchObject({ lastValidBlockHeight: 12345, signature: out.signature });
  });
  it("reports an expired blockhash as nothing swapped", async () => {
    h.rpcTry.mockResolvedValue("sig");
    h.land.mockResolvedValue("expired");
    expect((await sendAndLand(signedTx(), 1)).result).toBe("expired");
  });
  it("turns a slippage revert at preflight into a readable message", async () => {
    h.rpcTry.mockRejectedValue(new Error("Simulation failed: custom program error: 0x1771"));
    await expect(sendAndLand(signedTx(), 1)).rejects.toThrow(/price moved/);
  });
  it("treats an already-processed send as landed and goes on to confirm it", async () => {
    h.rpcTry.mockRejectedValue(new Error("This transaction has already been processed"));
    h.land.mockResolvedValue("confirmed");
    expect((await sendAndLand(signedTx(), 1)).result).toBe("confirmed");
  });
});
