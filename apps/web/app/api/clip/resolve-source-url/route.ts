import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { resolveSourceUrl } from "@/lib/server/campaignSources";

/**
 * Resolve a RAW pasted source URL (from the clipper's Paste-URL pill) into the
 * downloadable videos it represents, plus whether it was a Google Drive FOLDER.
 *
 * This mirrors the sibling /api/clip/campaign-sources route but for a user-typed
 * URL instead of a campaign id: when the user pastes a Drive FOLDER link, the
 * front-end expands it into every member video (recursed) and lets them pick which
 * file to clip — exactly like the Campaign pill. Non-folder links (YouTube/TikTok/
 * a single Drive file / a direct .mp4) come back as a single video, unchanged.
 *
 * Returns ONLY PUBLIC content — public Drive folder listings, nothing ownable or
 * secret — so it's gated like campaign-sources: a valid internal-secret caller OR
 * any logged-in user (a valid Privy Bearer). NO wallet signature (SIWS) is required
 * (there's nothing ownable to scope, and a SIWS gate here would pop a needless
 * Ed25519 prompt while merely resolving a pasted link).
 *
 * Shape: { videos: [{ url, name }], isFolder: boolean }. A blank / bad / non-video
 * URL returns { videos: [], isFolder: false } with a 200 — a user typo must NEVER
 * 500 — and the caller keeps today's single-source behavior.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(req: NextRequest, url: string): Promise<NextResponse> {
  // Authenticate (a valid Privy Bearer OR the internal secret) but DON'T force a
  // wallet signature — this returns only public Drive folder listings (matches the
  // campaign-sources route, which was de-SIWS'd for the same reason).
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  // Blank URL → empty result (never an error): the pill just stays single-source.
  if (!url) return NextResponse.json({ videos: [], isFolder: false });

  // resolveSourceUrl is graceful/never-throws, but keep the route itself defensive.
  try {
    const result = await resolveSourceUrl(url);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ videos: [], isFolder: false });
  }
}

export async function GET(req: NextRequest) {
  const url = (req.nextUrl.searchParams.get("url") ?? "").trim();
  return handle(req, url);
}

export async function POST(req: NextRequest) {
  let url = (req.nextUrl.searchParams.get("url") ?? "").trim();
  if (!url) {
    try {
      const body = (await req.json()) as { url?: string };
      url = String(body.url ?? "").trim();
    } catch {
      /* no body — fall through to the empty-result response */
    }
  }
  return handle(req, url);
}
