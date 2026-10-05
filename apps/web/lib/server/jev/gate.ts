// Who may use /dev/jev's paid endpoints (search / cut / upload). In production
// transcription, Jev calls, encodes and R2 uploads spend real money, so require
// a signed-in user (plus a SIWS proof when the account holds a wallet — same bar
// as the ad-hoc /api/video/clip render). Locally the API stays open for
// scripts/curl, but a signed-in caller is still scoped to their own library.
import type { NextRequest, NextResponse } from "next/server";
import { optionalAuth, requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";

/** `userId` scopes the caller's uploads + clips: the Privy DID, "internal" for
 *  server calls, "local" for an anonymous local-dev call. */
export async function jevGate(req: NextRequest): Promise<{ denied: NextResponse; userId?: never } | { denied?: never; userId: string }> {
  if (process.env.NODE_ENV !== "production") {
    const auth = await optionalAuth(req);
    return { userId: auth.user?.id ?? "local" };
  }
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return { denied: auth.error };
  if (auth.internal) return { userId: "internal" };
  const siwsError = requireSiwsSession(auth);
  if (siwsError) return { denied: siwsError };
  return { userId: auth.user.id };
}
