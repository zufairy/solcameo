import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ statuses: [] as unknown[], height: 100, sends: 0, slowPrimary: false }));
vi.mock("@solana/web3.js", async () => {
  const real = await vi.importActual<typeof import("@solana/web3.js")>("@solana/web3.js");
  class Connection {
    constructor(private url: string) {}
    async getSignatureStatuses() {
      if (h.slowPrimary && this.url === "https://slow.test") return new Promise<never>(() => {});
 return { value: [h.statuses.length > 1 ? h.statuses.shift() : h.statuses[0]] }; }
    async sendRawTransaction() { h.sends++; return "sig"; }
    async getBlockHeight() { return h.height; }
    async getRecentPrioritizationFees() { return [{ prioritizationFee: 0 }, { prioritizationFee: 4000 }, { prioritizationFee: 9000 }]; }
  }
  return { ...real, Connection };
});
vi.mock("./network", () => ({ getNetwork: () => "mainnet-beta", getHeliusRpcUrl: () => "", getRpcUrl: () => "https://rpc.test" }));
import { boundedPriorityPrice, estimatePriorityPrice, landTransaction } from "./landTransaction";

afterEach(() => { vi.useRealTimers(); h.statuses = []; h.height = 100; h.sends = 0; h.slowPrimary = false; });
const args = { raw: new Uint8Array([1]), signature: "sig", lastValidBlockHeight: 150, urls: ["https://rpc.test"] };

describe("landTransaction", () => {
  it("confirms through a healthy backup without waiting for a hung primary", async () => {
    vi.useFakeTimers();
    h.slowPrimary = true;
    h.statuses = [{ confirmationStatus: "confirmed", err: null }];
    expect(await landTransaction({ ...args, urls: ["https://slow.test", "https://rpc.test"] })).toBe("confirmed");
  });
  it("does not let a stale null response hide a confirmed payment on another node", async () => {
    h.statuses = [null, { confirmationStatus: "confirmed", err: null }];
    expect(await landTransaction({ ...args, urls: ["https://stale.test", "https://rpc.test"] })).toBe("confirmed");
    expect(h.sends).toBe(0);
  });
  it("keeps an included transaction pending after blockhash expiry instead of allowing repayment", async () => {
    h.statuses = [{ confirmationStatus: "processed", err: null }];
    h.height = 151;
    expect(await landTransaction(args)).toBe("pending");
  });
  it("does not call an errored last-slot transaction expired", async () => {
    h.statuses = [null, { confirmationStatus: "confirmed", err: { InstructionError: [0, "Custom"] } }];
    h.height = 151;
    await expect(landTransaction(args)).rejects.toThrow(/failed on-chain/);
  });

  it("confirms as soon as the transaction shows up, without waiting for the timeout", async () => {
    h.statuses = [null, { confirmationStatus: "confirmed", err: null }];
    expect(await landTransaction(args)).toBe("confirmed");
  });
  it("re-broadcasts the same signed bytes while it waits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    h.statuses = [null, null, null, null, null, { confirmationStatus: "finalized", err: null }];
    const run = landTransaction(args);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await run).toBe("confirmed");
    expect(h.sends).toBeGreaterThanOrEqual(2);
  });
  it("reports 'expired' (nothing was deducted) once the blockhash window has passed without it landing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    h.statuses = [null];
    h.height = 151;
    const run = landTransaction(args);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await run).toBe("expired");
  });
  it("throws when the transaction landed and failed", async () => {
    h.statuses = [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }];
    await expect(landTransaction(args)).rejects.toThrow(/failed on-chain/);
  });
});

describe("priority fee", () => {
  it("uses the median recent fee, within a hard ceiling, and never throws", async () => {
    const price = await estimatePriorityPrice(["a", "b"], 90_000);
    expect(price).toBe(boundedPriorityPrice(9000, 90_000)); // median of the non-zero fees
    expect(boundedPriorityPrice(5_000_000_000, 90_000) * 90_000 / 1_000_000).toBeLessThanOrEqual(20_000); // lamports
    expect(boundedPriorityPrice(0, 90_000)).toBe(1_000);
  });
});
