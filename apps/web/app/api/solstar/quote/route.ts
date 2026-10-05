import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { quoteBuy, quoteSell, type Quote } from "@/lib/solstar/economics";
import { convexClient, errorResponse, isConvexIdString, parseBigint } from "@/lib/server/solstarRoute";

export const runtime = "nodejs";

const QUOTE_TTL_MS = 15_000;
const NO_STORE = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams;
  const tokenId = q.get("tokenId");
  const side = q.get("side");
  const amount = parseBigint(q.get("amount"));
  if (!isConvexIdString(tokenId)) return fail("invalid_token_id", 400);
  if (side !== "buy" && side !== "sell") return fail("invalid_side", 400);
  if (amount === null) return fail("invalid_amount", 400);

  try {
    const pool = await convexClient().query(api.solstarCatalog.getTokenPool, { tokenId: tokenId as Id<"ssTokens"> });
    if (!pool) return fail("token_not_found", 404);
    if (pool.network !== "paper") return fail("not_paper_token", 400);

    let quote: Quote;
    try {
      const p = { solReserve: BigInt(pool.solReserve), tokenReserve: BigInt(pool.tokenReserve) };
      quote = side === "buy" ? quoteBuy(p, amount) : quoteSell(p, amount);
    } catch {
      return fail("invalid_amount", 400);
    }
    const quotedAt = Date.now();
    const { total, protocol, creator, ops, content } = quote.feeSplit;
    return NextResponse.json({
      amountOut: quote.amountOut.toString(),
      fee: quote.fee.toString(),
      feeSplit: { total: total.toString(), protocol: protocol.toString(), creator: creator.toString(), ops: ops.toString(), content: content.toString() },
      quotedAt,
      expiresAt: quotedAt + QUOTE_TTL_MS,
    }, { headers: NO_STORE });
  } catch (e) {
    const res = errorResponse(e);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}
