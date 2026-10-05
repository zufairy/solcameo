import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { NextRequest, NextResponse } from "next/server";
import { authorizeCharacterOwner, characterKey } from "@/lib/server/characterAuth";
import { getObjectText, imagePublicUrl, putImage, r2ImageConfigured } from "@/lib/server/imageStorage";
import { buildPrompt, isBuildable, sanitizeSelection } from "@/lib/character/spec";
import type { CharacterImage, ModelChoice, SavedCharacter, Tier } from "@/lib/character/types";

export const maxDuration = 30;

const TIERS: Tier[] = ["normal", "freak", "total"];
const MODELS: ModelChoice[] = ["soul", "soul2", "both", "qwen"];

/** An agent's one saved character (JSON + portraits both live in R2, not Convex). */
export async function GET(req: NextRequest) {
  const a = await authorizeCharacterOwner(req, req.nextUrl.searchParams.get("mint"));
  if (a.error) return a.error;
  const raw = await getObjectText(characterKey(a.mint));
  if (!raw) {
    // Coin-created agents already own their uploaded portrait; no second character setup is needed.
    const agent = await new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!).query(api.influencers.getByMint, { mintAddress: a.mint });
    if (agent?.solstarCharacterId && agent.avatarUrl) {
      const image = { model: "reference" as const, url: agent.avatarUrl };
      const character: SavedCharacter = { version: 1, tier: "normal", selection: {}, prompt: agent.description, model: "soul", image, candidates: [image], updatedAt: agent.updatedAt ?? agent._creationTime };
      return NextResponse.json({ character }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ character: null });
  }
  try {
    return NextResponse.json({ character: JSON.parse(raw) as SavedCharacter }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ character: null });
  }
}

export async function PUT(req: NextRequest) {
  if (!r2ImageConfigured()) return NextResponse.json({ error: "Image storage (R2) not configured" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const a = await authorizeCharacterOwner(req, typeof body.mintAddress === "string" ? body.mintAddress : null);
  if (a.error) return a.error;

  const tier = TIERS.includes(body.tier as Tier) ? (body.tier as Tier) : "normal";
  const model = MODELS.includes(body.model as ModelChoice) ? (body.model as ModelChoice) : "soul";
  const selection = sanitizeSelection(body.selection, tier);
  if (!isBuildable(selection)) return NextResponse.json({ error: "Pick at least one trait" }, { status: 400 });

  // Only images we generated for THIS agent may be saved (no arbitrary hot-linked URLs).
  const prefix = imagePublicUrl(`characters/${a.mint}/`);
  const okImage = (v: unknown): v is CharacterImage =>
    !!v && typeof v === "object" &&
    ((v as CharacterImage).model === "qwen" || (v as CharacterImage).model === "soul" || (v as CharacterImage).model === "soul2" || (v as CharacterImage).model === "reference") &&
    typeof (v as CharacterImage).url === "string" && (v as CharacterImage).url.startsWith(prefix);
  const ratioOf = (v: CharacterImage) => (typeof v.ratio === "string" && /^\d{1,2}:\d{1,2}$/.test(v.ratio) ? { ratio: v.ratio } : {});
  if (!okImage(body.image)) return NextResponse.json({ error: "Pick a generated portrait to save" }, { status: 400 });
  const candidates = (Array.isArray(body.candidates) ? body.candidates : []).filter(okImage).slice(0, 24).map((c) => ({ model: c.model, url: c.url, ...ratioOf(c) }));
  const photoUrl = typeof body.photoUrl === "string" && body.photoUrl.startsWith(prefix) ? body.photoUrl : undefined;

  const character: SavedCharacter = {
    version: 1,
    tier,
    selection,
    prompt: buildPrompt(selection, tier),
    model,
    image: { model: body.image.model, url: body.image.url, ...ratioOf(body.image) },
    candidates: candidates.length ? candidates : [{ model: body.image.model, url: body.image.url }],
    ...(photoUrl ? { photoUrl } : {}),
    photoUrls: (Array.isArray(body.photoUrls) ? body.photoUrls : photoUrl ? [photoUrl] : []).filter((url): url is string => typeof url === "string" && url.startsWith(prefix)).slice(0, 3),
    updatedAt: Date.now(),
  };
  await putImage(Buffer.from(JSON.stringify(character)), "application/json", { key: characterKey(a.mint) });
  return NextResponse.json({ character });
}
