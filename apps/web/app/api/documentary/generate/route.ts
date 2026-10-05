import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireAuth } from "@/lib/server/requireAuth";
import { fetchSelf } from "@/lib/server/fetchInternal";
import { DEFAULT_NARRATOR_VOICE, isKnownNarratorVoice } from "@/lib/server/elevenTts";
import { normalizeMusicMood } from "@/lib/server/documentaryMusic";

// Kickoff only: create the project row and hand the heavy pipeline (story →
// stock media → ElevenLabs voiceover → ffmpeg assembly) to /api/documentary/render
// via a fire-and-forget loopback — same pattern /api/recreate/kickoff uses. The
// client watches progress reactively through documentaryProjects.get.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { prompt?: string; productUrl?: string; voiceId?: string; musicMood?: string; durationSec?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
  if (prompt.length > 4000) return NextResponse.json({ ok: false, error: "prompt too long" }, { status: 400 });
  const productUrl = body.productUrl?.trim() || undefined;
  const voiceId = body.voiceId && isKnownNarratorVoice(body.voiceId) ? body.voiceId : DEFAULT_NARRATOR_VOICE;
  const musicMood = normalizeMusicMood(body.musicMood);
  // Slider only offers these four stops; clamp anything else back to the default.
  const ALLOWED_DURATIONS = [30, 60, 90, 120];
  const durationSec = ALLOWED_DURATIONS.includes(body.durationSec ?? -1) ? (body.durationSec as number) : 60;

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!secret) return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);

  let projectId: Id<"documentaryProjects">;
  try {
    projectId = (await convex.mutation(api.documentaryProjects.create, {
      ownerId: auth.user.id,
      prompt,
      productUrl,
      voiceId,
      musicMood,
      durationSec,
      authSecret: secret,
    })) as Id<"documentaryProjects">;
  } catch (e) {
    const message = e instanceof Error ? e.message : "could not create the project";
    return NextResponse.json({ ok: false, error: message.slice(0, 200) }, { status: 502 });
  }

  // fetchSelf (loopback → env URL → request origin) instead of bare loopback:
  // plain-HTTP loopback can't reach the HTTPS dev server, which left projects
  // stuck on "Starting…" locally while working on Railway.
  void fetchSelf("/api/documentary/render", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Secret": secret },
    body: JSON.stringify({ id: projectId }),
  }, req).catch((e) => console.warn("[documentary/generate] render kickoff failed:", e instanceof Error ? e.message : e));

  return NextResponse.json({ ok: true, projectId });
}
