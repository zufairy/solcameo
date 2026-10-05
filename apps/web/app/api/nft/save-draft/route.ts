import { NextRequest, NextResponse } from "next/server";
import { putImage, r2ImageConfigured } from "@/lib/server/imageStorage";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export const maxDuration = 60;

const CONVEX_URL       = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
// Hard caps on the unauthenticated upload surface (see the auth follow-up note in
// POST): bound per-image bytes + per-request count so a flood can't run up storage/
// egress or spam Convex draft rows.
const MAX_AVATARS      = 8;
const MAX_AVATAR_BYTES = 15 * 1024 * 1024; // 15MB raw per avatar (covers animated GIFs)

export async function POST(req: NextRequest) {
  // SECURITY NOTE — this endpoint is intentionally left UNAUTHENTICATED for now.
  // The dangerous arbitrary-file / content-type-spoofing upload vector is closed
  // below (sharp-transcode every avatar to PNG + hardcoded content-type + per-image
  // and per-request caps + sanitized storage path). The IDEAL hardening is also to
  // gate it with requireInternalOrUserAuth (as nft/mint does), but the pre-mint
  // draft flow (app/builder/page.tsx) can run BEFORE the user signs in, so adding
  // auth must be validated against that flow first (or paired with a per-IP rate
  // limit if it must stay anonymous). Left as a follow-up to avoid breaking the
  // anonymous draft UX. FOLLOW-UP: add `const auth = await requireInternalOrUserAuth(req); if (auth.error) return auth.error;`.
  if (!r2ImageConfigured()) {
    return NextResponse.json({ error: "Image storage (R2) not configured" }, { status: 500 });
  }
  if (!CONVEX_URL) {
    return NextResponse.json({ error: "Convex not configured" }, { status: 500 });
  }
  try {
    const body = await req.json() as {
      sessionId: string;
      creatorWallet?: string;
      name: string;
      handle?: string;
      niche: string;
      characterBible?: string;
      avatarDataUris: string[];
      /** Hosted URLs of the user's uploaded likeness photos (from
       *  /api/generate-nft-images' refImageUrls) — http(s) only, capped. */
      referencePhotoUrls?: string[];
    };

    const { sessionId, creatorWallet, name, handle, niche, characterBible, avatarDataUris } = body;
    const referencePhotoUrls = (Array.isArray(body.referencePhotoUrls) ? body.referencePhotoUrls : [])
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u))
      .slice(0, 8);

    if (!sessionId || !name || !niche || !avatarDataUris?.length) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Sanitize the session id before using it in a storage path so a crafted
    // sessionId (e.g. "../../x") can't escape the `avatars/` prefix. The raw
    // sessionId is still passed to Convex as the opaque draft key (no path semantics).
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "session";

    const sharp = (await import("sharp")).default;
    const avatarUrls = await Promise.all(
      avatarDataUris.slice(0, MAX_AVATARS).map(async (dataUri, i) => {
        // If it's already an HTTP(S) URL, pass it through
        if (/^https?:\/\//i.test(dataUri)) {
          return dataUri;
        }

        // Otherwise, parse as a base64 data URI. NEVER trust the client-declared
        // mimeType/extension: transcode the bytes through sharp to PNG and store
        // with a HARDCODED image/png content-type + `.png` path. sharp throws on
        // anything it can't decode (HTML/JS/SVG/EXE), so only real raster images are
        // hosted — closing the arbitrary-file / content-type-spoofing upload vector
        // to the public bucket. Enforce a per-image byte cap before decoding.
        const match = dataUri.match(/^data:[^;]+;base64,(.+)$/);
        if (!match) return null;
        const raw = Buffer.from(match[1], "base64");
        if (raw.length === 0 || raw.length > MAX_AVATAR_BYTES) {
          console.error(`[save-draft] avatar ${i}: empty or over ${MAX_AVATAR_BYTES}B cap`);
          return null;
        }
        let png: Buffer;
        try {
          png = await sharp(raw).png().toBuffer();
        } catch {
          console.error(`[save-draft] avatar ${i}: not a decodable image — rejected`);
          return null;
        }
        // Deterministic key per session+index so re-saves overwrite, not pile up.
        const key = `avatars/drafts/${safeSessionId}-${i}.png`;
        try {
          return (await putImage(png, "image/png", { key })).url;
        } catch (e) {
          console.error(`[save-draft] avatar ${i}:`, e instanceof Error ? e.message : e);
          return null;
        }
      }),
    );

    const validUrls = avatarUrls.filter((u): u is string => !!u);

    const convex = new ConvexHttpClient(CONVEX_URL);
    const draftId = await convex.mutation(api.nftAgents.saveDraft, {
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
      sessionId,
      ...(creatorWallet ? { creatorWallet } : {}),
      name,
      ...(handle ? { handle } : {}),
      niche,
      ...(characterBible ? { characterBible } : {}),
      avatarUrls: validUrls,
      ...(referencePhotoUrls.length ? { referencePhotoUrls } : {}),
    });

    return NextResponse.json({ ok: true, draftId, avatarUrls: validUrls });
  } catch (err) {
    console.error("[nft/save-draft]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
