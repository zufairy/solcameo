import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexClient, errorResponse, isConvexIdString, prepareAuthedJson } from "@/lib/server/solstarRoute";

export const runtime = "nodejs";

/** Owner-only: attach or clear the public X and website links shown on a token's row. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const prep = await prepareAuthedJson(req);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;
  const { characterId, xUrl, websiteUrl } = body;
  if (!isConvexIdString(characterId)) return NextResponse.json({ error: "invalid_character_id" }, { status: 400 });
  if ((xUrl !== undefined && typeof xUrl !== "string") || (websiteUrl !== undefined && typeof websiteUrl !== "string")) return NextResponse.json({ error: "invalid_link" }, { status: 400 });
  try {
    await convexClient().mutation(api.solstarCreate.setSocialLinks, { wallet, characterId: characterId as Id<"ssCharacters">, xUrl, websiteUrl, authSecret: secret });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
