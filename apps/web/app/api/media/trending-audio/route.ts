import { NextResponse } from "next/server";
import { TRENDING_AUDIO } from "@/lib/server/trendingAudioPack";

export const runtime = "nodejs";

/**
 * Resolved trending-audio track list (real URLs) for CLIENT callers.
 *
 * TRENDING_AUDIO resolves each track's url via mediaPackBase(), which reads
 * `process.env` — reliable in a Node/Convex runtime, but "use client"
 * components that import trendingAudioPack directly get "" for every url:
 * bundlers don't inline a DYNAMIC `env[envVar]` lookup the way they inline a
 * literal `process.env.NEXT_PUBLIC_X`, and browsers have no real `process`
 * global to fall back on. This route resolves server-side (guaranteed real
 * env) and ships the client the finished URLs instead.
 */
export async function GET() {
  return NextResponse.json({ ok: true, tracks: TRENDING_AUDIO });
}
