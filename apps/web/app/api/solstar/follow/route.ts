import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexClient, errorResponse, isConvexIdString, prepareAuthedJson } from "@/lib/server/solstarRoute";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const prep = await prepareAuthedJson(req);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;

  const { characterId, follow } = body;
  if (!isConvexIdString(characterId)) return NextResponse.json({ error: "invalid_character_id" }, { status: 400 });
  if (typeof follow !== "boolean") return NextResponse.json({ error: "invalid_follow" }, { status: 400 });

  try {
    const args = { wallet, characterId: characterId as Id<"ssCharacters">, authSecret: secret };
    await convexClient().mutation(follow ? api.solstarCatalog.follow : api.solstarCatalog.unfollow, args);
    return NextResponse.json({ ok: true, following: follow });
  } catch (e) {
    return errorResponse(e);
  }
}
