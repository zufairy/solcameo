import { chargeAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { refundImage } from "@/lib/server/imageBilling";
import { CHARGE_MESSAGES } from "@/lib/server/exploreBilling";
import { refundStudioRun, reserveStudioImages } from "@/lib/server/studioGenBilling";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorizeCharacterScope, issueCharacterJobTicket } from "@/lib/server/characterDraft";
import { HfError, submitImage } from "@/lib/server/higgsfield";
import { createStudioImageTask, hostReferencesForKie, kieConfigured } from "@/lib/server/kieStudioImage";
import { imagePublicUrl, putImage } from "@/lib/server/imageStorage";
import { POSES, TEMPLATES, buildPrompt, buildTemplatePrompt, isBuildable, sanitizeSelection } from "@/lib/character/spec";
import { isAnimalTier } from "@/lib/character/types";
import type { Tier } from "@/lib/character/types";
export const maxDuration = 60;
const TIERS: Tier[] = ["normal", "freak", "total", "insects", "frogs", "cats", "dogs", "capybaras", "birds"];
const RATIOS = ["3:4", "4:5", "1:1", "9:16", "16:9"];
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const a = await authorizeCharacterScope(req, typeof body.mintAddress === "string" ? body.mintAddress : null, body.draft === true);
  if (a.error) return a.error;
  const tier = TIERS.includes(body.tier as Tier) ? body.tier as Tier : "normal";
  const selection = sanitizeSelection(body.selection, tier);
  // A preset brings its own full brief, so it can run without a trait selection.
  const brief = typeof body.brief === "string" ? body.brief.trim().slice(0, 3000) : "";
  if (!brief && !isAnimalTier(tier) && !isBuildable(selection)) return NextResponse.json({ error: "Pick at least one trait first" }, { status: 400 });
  const chosenRatio = RATIOS.includes(body.aspectRatio as string) ? body.aspectRatio as string : "3:4";
  const ratio = chosenRatio === "4:5" ? "3:4" : chosenRatio;
  const count = body.count === 4 ? 4 : 1;
  const references = body.photoUrls ?? (body.photoUrl ? [body.photoUrl] : []);
  if (!Array.isArray(references) || references.length > 3 || references.some(url => typeof url !== "string" || !url.startsWith(imagePublicUrl(`characters/${a.mint}/`)))) return NextResponse.json({ error: "Upload up to three references while signed in to this account." }, { status: 400 });
  const photoUrls = references as string[];
  const hasReferences = photoUrls.length > 0;
  const model = body.model === "soul" ? "soul" : "soul2";
  if ((body.model === "qwen" || body.model === "nano") && !hasReferences) return NextResponse.json({ error: "Nano Banana Pro needs a reference image. Choose Soul or Soul 2." }, { status: 400 });
  // Every candidate gets its own pose, starting from a random one, so a batch never repeats a stance.
  const poseStart = Math.floor(Math.random() * POSES.length);
  // One template per batch: every take shares backdrop, light and lens, and only the pose changes, so the set reads as one concept.
  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  const promptFor = (index: number) => {
    const pose = POSES[(poseStart + index) % POSES.length];
    if (hasReferences) return buildTemplatePrompt(selection, tier, { pose, template, photo: true, brief: brief || undefined });
    return brief
      ? `${brief} POSE FOR THIS TAKE (overrides any pose instruction above): ${pose}.`
      : buildPrompt(selection, tier, { photo: hasReferences, pose });
  };
  const prompt = promptFor(0);
  const batch = randomUUID();
  const walletFunded = body.draft !== true;
  const billingRuns = Array.from({ length: count }, (_, index) => `character:${batch}:${index}`);
  // Onboarding (draft) generations are paid by the signed-in account: free allowance first, then $0.10 per image.
  if (!walletFunded) {
    const studio = await reserveStudioImages(req, { runIds: billingRuns, fresh: true, useFree: body.useFree !== false, paymentSignature: body.paymentSignature, payer: body.payer });
    if (studio.error) return studio.error;
  }
  if (walletFunded) {
    for (const [index, billingRunId] of billingRuns.entries()) {
      const charge = await chargeAgentGeneration(a.mint, billingRunId, "image_gen");
      if (!charge.ok) {
        await Promise.all(billingRuns.slice(0, index).map(id => refundImage(a.mint, id)));
        return NextResponse.json({ error: CHARGE_MESSAGES[charge.reason] ?? "Could not charge the agent wallet.", code: charge.reason, mintAddress: a.mint, required: count * 0.05 }, { status: charge.reason === "billing_unavailable" || charge.reason === "payment_failed" ? 503 : 402 });
      }
    }
  }
  // KIE only reliably accepts public PNG references, so they are re-hosted once for the whole batch.
  const kieRefs = hasReferences && kieConfigured() ? await hostReferencesForKie(photoUrls, a.mint).then(hosted => hosted.length ? hosted : photoUrls) : photoUrls;
  try {
    const results = await Promise.allSettled(Array.from({ length: count }, async (_, index) => {
      const billingRunId = billingRuns[index];
      let accepted = false;
      try {
      const key = `${a.mint}:${batch}:${index}`.slice(0,120);
      const prompt = promptFor(index);
      let usedModel: "nano" | "soul" | "soul2" = hasReferences ? "nano" : model;
      let provider: "kie" | "higgsfield" = "higgsfield";
      let requestId: string;
      if (hasReferences) {
        try {
          if (!kieConfigured()) throw new HfError("KIE is not configured", 503, "upstream");
          requestId = await createStudioImageTask({ prompt, refs: kieRefs, aspectRatio: ratio });
          provider = "kie";
        } catch (error) {
          // Nano Banana Pro could not start: fall back to Soul with the upload as its reference instead of failing the run.
          if (error instanceof HfError && (error.code === "credits" || error.code === "auth")) throw error;
          requestId = await submitImage("higgsfield-ai/soul/standard", { prompt, aspect_ratio: ratio, resolution: "720p", batch_size: 1, image_reference_url: photoUrls[0] }, `${key}:soul`.slice(0, 120));
          usedModel = "soul";
        }
      } else requestId = await submitImage(model === "soul2" ? "higgsfield-ai/soul/v2/standard" : "higgsfield-ai/soul/standard", { prompt, aspect_ratio: ratio, resolution: "720p", batch_size: 1 }, key);
      accepted = true;
      const job = { billingRunId: walletFunded ? billingRunId : undefined, studioRunId: walletFunded ? undefined : billingRunId, provider, model: usedModel, requestId, count: 1, ratio, createdAt: Date.now(), ...(provider === "kie" ? { prompt, refs: kieRefs.slice(0, 1) } : {}) };
      // Register every accepted job before returning: refresh recovery does not depend on browser memory.
      await putImage(Buffer.from(JSON.stringify(job)), "application/json", { key: `characters/${a.mint}/jobs/${requestId}.json` });
      return { ...job, ticket: issueCharacterJobTicket(a.mint, requestId) };
      } catch (error) {
        if (!accepted) await (walletFunded ? refundImage(a.mint, billingRunId) : refundStudioRun(billingRunId));
        throw error;
      }
    }));
    const jobs = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    if (!jobs.length) throw (results.find(result => result.status === "rejected") as PromiseRejectedResult).reason;
    return NextResponse.json({ jobs, prompt, ratio, count, referenceMode: hasReferences ? "edit" : undefined });
  } catch (e) {
    if (e instanceof HfError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Could not start and save generation history. Please try again." }, { status: 502 });
  }
}
