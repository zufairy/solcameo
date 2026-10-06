import { randomUUID } from "node:crypto";
import { authorizeCharacterOwner } from "@/lib/server/characterAuth";
import { chargeAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { refundImage } from "@/lib/server/imageBilling";
import { NextRequest, NextResponse } from "next/server";
import { generatePostCaption } from "@/lib/server/captionTransform";
import { composePostCaptionInstruction } from "@/lib/builder/postCaptionInstruction";
import { requireInternalOrUserAuth, requireSiwsSession } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

/**
 * Generate a social-post caption for the Editor tab's "Post Captions" tool —
 * the SAME generatePostCaption() the Smart Captions app (clip.captionstyle)
 * uses at publish time, just reachable from a client "Generate" button instead
 * of only firing server-side on post. The operator's prompt (what this video/
 * post is actually about) + mood + language are folded into one instruction;
 * `basis` (the clip's own title/topic) keeps the caption grounded in real
 * content instead of a generic line.
 *
 * Body: { prompt: string, mood?: string, language?: string, basis?: string }.
 * Returns { ok, caption }.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (!auth.internal) {
    const err = requireSiwsSession(auth);
    if (err) return err;
  }

  let body: { mintAddress?: string; prompt?: string; mood?: string; language?: string; basis?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const prompt = String(body.prompt ?? "").trim().slice(0, 500);
  const mood = String(body.mood ?? "").trim().slice(0, 60);
  const language = String(body.language ?? "").trim().slice(0, 60);
  const basis = String(body.basis ?? "").trim().slice(0, 600);
  if (!prompt) return NextResponse.json({ ok: false, error: "prompt required" }, { status: 400 });

  // Shared composer — the editor persists the SAME instruction as
  // clip.captionstyle.descriptionPrompt, so automatic posts match this preview.
  const instruction = composePostCaptionInstruction({ prompt, mood, language });

  const owner = await authorizeCharacterOwner(req, body.mintAddress);
  if (owner.error) return owner.error;
  const runId = `text:${randomUUID()}`;
  const charge = await chargeAgentGeneration(owner.mint, runId, "llm_message");
  if (!charge.ok) return NextResponse.json({ ok: false, error: "Deposit USDC to this agent wallet to generate.", code: charge.reason, mintAddress: owner.mint }, { status: charge.reason === "billing_unavailable" || charge.reason === "payment_failed" ? 503 : 402 });

  try {
    const caption = await generatePostCaption({ instruction, basis: basis || undefined });
    if (!caption) { await refundImage(owner.mint, runId); return NextResponse.json({ ok: false, error: "Could not generate a caption" }, { status: 502 }); }
    return NextResponse.json({ ok: true, caption });
  } catch (e) {
    await refundImage(owner.mint, runId);
    console.warn("[post-caption/generate] providers unavailable:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { ok: false, error: "Caption generation is temporarily unavailable. Please try again." },
      { status: 502 },
    );
  }
}
