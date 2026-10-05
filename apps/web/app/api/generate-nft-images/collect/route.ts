import { NextRequest, NextResponse } from "next/server";
import { makeAnimatedGif } from "@/lib/server/makeGif";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { pollNftTaskOnce, persistStill, uploadGifToSupabase } from "@/lib/server/nftKie";

// COLLECT step — fast. The client calls this repeatedly (every few seconds) with
// the tasks returned by the CREATE step. Each call does ONE quick recordInfo poll
// per task (NOT a 240s loop):
//   • any task still rendering → { ok:true, pending:true }  (client polls again)
//   • a task failed on KIE      → { ok:false, error }        (client surfaces it)
//   • all tasks done            → download stills + build GIF, then return the
//                                 SAME { ok:true, images:[...] } shape the old
//                                 single-request route returned.
// Only the "all done" branch does heavy work (download + GIF), and even that is a
// handful of seconds — never the ~4 minutes that made Railway kill the old route.
export const maxDuration = 120;

const KIE_KEY = process.env.KIE_API_KEY ?? "";

type IncomingTask = { taskId?: string; label?: string };

export async function POST(req: NextRequest) {
  try {
    // Same auth gate as the CREATE route. This route spends no new KIE credits,
    // but it returns generated images, so gate it identically.
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    if (!KIE_KEY) {
      return NextResponse.json({ error: "KIE_API_KEY is not set" }, { status: 500 });
    }

    const body = await req.json() as {
      tasks?: IncomingTask[];
      refImageUrls?: string[];
    };

    const tasks = (body.tasks ?? []).filter(
      (t): t is { taskId: string; label?: string } => Boolean(t && typeof t.taskId === "string" && t.taskId),
    );
    if (tasks.length === 0) {
      return NextResponse.json({ error: "No tasks to collect" }, { status: 400 });
    }
    const refImageUrls = (body.refImageUrls ?? []).filter((u): u is string => typeof u === "string" && !!u);

    // ONE quick poll pass per task, in parallel.
    const results = await Promise.all(tasks.map((t) => pollNftTaskOnce(t.taskId)));

    // If ANY task genuinely failed on KIE, surface the KIE message. 200 (not 5xx)
    // so the client cleanly parses this JSON and shows the real reason rather than
    // the generic "service busy" fallback it uses for HTML/5xx proxy errors.
    const failed = results.find((r) => r.status === "fail");
    if (failed && failed.status === "fail") {
      return NextResponse.json({ ok: false, error: failed.error }, { status: 200 });
    }

    // If ANY task is still rendering, tell the client to poll again — fast.
    if (results.some((r) => r.status === "pending")) {
      return NextResponse.json({ ok: true, pending: true });
    }

    // ── All tasks succeeded → download + assemble (the old post-poll work) ──
    const raws = results.map((r) => (r as { status: "success"; url: string }).url);

    // Persist each still to Supabase → permanent http(s) URLs. These are the
    // individual NFT frames the video pipeline references (Kie can't read GIFs
    // or data: URIs), so they must outlive the ephemeral raw Kie URLs.
    const stills = await Promise.all(raws.map((raw, i) => persistStill(raw, i)));

    // Build animated GIF — the user's ORIGINAL uploaded photo (already hosted as
    // a public PNG for Kie in the CREATE step, passed back as refImageUrls[0])
    // leads the loop, followed by the generated frames.
    let gifUrl: string | null = null;
    try {
      const gifFrames = refImageUrls.length > 0 ? [refImageUrls[0], ...raws] : raws;
      const gifBuffer = await makeAnimatedGif(gifFrames, { size: 512, delayMs: 300 });
      gifUrl = await uploadGifToSupabase(gifBuffer);
    } catch (gifErr) {
      console.error("[generate-nft-images/collect] GIF assembly failed:", gifErr);
    }

    return NextResponse.json({
      ok: true,
      refImageUrls,
      refImageUrl: refImageUrls[0] ?? null,
      gifUrl,
      images: tasks.map((t, i) => ({ url: stills[i], rawUrl: raws[i], label: t.label ?? `Frame ${i + 1}` })),
    });
  } catch (err) {
    console.error("[generate-nft-images/collect]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Collection failed" },
      { status: 500 },
    );
  }
}
