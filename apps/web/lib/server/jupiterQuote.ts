export interface JupiterComparison { outAmount: string; betterByPct: number; route: string }

const WSOL = "So11111111111111111111111111111111111111112";

/**
 * What Jupiter's router would pay for the same swap, so a trader can see when another venue beats our pool.
 * Read-only: nothing here builds or signs a transaction. Mainnet only; any error or timeout returns null.
 * Set JUPITER_API_KEY to use api.jup.ag (rate-limited by plan); without it the free lite endpoint is used.
 */
export async function jupiterComparison(args: { side: "buy" | "sell"; mint: string; amount: string; slippageBps: number; ourOut: string }): Promise<JupiterComparison | null> {
  try {
    const key = process.env.JUPITER_API_KEY?.trim();
    const base = key ? "https://api.jup.ag/swap/v1" : "https://lite-api.jup.ag/swap/v1";
    const [inputMint, outputMint] = args.side === "buy" ? [WSOL, args.mint] : [args.mint, WSOL];
    const q = new URLSearchParams({ inputMint, outputMint, amount: args.amount, slippageBps: String(args.slippageBps), restrictIntermediateTokens: "true" });
    const res = await fetch(`${base}/quote?${q}`, { headers: key ? { "x-api-key": key } : undefined, signal: AbortSignal.timeout(2500), cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { outAmount?: string; routePlan?: Array<{ swapInfo?: { label?: string } }> };
    const jup = BigInt(json.outAmount ?? "0"), ours = BigInt(args.ourOut);
    if (jup <= 0n || ours <= 0n) return null;
    const betterByPct = Number(((jup - ours) * 100000n) / ours) / 1000;
    const route = [...new Set((json.routePlan ?? []).map((r) => r.swapInfo?.label).filter(Boolean))].join(" + ") || "Jupiter";
    return { outAmount: jup.toString(), betterByPct, route };
  } catch { return null; }
}
