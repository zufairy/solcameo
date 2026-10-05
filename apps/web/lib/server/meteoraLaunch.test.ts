// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DBC } from "@/lib/meteora/options";
import {
  readDbcReceipt,
  signDbcReceipt,
  type DbcReceipt,
} from "./meteoraLaunch";
afterEach(() => vi.unstubAllEnvs());
describe("DBC launch receipts", () => {
  it("binds a launch to its wallet, network, exact message, and expiry", () => {
    vi.stubEnv("INTERNAL_CRON_SECRET", "test-receipt-key");
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "devnet");
    const r: DbcReceipt = {
      protocol: "meteora-dbc",
      wallet: "owner",
      characterId: "character",
      mint: "mint",
      config: "config",
      uri: "https://example.com/meta",
      options: DEFAULT_DBC,
      network: "devnet",
      stage: "config",
      messageHash: "reviewed-message",
      expires: Date.now() + 60000,
    };
    const signed = signDbcReceipt(r);
    expect(readDbcReceipt(signed, "owner")).toEqual(r);
    expect(() => readDbcReceipt(signed, "other")).toThrow();
    expect(() => readDbcReceipt(signed + "x", "owner")).toThrow();
    expect(() =>
      readDbcReceipt(signDbcReceipt({ ...r, expires: 0 }), "owner"),
    ).toThrow();
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "mainnet-beta");
    expect(() => readDbcReceipt(signed, "owner")).toThrow();
  });
});
