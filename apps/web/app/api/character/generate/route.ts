import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorizeCharacterScope, issueCharacterJobTicket } from "@/lib/server/characterDraft";
import { HfError, submitImage, submitReferenceEdit } from "@/lib/server/higgsfield";
import { imagePublicUrl, putImage } from "@/lib/server/imageStorage";
import { buildPrompt, isBuildable, sanitizeSelection } from "@/lib/character/spec";
import type { Tier } from "@/lib/character/types";
export const maxDuration = 60;
const TIERS: Tier[] = ["normal", "freak", "total"];
const RATIOS = ["3:4", "4:5", "1:1", "9:16", "16:9"];
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const a = await authorizeCharacterScope(req, typeof body.mintAddress === "string" ? body.mintAddress : null, body.draft === true);
  if (a.error) return a.error;
  const tier = TIERS.includes(body.tier as Tier) ? body.tier as Tier : "normal";
  const selection = sanitizeSelection(body.selection, tier);
  if (!isBuildable(selection)) return NextResponse.json({ error: "Pick at least one trait first" }, { status: 400 });
  const chosenRatio = RATIOS.includes(body.aspectRatio as string) ? body.aspectRatio as string : "3:4";
  const ratio = chosenRatio === "4:5" ? "3:4" : chosenRatio;
  const count = body.count === 4 ? 4 : 1;
  const references = body.photoUrls ?? (body.photoUrl ? [body.photoUrl] : []);
  if (!Array.isArray(references) || references.length > 3 || references.some(url => typeof url !== "string" || !url.startsWith(imagePublicUrl(`characters/${a.mint}/`)))) return NextResponse.json({ error: "Upload up to three references while signed in to this account." }, { status: 400 });
  const photoUrls = references as string[];
  const hasReferences = photoUrls.length > 0;
  const model = body.model === "soul2" ? "soul2" : "soul";
  if (body.model === "qwen" && !hasReferences) return NextResponse.json({ error: "Qwen requires a reference image. Choose Soul or Soul 2." }, { status: 400 });
  const prompt = buildPrompt(selection, tier, { photo: hasReferences });
  const batch = randomUUID();
  try {
    const jobs = await Promise.all(Array.from({ length: count }, async (_, index) => {
      const key = `${a.mint}:${batch}:${index}`.slice(0,120);
      const requestId = hasReferences ? await submitReferenceEdit(prompt, photoUrls, ratio, key) : await submitImage(model === "soul2" ? "higgsfield-ai/soul/v2/standard" : "higgsfield-ai/soul/standard", { prompt, aspect_ratio: ratio, resolution: "720p", batch_size: 1 }, key);
      const job = { model: hasReferences ? "reference" as const : model, requestId, count: 1, ratio, createdAt: Date.now() };
      // Register every accepted job before returning: refresh recovery does not depend on browser memory.
      await putImage(Buffer.from(JSON.stringify(job)), "application/json", { key: `characters/${a.mint}/jobs/${requestId}.json` });
      return { ...job, ticket: issueCharacterJobTicket(a.mint, requestId) };
    }));
    return NextResponse.json({ jobs, prompt, ratio, count, referenceMode: hasReferences ? "edit" : undefined });
  } catch (e) {
    if (e instanceof HfError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Could not start and save generation history. Please try again." }, { status: 502 });
  }
}
