import { NextRequest, NextResponse } from "next/server";
import { mirrorImageToR2 } from "@/lib/server/imageStorage";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { pollNftTaskOnce } from "@/lib/server/nftKie";

// COLLECT step — fast. The caller polls this with the taskId from CREATE. One quick
// recordInfo poll per call (NOT a 260s loop):
//   • still rendering → { ok:true, pending:true }
//   • failed on KIE   → { ok:false, error }
//   • done            → mirror the finished grid into our bucket, return
//                       { ok:true, gridImageUrl }
export const maxDuration = 60;

const KIE_KEY = process.env.KIE_API_KEY ?? "";

/** Mirror finished Kie grid image into our R2 bucket so we own the URL. */
async function mirrorGridToSupabase(url: string): Promise<string | null> {
  const stored = await mirrorImageToR2(url, { keyPrefix: "avatars/grids" });
  if (!stored) console.warn("[generate-character-grid/collect] mirror failed for", url);
  return stored?.url ?? null;
}

export async function POST(req: NextRequest) {
  try {
    // Same auth gate as CREATE — no new credits spent, but it returns an image.
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    if (!KIE_KEY) {
      return NextResponse.json({ error: "KIE_API_KEY is not set" }, { status: 500 });
    }

    const body = await req.json() as { taskId?: string };
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const result = await pollNftTaskOnce(taskId);

    if (result.status === "fail") {
      // 200 (not 5xx) so the caller cleanly parses this JSON and reads the real
      // reason rather than the generic HTML/5xx fallback.
      return NextResponse.json({ ok: false, error: result.error }, { status: 200 });
    }
    if (result.status === "pending") {
      return NextResponse.json({ ok: true, pending: true });
    }

    // success → mirror into our bucket (best-effort; fall back to the raw Kie URL).
    const mirrored = await mirrorGridToSupabase(result.url);
    return NextResponse.json({
      ok: true,
      gridImageUrl: mirrored ?? result.url,
    });
  } catch (err) {
    console.error("[generate-character-grid/collect]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Grid collection failed" },
      { status: 500 },
    );
  }
}
