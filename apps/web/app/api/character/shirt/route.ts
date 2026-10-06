import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorizeCharacterScope, issueCharacterJobTicket } from "@/lib/server/characterDraft";
import { chargeAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { refundImage } from "@/lib/server/imageBilling";
import { CHARGE_MESSAGES } from "@/lib/server/exploreBilling";
import { imagePublicUrl, putImage } from "@/lib/server/imageStorage";
import { normalizeImageForKie } from "@/lib/server/imageForKie";
import { SHIRT_ENGINES, ShirtEditError, createShirtTask } from "@/lib/server/shirtEdit";
import { buildShirtPrompt, sanitizePoseId, sanitizeShirtDescription, sanitizeShirtMode } from "@/lib/character/shirt";

export const runtime = "nodejs";
export const maxDuration = 60;
const RATIOS = ["3:4", "1:1", "9:16", "16:9", "4:3", "2:3"];

/**
 * Start a shirt (and optional pose) edit of one finished portrait. Both the portrait and the
 * logo must already live in this scope's R2 prefix, so a caller can only edit their own images.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const draft = body.draft === true;
  const a = await authorizeCharacterScope(req, typeof body.mintAddress === "string" ? body.mintAddress : null, draft);
  if (a.error) return a.error;
  const prefix = imagePublicUrl(`characters/${a.mint}/`);
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
  const logoUrl = typeof body.logoUrl === "string" && body.logoUrl ? body.logoUrl : "";
  if (!imageUrl.startsWith(prefix)) return NextResponse.json({ error: "Choose one of your generated portraits" }, { status: 400 });
  if (logoUrl && !logoUrl.startsWith(prefix)) return NextResponse.json({ error: "Upload the logo while signed in to this agent" }, { status: 400 });
  const mode = sanitizeShirtMode(body.mode);
  const description = sanitizeShirtDescription(body.description);
  if (mode === "logo" && !logoUrl) return NextResponse.json({ error: "Upload your logo first" }, { status: 400 });
  if (mode === "describe" && !description && !logoUrl) return NextResponse.json({ error: "Describe the shirt first" }, { status: 400 });
  const ratio = RATIOS.includes(body.ratio as string) ? body.ratio as string : "3:4";
  const engineIndex = Number.isInteger(body.engineIndex) ? Math.min(Math.max(Number(body.engineIndex), 0), SHIRT_ENGINES.length - 1) : 0;
  const hasLogo = !!logoUrl && mode !== "auto";
  const prompt = buildShirtPrompt({ mode, description, hasLogo, poseId: sanitizePoseId(body.pose), seed: Number(body.seed) || Date.now() });

  // Kie has to fetch both images, so each is re-hosted as a plain public PNG first.
  const [portrait, logo] = await Promise.all([normalizeImageForKie(imageUrl), hasLogo ? normalizeImageForKie(logoUrl, 1) : Promise.resolve(null)]);
  if (!portrait) return NextResponse.json({ error: "The portrait could not be prepared. Try another one." }, { status: 422 });
  if (hasLogo && !logo) return NextResponse.json({ error: "The logo could not be read. Upload a PNG or JPG." }, { status: 422 });

  const walletFunded = !draft;
  const billingRunId = `shirt:${randomUUID()}`;
  // Every engine attempt is its own charge and is refunded if that attempt fails.
  if (walletFunded) {
    const charge = await chargeAgentGeneration(a.mint, billingRunId, "image_gen");
    if (!charge.ok) return NextResponse.json({ error: CHARGE_MESSAGES[charge.reason] ?? "Could not charge the agent wallet.", code: charge.reason }, { status: charge.reason === "billing_unavailable" ? 503 : 402 });
  }
  try {
    const { taskId, engine } = await createShirtTask({ prompt, urls: logo ? [portrait, logo] : [portrait], ratio, engineIndex });
    await putImage(Buffer.from(JSON.stringify({ billingRunId: walletFunded ? billingRunId : undefined, engine, ratio, createdAt: Date.now() })), "application/json", { key: `characters/${a.mint}/jobs/${taskId}.json` }).catch(() => undefined);
    return NextResponse.json({ taskId, ticket: issueCharacterJobTicket(a.mint, taskId), engine, engineIndex, ratio, prompt, nextEngine: engineIndex + 1 < SHIRT_ENGINES.length ? engineIndex + 1 : null });
  } catch (e) {
    const next = engineIndex + 1 < SHIRT_ENGINES.length ? engineIndex + 1 : null;
    if (walletFunded) await refundImage(a.mint, billingRunId);
    if (e instanceof ShirtEditError) return NextResponse.json({ error: e.message, nextEngine: next }, { status: next !== null ? 502 : e.status });
    return NextResponse.json({ error: "Could not start the shirt edit. Please try again.", nextEngine: next }, { status: 502 });
  }
}
