import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { requireAuth } from "@/lib/server/requireAuth";
import {
  convexClient,
  errorResponse,
  internalSecret,
} from "@/lib/server/solstarRoute";

/** Short-lived Convex upload URL for a chat image. The image is validated again when the message posts. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const secret = internalSecret();
  if (!secret)
    return NextResponse.json({ error: "Chat is not configured." }, { status: 503 });
  try {
    const uploadUrl = await convexClient().mutation(
      api.solstarCreate.generateUploadUrl,
      { authSecret: secret },
    );
    return NextResponse.json({ uploadUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
