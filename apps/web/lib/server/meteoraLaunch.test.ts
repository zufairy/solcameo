// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { dbcReadiness } from "./meteoraLaunch";
afterEach(() => vi.unstubAllEnvs());
describe("Meteora launch configuration", () => {
  it("allows devnet without enabling mainnet", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "devnet");
    vi.stubEnv("INTERNAL_CRON_SECRET", "test-secret");
    vi.stubEnv("SOLCAMEO_DBC_LIVE_ENABLED", "false");
    expect(dbcReadiness()).toMatchObject({ ready: true, network: "devnet" });
  });
  it("identifies the missing secret on devnet without requesting a mainnet flag", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "devnet");
    vi.stubEnv("INTERNAL_CRON_SECRET", "");
    const result = dbcReadiness();
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("INTERNAL_CRON_SECRET");
    expect(result.reason).not.toContain("DBC_LIVE_ENABLED");
  });
  it("keeps mainnet gated", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_NETWORK", "mainnet-beta");
    vi.stubEnv("INTERNAL_CRON_SECRET", "test-secret");
    vi.stubEnv("SOLCAMEO_DBC_LIVE_ENABLED", "false");
    expect(dbcReadiness().ready).toBe(false);
    expect(dbcReadiness().reason).toContain("SOLCAMEO_DBC_LIVE_ENABLED=true");
  });
});
