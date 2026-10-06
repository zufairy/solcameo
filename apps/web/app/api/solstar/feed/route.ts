import { NextResponse, type NextRequest } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, prepareAuthedJson, isConvexIdString } from "@/lib/server/solstarRoute";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const prep = await prepareAuthedJson(req);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;

  const text = body.body;
  if (typeof text !== "string") return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (body.characterId !== undefined && !isConvexIdString(body.characterId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  try {
    const res = await convexClient().mutation(api.solstarFeed.postChat, { wallet, body: text, authSecret: secret, ...(body.characterId ? { characterId: body.characterId as Id<"ssCharacters"> } : {}), ...(typeof body.theme === "string" ? { theme: body.theme } : {}), ...(typeof body.callCapSol === "number" ? { callCapSol: body.callCapSol } : {}) });
    return NextResponse.json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
