import { describe, expect, it, vi } from "vitest";
import { quoteFundSwap } from "./fundSwap";

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("quoteFundSwap", () => {
  it("prices an exact USDC amount in SOL with tight slippage", async () => {
    const f = ok({ inAmount: "19027957", outAmount: "2250000", otherAmountThreshold: "19085041", priceImpactPct: "0" });
    const { summary } = await quoteFundSwap(2.25, f);
    expect(summary).toMatchObject({ usdc: 2.25, slippageBps: 30 });
    expect(summary.inSol).toBeCloseTo(0.019028, 5);
    expect(summary.maxSol).toBeGreaterThan(summary.inSol);
    expect(String((f as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain("swapMode=ExactOut");
  });
  it("rejects amounts outside the allowed range and routes that fall short", async () => {
    await expect(quoteFundSwap(0.1, ok({}))).rejects.toThrow(/Choose between/);
    await expect(quoteFundSwap(2, ok({ inAmount: "1000", outAmount: "10", otherAmountThreshold: "1000" }))).rejects.toThrow(/no route/);
  });
});
