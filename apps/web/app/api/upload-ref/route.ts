import { NextRequest, NextResponse } from "next/server";
import { hostBase64ForKie } from "@/lib/server/imageForKie";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

// Reject a base64 payload whose DECODED size would exceed ~50MB before we buffer
// or transcode it. base64 inflates bytes ~4/3, so a 50MB image is ~67M chars; cap
// a little above that. hostBase64ForKie also caps the decoded buffer at 50MB, so
// this is a cheap early-out that bounds request memory, not the only ceiling.
const MAX_BASE64_CHARS = 72_000_000;

/**
 * Host a user-uploaded reference image on the public R2 bucket and return a
 * Kie-safe public `.png` URL. This is the URL shape nano-banana-pro's `image_input`
 * reliably accepts (public https, real `.png` extension, image/png content-type) —
 * unlike Convex storage URLs, which are extensionless and get rejected with
 * "image_input file type not supported" / "image not found".
 *
 * Body: { base64: string }  — raw base64 OR a `data:<mime>;base64,...` data URL.
 * Returns: { url } on success, { error } otherwise.
 */
export async function POST(req: NextRequest) {
  // AUTH GATE (H05/BUG-028) — this route hosts user-uploaded images on a PUBLIC
  // R2 bucket permanently. Without a gate ANY anonymous caller could host
  // arbitrary images on Vello's own infrastructure (cost/abuse/content-liability).
  // Require either the internal secret (server-to-server) or a logged-in session
  // (the builder reference-photo + HireGenerate avatar flows always have a Privy
  // Bearer, auto-attached to every /api/ call by the global fetch interceptor).
  // Mirrors the sibling image routes (generate-nft-images, analyze-images, …).
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  try {
    const { base64 } = (await req.json()) as { base64?: string };
    if (!base64 || typeof base64 !== "string") {
      return NextResponse.json({ error: "Missing image data." }, { status: 400 });
    }
    if (base64.length > MAX_BASE64_CHARS) {
      return NextResponse.json({ error: "Image too large." }, { status: 413 });
    }
    // Accept both a bare base64 string and a full data URL.
    const raw = base64.replace(/^data:[^;]+;base64,/, "");
    const url = await hostBase64ForKie(raw);
    if (!url) {
      return NextResponse.json(
        { error: "Upload failed — image storage (R2) unavailable. Check R2_* env." },
        { status: 502 },
      );
    }
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message ?? "Upload failed" }, { status: 500 });
  }
}
