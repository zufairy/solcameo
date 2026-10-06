import { beginAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { NextRequest, NextResponse } from "next/server";
import { cleanAssets, clampComposition, type Composition } from "@/lib/render-studio/compose";
import { selfOrigins } from "@/lib/server/selfOrigin";
import { runStudioAgent, type StudioModel } from "@/lib/server/renderStudioAgent";
import { ndjson, rateLimit, studioAuth } from "@/lib/server/renderStudioStream";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Agentic chat: streams NDJSON events (status / progress / comp / done / error). */
export async function POST(req: NextRequest) {
  const auth = await studioAuth(req);
  if ("error" in auth) return auth.error;
  const wait = rateLimit("rs-chat", auth.key, 40, 60 * 60_000);
  if (wait) return NextResponse.json({ error: `Slow down a little, try again in ${wait}s` }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  if (!prompt) return NextResponse.json({ error: "Tell the agent what to make" }, { status: 400 });
  const engine = body.engine === "react" ? "react" : "html";
  const rawComp = body.comp && typeof body.comp === "object" ? (body.comp as Partial<Composition>) : null;
  const comp = rawComp && (rawComp.js || rawComp.html) ? clampComposition({ ...rawComp, engine }) : null;
  if (comp && comp.html.length + comp.js.length + comp.css.length > 120_000) return NextResponse.json({ error: "Composition too large" }, { status: 413 });
  const a = body.aspect as { width?: number; height?: number } | undefined;
  const aspect = { width: Number(a?.width) || 1080, height: Number(a?.height) || 1920 };
  const history = Array.isArray(body.history)
    ? (body.history as Array<{ role?: string; text?: string }>).filter((h) => (h.role === "user" || h.role === "assistant") && typeof h.text === "string").slice(-8).map((h) => ({ role: h.role as "user" | "assistant", text: String(h.text).slice(0, 600) }))
    : [];
  const model: StudioModel = body.model === "fast" ? "fast" : body.model === "opus" ? "opus" : "auto";
  const attached = cleanAssets(body.attached);
  const reqOrigin = new URL(req.url).origin;
  const origin = /localhost|127\.|0\.0\.0\.0|^http:/.test(reqOrigin) ? (selfOrigins().find((o) => /^https:/.test(o)) ?? "https://velloagents.com") : reqOrigin;
  const agent = body.agent && typeof body.agent === "object" ? {
    agentName: typeof (body.agent as Record<string, unknown>).agentName === "string" ? String((body.agent as Record<string, unknown>).agentName).slice(0, 60) : undefined,
    avatarUrl: /^https:\/\//.test(String((body.agent as Record<string, unknown>).avatarUrl ?? "")) ? String((body.agent as Record<string, unknown>).avatarUrl).slice(0, 500) : undefined,
  } : undefined;

  const billing = await beginAgentGeneration(req, body.mintAddress, "llm_message");
  if (billing.error) return billing.error;
  return ndjson(async (send, signal) => {
    try { await runStudioAgent({ comp, engine, aspect, prompt, history, model, review: body.review !== false, touched: body.touched === true, attached, origin, agent, signal }, send); } catch (error) { await billing.refund(); throw error; }
  });
}
