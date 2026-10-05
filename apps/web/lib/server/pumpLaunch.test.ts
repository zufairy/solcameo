import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { DEFAULT_LAUNCH, launchOptionsSchema, rewardSplit, revenueExample } from "../pump/economics";
import { pumpMessageHash, pumpReadiness, pumpShareholders, readPumpReceipt, signPumpReceipt, unsignedPumpTransaction, verifyPumpTransaction, type PumpReceipt } from "./pumpLaunch";
import { pumpSharingInstructions } from "./pumpInstructions";
const owner = Keypair.generate().publicKey.toBase58(), ops = Keypair.generate().publicKey.toBase58();
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("Pump economics and reviewed transaction protection", () => {
  it("splits only creator rewards and removes creator income in holder mode", () => {
    expect(rewardSplit(DEFAULT_LAUNCH)).toEqual({ platform: 1000, ai: 3500, creator: 5500, holders: 0 });
    expect(revenueExample(DEFAULT_LAUNCH)).toEqual({ platform: 10, ai: 35, creator: 55, holders: 0 });
    for (const aiBps of [0,3500,9000]) expect(Object.values(rewardSplit({ ...DEFAULT_LAUNCH, aiBps })).reduce((a,b) => a+b,0)).toBe(10000);
    expect(rewardSplit({ ...DEFAULT_LAUNCH, rewards: "holders" })).toEqual({ platform: 0, ai: 0, creator: 0, holders: 10000 });
    expect(launchOptionsSchema.safeParse({ aiBps: 9001 }).success).toBe(false);
    expect(launchOptionsSchema.safeParse({ postingBudgetUsdc: -1 }).success).toBe(false);
  });
  it("combines duplicate fee recipients without changing the fee total", () => {
    vi.stubEnv("SOLCAMEO_PLATFORM_WALLET", owner);
    const shares = pumpShareholders({ ...DEFAULT_LAUNCH, operationsWallet: ops }, owner);
    expect(shares).toHaveLength(2);
    expect(shares.find(s => s.address.toBase58() === owner)?.shareBps).toBe(6500);
  });
  it("fails closed for unconfigured mainnet", () => {
    vi.stubEnv("SOLCAMEO_PUMP_LIVE_ENABLED", "false"); expect(pumpReadiness().ready).toBe(false);
    vi.stubEnv("SOLCAMEO_PUMP_LIVE_ENABLED", "true"); vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "devnet"); expect(pumpReadiness().ready).toBe(false);
  });
  it("binds launch receipts to wallet, reviewed message, and expiry", () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", "unit-test-key");
    const receipt: PumpReceipt = { wallet: owner, characterId: "character1", mint: ops, options: DEFAULT_LAUNCH, stage: "launch", messageHash: "expected-message", expires: Date.now() + 1000 };
    const token = signPumpReceipt(receipt); expect(readPumpReceipt(token, owner)).toEqual(receipt);
    expect(() => readPumpReceipt(token, ops)).toThrow(); expect(() => readPumpReceipt(token + "x", owner)).toThrow();
    vi.useFakeTimers(); vi.advanceTimersByTime(1001); expect(() => readPumpReceipt(token, owner)).toThrow();
  });
  it("rejects failed or substituted on-chain transactions", async () => {
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: new Keypair().publicKey, recentBlockhash: ops, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 })] }).compileToV0Message());
    const receipt = { messageHash: pumpMessageHash(tx) } as PumpReceipt;
    const getTransaction = vi.fn().mockResolvedValue({ meta: { err: null }, transaction: { message: tx.message } });
    const connection = { getTransaction } as unknown as Parameters<typeof verifyPumpTransaction>[0];
    await expect(verifyPumpTransaction(connection, "1".repeat(88), receipt)).resolves.toBeUndefined();
    await expect(verifyPumpTransaction(connection, "1".repeat(88), { ...receipt, messageHash: "other" })).rejects.toThrow("does not match");
    getTransaction.mockResolvedValue({ meta: { err: "reverted" }, transaction: { message: tx.message } });
    await expect(verifyPumpTransaction(connection, "1".repeat(88), receipt)).rejects.toThrow("not confirmed");
  });
  it("builds official SDK sharing instructions and checks packet limits before launch", async () => {
    vi.stubEnv("SOLCAMEO_PLATFORM_WALLET", Keypair.generate().publicKey.toBase58());
    const mint = Keypair.generate().publicKey.toBase58();
    const connection = { getLatestBlockhash: async () => ({ blockhash: owner }) } as unknown as Parameters<typeof unsignedPumpTransaction>[0];
    for (const pair of ["SOL", "USDC"] as const) {
      const instructions = await pumpSharingInstructions(owner, mint, { ...DEFAULT_LAUNCH, pair, operationsWallet: ops, postingBudgetUsdc: 25 });
      expect(instructions).toHaveLength(4);
      const prepared = await unsignedPumpTransaction(connection, Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey, instructions);
      expect(prepared.tx.serialize().length).toBeLessThanOrEqual(1232);
    }
  });
});
