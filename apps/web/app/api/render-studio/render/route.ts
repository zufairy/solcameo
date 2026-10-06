import { beginAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { NextRequest, NextResponse } from "next/server";
import { clampComposition, validateComposition, type Composition } from "@/lib/render-studio/compose";
import { renderComposition } from "@/lib/server/renderStudioRender";
import { ndjson, rateLimit, studioAuth } from "@/lib/server/renderStudioStream";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Exports a composition to MP4. Streams NDJSON progress, then the final URL. */
export async function POST(req: NextRequest) {
  const auth = await studioAuth(req);
  if ("error" in auth) return auth.error;
  const wait = rateLimit("rs-render", auth.key, 12, 60 * 60_000);
  if (wait) return NextResponse.json({ error: `Render limit reached, try again in ${Math.ceil(wait / 60)} min` }, { status: 429 });

  let body: { mintAddress?: string; comp?: Partial<Composition>; quality?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.comp || typeof body.comp !== "object") return NextResponse.json({ error: "Missing composition" }, { status: 400 });
  const comp = clampComposition({ ...body.comp, engine: body.comp.engine === "react" ? "react" : "html" });
  if (comp.html.length + comp.js.length + comp.css.length > 120_000) return NextResponse.json({ error: "Composition too large" }, { status: 413 });
  const issues = validateComposition(comp);
  if (issues.length) return NextResponse.json({ error: issues[0] }, { status: 422 });
  const quality = body.quality === "draft" ? "draft" : "final";

  const billing = await beginAgentGeneration(req, body.mintAddress, "render");
  if (billing.error) return billing.error;
  return ndjson(async (send, signal) => {
    try {
    send({ type: "start", frames: Math.round(comp.duration * comp.fps) });
    const r = await renderComposition(comp, { quality, signal, onProgress: (done, total) => send({ type: "progress", done, total }), onStatus: (text) => send({ type: "status", text }) });
    send({ type: "done", ...r });
    } catch (error) { await billing.refund(); throw error; }
  });
}
