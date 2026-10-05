import { NextResponse } from "next/server";
import { REACTION_SFX, REACTION_SFX_PACKS } from "@/lib/server/reactionSfxPack";

export const runtime = "nodejs";

/**
 * Resolved reaction-SFX sound list + pack registry (real URLs) for CLIENT
 * callers — mirrors /api/media/trending-audio's reasoning exactly: the
 * catalog resolves each sound's url via mediaPackBase(), which reads
 * `process.env`, reliable only in a Node runtime. A "use client" component
 * (the Editor tab's Sound Effect drawer) gets "" for every url importing the
 * catalog directly; this route resolves server-side and ships the finished
 * URLs + the pack list (id/label/stings) so the client can render pack cards
 * with working preview playback.
 */
export async function GET() {
  return NextResponse.json({ ok: true, sounds: REACTION_SFX, packs: REACTION_SFX_PACKS });
}
