import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  convexClient, errorResponse, isConvexIdString, jsonSafe, parseBigint, prepareAuthedJson,
} from "@/lib/server/solstarRoute";

export const runtime = "nodejs";

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const prep = await prepareAuthedJson(req);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;

  const { tokenId, side, quoteExpiresAt, idempotencyKey } = body;
  const amount = parseBigint(body.amount);
  const minOut = parseBigint(body.minOut);
  if (!isConvexIdString(tokenId)) return bad("invalid_token_id");
  if (side !== "buy" && side !== "sell") return bad("invalid_side");
  if (amount === null) return bad("invalid_amount");
  if (minOut === null) return bad("invalid_min_out");
  if (typeof quoteExpiresAt !== "number" || !Number.isFinite(quoteExpiresAt)) return bad("invalid_quote_expiry");
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) return bad("invalid_key");

  try {
    const result = await convexClient().mutation(api.solstarTrade.paperTrade, {
      tokenId: tokenId as Id<"ssTokens">, wallet, side, amount, minOut, quoteExpiresAt, idempotencyKey, authSecret: secret,
    });
    return NextResponse.json(jsonSafe(result));
  } catch (e) {
    return errorResponse(e);
  }
}
