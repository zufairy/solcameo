import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { requireAuth } from "@/lib/server/requireAuth";
import {
  convexClient,
  readBoundedJson,
  internalSecret,
  isConvexIdString,
  errorResponse,
} from "@/lib/server/solstarRoute";
import type { Id } from "@/convex/_generated/dataModel";
import { createHash } from "node:crypto";
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const parsed = await readBoundedJson(req, 5000);
  if (!parsed.ok) return parsed.res;
  const body = parsed.body as {
    characterId?: string;
    message?: string;
    imageStorageId?: string;
  } | null;
  if (
    !isConvexIdString(body?.characterId) ||
    typeof body?.message !== "string" ||
    (!body.message.trim() && !body.imageStorageId) ||
    body.message.length > 1000 ||
    (body.imageStorageId !== undefined &&
      !isConvexIdString(body.imageStorageId))
  )
    return NextResponse.json(
      { error: "Write a message of up to 1,000 characters, or attach an image." },
      { status: 400 },
    );
  const secret = internalSecret();
  if (!secret)
    return NextResponse.json(
      { error: "Chat is not configured." },
      { status: 503 },
    );
  try {
    // Show the fan's public profile picture in chat when they have one; the client falls back to the Solcameo mark.
    let authorImage: string | undefined;
    const wallets = [...new Set([...(auth.user.walletAddresses ?? []), auth.user.walletAddress].filter((w): w is string => !!w))].slice(0, 5);
    if (wallets.length) {
      try { authorImage = (await convexClient().query(api.users.leaderboardProfiles, { wallets })).find((p) => p.image && /^https:\/\//.test(p.image))?.image; } catch { /* a missing picture never blocks a message */ }
    }
    const id = await convexClient().mutation(api.communityChat.post, {
      ...(authorImage ? { authorImage } : {}),
      characterId: body.characterId as Id<"ssCharacters">,
      body: body.message,
      ...(body.imageStorageId
        ? { imageStorageId: body.imageStorageId as Id<"_storage"> }
        : {}),
      author: `Fan ${createHash("sha256").update(auth.user.id).digest("hex").slice(0, 8)}`,
      authSecret: secret,
    });
    return NextResponse.json(
      { id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
