import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, Transaction } from "@solana/web3.js";

const h = vi.hoisted(() => ({ balance: vi.fn(), account: vi.fn(), send: vi.fn(), rent: vi.fn(), priority: vi.fn(), land: vi.fn() }));
vi.mock("@/lib/solana/network", () => ({ getNetwork: () => "devnet", getUsdcMint: () => "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" }));
vi.mock("@/lib/solana/failoverConnection", () => ({ failoverConnection: () => ({ getBalance: h.balance, getMinimumBalanceForRentExemption: h.rent, sendRawTransaction: h.send, getLatestBlockhash: async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 99 }) }) }));
vi.mock("@solana/spl-token", async () => ({ ...await vi.importActual<typeof import("@solana/spl-token")>("@solana/spl-token"), getAccount: h.account }));
vi.mock("@/lib/solana/landTransaction", async () => ({ ...await vi.importActual<typeof import("@/lib/solana/landTransaction")>("@/lib/solana/landTransaction"), estimatePriorityPrice: h.priority, landTransaction: h.land }));
import { transferUsdc } from "./usdcTransfer";
const agent = Keypair.generate();
const recipient = Keypair.generate();
const opts = { fromSecretBase64: Buffer.from(agent.secretKey).toString("base64"), fromPubkey: agent.publicKey.toBase58(), toPubkey: recipient.publicKey.toBase58(), amountUsdc: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  h.balance.mockResolvedValue(100_000);
  h.account.mockResolvedValue({ amount: 10_000_000n });
  h.priority.mockResolvedValue(1000);
  h.rent.mockResolvedValue(2_039_280);
  h.send.mockResolvedValue("sig");
  h.land.mockResolvedValue("confirmed");
});

describe("USDC transfer fee payer", () => {
  it("signs with the funded agent as the only fee payer", async () => {
    expect((await transferUsdc(opts)).ok).toBe(true);
    const tx = Transaction.from(h.send.mock.calls[0][0]);
    expect(tx.feePayer!.equals(agent.publicKey)).toBe(true);
    expect(tx.signatures).toHaveLength(1);
    expect(h.rent).not.toHaveBeenCalled();
  });
  it("checks priority fees before broadcasting", async () => {
    h.balance.mockResolvedValue(5000);
    expect(await transferUsdc(opts)).toMatchObject({ ok: false, step: "fees" });
    expect(h.send).not.toHaveBeenCalled();
  });
  it("checks ATA rent before broadcasting to a new recipient", async () => {
    const { TokenAccountNotFoundError } = await import("@solana/spl-token");
    h.account.mockRejectedValueOnce(new TokenAccountNotFoundError());
    expect(await transferUsdc(opts)).toMatchObject({ ok: false, step: "fees" });
    expect(h.rent).toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
});
