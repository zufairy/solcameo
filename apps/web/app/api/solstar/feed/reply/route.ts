import { NextResponse, type NextRequest } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, prepareAuthedJson, isConvexIdString } from "@/lib/server/solstarRoute";

export const runtime = "nodejs";

/** Reply to a callout thread. Requires a proven wallet, like posting a callout. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const prep = await prepareAuthedJson(req, 2048);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;
  if (typeof body.body !== "string" || !body.body.trim()) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  if (!isConvexIdString(body.calloutId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  try {
    const res = await convexClient().mutation(api.solstarFeed.postReply, { wallet, calloutId: body.calloutId as Id<"ssFeed">, body: body.body.trim(), authSecret: secret });
    return NextResponse.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("rate_limited")) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (msg.includes("duplicate_message")) return NextResponse.json({ error: "duplicate_message" }, { status: 409 });
    return errorResponse(e);
  }
}
