import { NextRequest, NextResponse } from "next/server";
import { authorizeCharacterOwner } from "@/lib/server/characterAuth";
import { checkAgentFunding } from "@/lib/server/solSwap";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Can this agent pay for a job of `required` dollars? Reports its USDC and SOL and, when USDC falls short, whether
 * swapping the shortfall from SOL would cover it. Read-only: nothing is swapped here.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const a = await authorizeCharacterOwner(req, q.get("mint"));
  if (a.error) return a.error;
  const required = Number(q.get("required"));
  if (!Number.isFinite(required) || required <= 0 || required > 1000) return NextResponse.json({ error: "Give the job cost in dollars as `required`." }, { status: 400 });
  try {
    const result = await checkAgentFunding(a.mint, required);
    return NextResponse.json(result, { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503 }); }
}
