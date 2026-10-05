import { describe, it, expect } from "vitest";
import { priceLamportsPerToken, marketCapLamports, changeSinceLaunchBps } from "./market";
import { PAPER_VIRTUAL_SOL, PAPER_VIRTUAL_TOKENS } from "./economics";

const launch = { solReserve: PAPER_VIRTUAL_SOL, tokenReserve: PAPER_VIRTUAL_TOKENS };

describe("market math", () => {
  it("launch price is 30 lamports per whole token and market cap 30 SOL", () => {
    expect(priceLamportsPerToken(launch)).toBe(30n);
    expect(marketCapLamports(launch, PAPER_VIRTUAL_TOKENS)).toBe(30_000_000_000n);
  });
  it("price rises after SOL is added to the pool", () => {
    const after = { solReserve: PAPER_VIRTUAL_SOL + 5_000_000_000n, tokenReserve: PAPER_VIRTUAL_TOKENS - 100_000_000_000_000n };
    expect(priceLamportsPerToken(after) > 30n).toBe(true);
  });
  it("change since launch is signed basis points", () => {
    expect(changeSinceLaunchBps(30n, 30n)).toBe(0n);
    expect(changeSinceLaunchBps(30n, 60n)).toBe(10_000n);
    expect(changeSinceLaunchBps(30n, 15n)).toBe(-5_000n);
  });
  it("rejects a zero token reserve and a zero launch price", () => {
    expect(() => priceLamportsPerToken({ solReserve: 1n, tokenReserve: 0n })).toThrow();
    expect(() => changeSinceLaunchBps(0n, 1n)).toThrow();
  });
});
