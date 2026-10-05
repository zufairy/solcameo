import { afterEach, expect, it, vi } from "vitest";
import { readTradeReceipt, signTradeReceipt } from "./dbcTradeReceipt";
afterEach(() => vi.unstubAllEnvs());
it("binds the reviewed swap to its wallet, message and expiration", () => {
  vi.stubEnv("INTERNAL_CRON_SECRET", "testing-key");
  const r = {
    wallet: "owner",
    characterId: "coin",
    hash: "exact-message",
    side: "buy" as const,
    amount: "10000",
    expires: Date.now() + 60000,
  };
  const signed = signTradeReceipt(r);
  expect(readTradeReceipt(signed, "owner")).toEqual(r);
  expect(() => readTradeReceipt(signed, "other")).toThrow();
  expect(() => readTradeReceipt(signed + "modified", "owner")).toThrow();
  const expired = signTradeReceipt({ ...r, expires: 1 });
  expect(() => readTradeReceipt(expired, "owner")).toThrow();
  expect(readTradeReceipt(expired, "owner", true).hash).toBe(r.hash);
});

it("rejects a receipt on a different Solana cluster", () => {
  vi.stubEnv("INTERNAL_CRON_SECRET", "test");
  const token = signTradeReceipt({
    wallet: "owner",
    characterId: "c",
    hash: "h",
    side: "buy",
    amount: "1",
    expires: Date.now() + 1000,
    network: "mainnet",
  });
  expect(() => readTradeReceipt(token, "owner", false, "devnet")).toThrow();
  expect(readTradeReceipt(token, "owner", false, "mainnet").network).toBe(
    "mainnet",
  );
});
