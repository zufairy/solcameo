import { NextRequest, NextResponse } from "next/server";
import { fetchTrendingAudio } from "@/lib/server/trendingAudio";

// Public read used by the clip.memeaudio inspector to list trending sounds. The
// data comes from an EXTERNAL API behind MEME_AUDIO_API_URL (+ optional
// MEME_AUDIO_API_KEY); that key stays SERVER-side and is never returned here —
// the response only carries the resolved sound list. With no env configured the
// list is [] (graceful fallback), so the inspector simply shows no sounds.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(100, Math.floor(raw)) : 20;
  const sounds = await fetchTrendingAudio(limit);
  return NextResponse.json(
    { sounds },
    // The list is env-derived and changes slowly; let the browser cache it briefly.
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
