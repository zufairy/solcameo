import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { pollNftTaskOnce, persistStill } from "@/lib/server/nftKie";

/**
 * COLLECT step for Show Designer style frames — one quick poll per pitch's
 * image task; partial results are returned so cards fill in as frames finish.
 * Finished frames are persisted (KIE URLs expire; a picked frame becomes the
 * show's standing style ref).
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const KIE_KEY = process.env.KIE_API_KEY ?? "";

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!KIE_KEY) return NextResponse.json({ error: "KIE_API_KEY is not set" }, { status: 500 });

  let body: { tasks?: Array<{ i?: number; taskId?: string | null }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const tasks = (body.tasks ?? []).filter((t): t is { i: number; taskId: string } =>
    typeof t?.i === "number" && typeof t?.taskId === "string" && t.taskId.length > 0);
  if (!tasks.length) return NextResponse.json({ ok: true, frames: [], pending: false });

  const results = await Promise.all(tasks.map(async (t) => {
    try {
      const r = await pollNftTaskOnce(t.taskId);
      if (r.status === "success") {
        return { i: t.i, url: await persistStill(r.url, t.i), done: true };
      }
      return { i: t.i, url: null, done: r.status === "fail" }; // fail = done (frameless card)
    } catch {
      return { i: t.i, url: null, done: false };
    }
  }));

  return NextResponse.json({
    ok: true,
    frames: results.filter((r) => r.url).map((r) => ({ i: r.i, url: r.url })),
    pending: results.some((r) => !r.done),
  });
}
