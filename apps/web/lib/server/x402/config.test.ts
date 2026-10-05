// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { x402Config, permittedRequirement, SOLANA_DEVNET, DEVNET_USDC } from "./config";
const wallet = "So11111111111111111111111111111111111111112";
afterEach(() => vi.unstubAllEnvs());
function config() {
  vi.stubEnv("X402_ENABLED", "true"); vi.stubEnv("X402_NETWORK", SOLANA_DEVNET);
  vi.stubEnv("X402_PAY_TO", wallet); vi.stubEnv("X402_FACILITATOR_URL", "https://facilitator.example");
  return x402Config();
}
describe("x402 fail-closed policy", () => {
  it("supports explicit Solana v2 only", () => {
    const c = config(); expect(c.asset).toBe(DEVNET_USDC);
    vi.stubEnv("X402_NETWORK", "solana-devnet"); expect(x402Config).toThrow("supported");
  });
  it("is disabled without operator activation", () => {
    config(); vi.stubEnv("X402_ENABLED", "false"); expect(x402Config).toThrow("disabled");
  });
  it("rejects every alternate payment destination, amount, asset and scheme", () => {
    const c = config(); const r = {scheme:"exact", network:c.network, asset:c.asset, payTo:c.payTo, amount:"10000", maxTimeoutSeconds:60, extra:{}};
    expect(permittedRequirement(r,c,10000)).toBe(true);
    for (const change of [{payTo:"attacker"}, {asset:"other"}, {scheme:"upto"}, {amount:"10001"}, {amount:"-1"}, {amount:"NaN"}, {maxTimeoutSeconds:300}]) expect(permittedRequirement({...r,...change},c,10000)).toBe(false);
    expect(permittedRequirement(r,c,NaN)).toBe(false); expect(permittedRequirement(r,c,9999)).toBe(false);
  });
});
