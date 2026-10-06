import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { authorizeCharacterOwner } from "@/lib/server/characterAuth";
import { resolveReference } from "@/lib/server/exploreReferences";
import { withCastKey } from "@/lib/explore/castKey";
import { priceUsd } from "@/lib/server/exploreBilling";

export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S{1,2000}$/.test(u);
const ERRORS: Record<string, [string, number]> = {
  time_in_past: ["Pick a time at least a minute from now.", 400],
  time_too_far: ["Schedule within the next year.", 400],
  too_many_scheduled: ["This agent already has 20 active schedules. Cancel one first.", 429],
  not_found: ["Schedule not found.", 404],
  not_cancellable: ["Only upcoming schedules can be cancelled.", 409],
};

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : "";
  const key = Object.keys(ERRORS).find((k) => msg.includes(k));
  if (key) return NextResponse.json({ error: ERRORS[key][0] }, { status: ERRORS[key][1] });
  return NextResponse.json({ error: "Could not update the schedule." }, { status: 500 });
}

function client() {
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!CONVEX_URL || !secret) return null;
  return { convex: new ConvexHttpClient(CONVEX_URL), secret };
}

/** Owner-only: queue a motion-transfer render for a later time. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const a = await authorizeCharacterOwner(req, typeof body.mintAddress === "string" ? body.mintAddress : null);
  if (a.error) return a.error;
  const c = client();
  if (!c) return NextResponse.json({ error: "Scheduling is not configured." }, { status: 503 });

  const ref = typeof body.referenceId === "string" ? await resolveReference(body.referenceId, body.referencePage) : null;
  if (!ref) return NextResponse.json({ error: "This reference video is no longer available. Pick another one." }, { status: 400 });
  const imageUrls = (Array.isArray(body.imageUrls) ? body.imageUrls : []).filter(https).slice(0, 8);
  if (!imageUrls.length) return NextResponse.json({ error: "Add at least one character image" }, { status: 400 });
  const runAt = Number(body.runAt);
  if (!Number.isFinite(runAt)) return NextResponse.json({ error: "Pick a time" }, { status: 400 });
  const mode = body.mode === "object-swap" ? "object-swap" : "motion-transfer";
  const resolution = (["480p", "720p", "1080p"].includes(body.resolution as string) ? body.resolution : "720p") as "480p" | "720p" | "1080p";
  if (priceUsd(ref.duration, resolution) === null) return NextResponse.json({ error: "This reference must be between 4 and 30 seconds." }, { status: 400 });
  const repeat = body.repeat === "daily" || body.repeat === "weekly" ? body.repeat : "once";
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const agent = await c.convex.query(api.influencers.getByMintServer, { mintAddress: a.mint, authSecret: c.secret }).catch(() => null);
  const autoPost = body.autoPost === true && !!agent?.connectedPlatforms?.includes("x");
  try {
    const id = await c.convex.mutation(api.scheduledRecreations.create, {
      authSecret: c.secret, mintAddress: a.mint, referenceId: ref.id, referenceTitle: ref.title,
      referencePoster: ref.thumbUrl, videoUrl: ref.videoUrl, durationSec: ref.duration, autoPost, imageUrls, prompt: withCastKey(text(body.prompt, 4000), body.castTokens, imageUrls.length, mode), mode, resolution, runAt, repeat,
      repeatCount: typeof body.repeatCount === "number" ? body.repeatCount : undefined,
    });
    return NextResponse.json({ id });
  } catch (e) {
    return fail(e);
  }
}

export async function GET(req: NextRequest) {
  const a = await authorizeCharacterOwner(req, req.nextUrl.searchParams.get("mint"));
  if (a.error) return a.error;
  const c = client();
  if (!c) return NextResponse.json({ items: [] });
  const rows = await c.convex.query(api.scheduledRecreations.listForMint, { authSecret: c.secret, mintAddress: a.mint }).catch(() => []);
  return NextResponse.json({
    items: rows.map((r) => ({ id: r._id, title: r.referenceTitle, poster: r.referencePoster, runAt: r.runAt, repeat: r.repeat, remaining: r.remaining, status: r.status, resolution: r.resolution, mode: r.mode, resultUrl: r.resultUrl, error: r.error, postStatus: r.postStatus, postError: r.postError })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const a = await authorizeCharacterOwner(req, q.get("mint"));
  if (a.error) return a.error;
  const c = client();
  if (!c) return NextResponse.json({ error: "Scheduling is not configured." }, { status: 503 });
  const id = q.get("id") ?? "";
  if (!/^[a-z0-9]{20,40}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    await c.convex.mutation(api.scheduledRecreations.cancel, { authSecret: c.secret, mintAddress: a.mint, id: id as Id<"scheduledRecreations"> });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
