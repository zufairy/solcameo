import { NextRequest, NextResponse } from "next/server";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { pollNftTaskOnce, persistStill } from "@/lib/server/nftKie";

/**
 * COLLECT step for a character design sheet — ONE quick poll per view.
 *
 * Still rendering → { pending: true } and the client polls again. All done → the
 * frames are persisted to durable storage and returned, because a KIE result URL
 * expires and these images are the character's identity reference for every future
 * episode; a dead URL would silently unlock the character's look.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const KIE_KEY = process.env.KIE_API_KEY ?? "";

export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!KIE_KEY) return NextResponse.json({ error: "KIE_API_KEY is not set" }, { status: 500 });

  let body: { tasks?: { taskId?: string; view?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tasks = (body.tasks ?? []).filter((t): t is { taskId: string; view?: string } => !!t?.taskId);
  if (tasks.length === 0) return NextResponse.json({ error: "tasks are required" }, { status: 400 });

  const results = await Promise.all(tasks.map((t) => pollNftTaskOnce(t.taskId)));
  const failed = results.find((r): r is { status: "fail"; error: string } => r.status === "fail");
  if (failed) {
    return NextResponse.json({ ok: false, error: failed.error || "the design sheet failed to render" }, { status: 502 });
  }
  if (results.some((r) => r.status !== "success")) {
    return NextResponse.json({ ok: true, pending: true });
  }

  try {
    const images = await Promise.all(
      results.map(async (r, i) => ({
        view: tasks[i].view ?? `view${i + 1}`,
        // Persisted, not the raw KIE URL: this frame IS the character's identity
        // lock for every future episode, and a KIE URL expires.
        url: await persistStill(r.status === "success" ? r.url : "", i),
      })),
    );
    return NextResponse.json({ ok: true, images: images.filter((im) => im.url) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "could not store the design sheet" }, { status: 502 });
  }
}
