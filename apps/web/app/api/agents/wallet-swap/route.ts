import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { authorizeCharacterOwner } from "@/lib/server/characterAuth";
import { refreshAgentFunds } from "@/lib/server/agentWallet";
import { quoteAgentSwap, swapInAgentWallet, type AgentSwapDirection } from "@/lib/server/solSwap";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Owner-only: quote or run a SOL to USDC (or USDC to SOL) swap inside the agent's own wallet. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { action?: string; mintAddress?: string; direction?: string; amount?: number } | null;
  const owner = await authorizeCharacterOwner(req, body?.mintAddress);
  if (owner.error) return owner.error;
  const direction = body?.direction as AgentSwapDirection;
  const amount = Number(body?.amount);
  if ((direction !== "sol_to_usdc" && direction !== "usdc_to_sol") || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Invalid swap." }, { status: 400 });
  try {
    if (body?.action === "quote") return NextResponse.json(await quoteAgentSwap(direction, amount), { headers: { "Cache-Control": "no-store" } });
    if (body?.action !== "swap") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    // Never sell USDC the agent still owes for work it has already done.
    let unsettled = 0;
    if (direction === "usdc_to_sol") {
      const account = await new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.agentAccount.getWithNav, { mintAddress: owner.mint });
      unsettled = (account?.unsettledTabUsdc ?? 0) + ((account as { pendingSettlementUsdc?: number } | null)?.pendingSettlementUsdc ?? 0);
    }
    const result = await swapInAgentWallet(owner.mint, direction, amount, unsettled);
    if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: 422 });
    await refreshAgentFunds(owner.mint).catch(() => undefined);
    return NextResponse.json({ ok: true, signature: result.signature, received: result.received });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 160) : "The swap failed." }, { status: 502 });
  }
}
