import { NextRequest, NextResponse } from "next/server";
import { callClaudeText } from "@/lib/server/kie-claude";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";
import { tidyHook, buildHookPrompt } from "./hookPrompt";

export const runtime = "nodejs";

/**
 * Generate a short, scroll-stopping hook line from the operator's brief via
 * official Gemini, with Kie as fallback. Used by the Editor tab and AppStore
 * "Auto Hook" picker: the operator types what kind of hook they want, we
 * return one punchy line they can save + burn.
 *
 * Body: { prompt: string, topic?: string, niche?: string, content?: string, language?: string }.
 * `content` is the video's real content basis — the clip's own transcript
 * when it went through the clip pipeline, else its generated caption/title —
 * so the hook actually MATCHES this specific clip, not a generic guess.
 * `language` is the Editor's dedicated Language dropdown; the free-text
 * `prompt` can still override it ("write it in French") — see buildHookPrompt.
 * Returns { ok, hook }.
 */
export async function POST(req: NextRequest) {
  // User-facing button — require a SIWS session (or an internal caller).
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!auth.internal) {
    const err = requireSiwsSession(auth);
    if (err) return err;
  }

  let body: { prompt?: string; topic?: string; niche?: string; content?: string; language?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ ok: false, error: "prompt required" }, { status: 400 });

  const { system, user } = buildHookPrompt({
    prompt,
    topic: body.topic,
    niche: body.niche,
    content: body.content,
    language: body.language,
  });

  try {
    const text = await callClaudeText({ system, user, maxTokens: 60 });
    const hook = tidyHook(text);
    if (!hook) return NextResponse.json({ ok: false, error: "Could not generate a hook" }, { status: 502 });
    return NextResponse.json({ ok: true, hook });
  } catch (e) {
    console.warn("[hook/generate] providers unavailable:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { ok: false, error: "Hook generation is temporarily unavailable. Please try again." },
      { status: 502 },
    );
  }
}
