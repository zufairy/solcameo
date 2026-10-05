import { NextRequest, NextResponse } from "next/server";
import { authorizeCharacterOwner } from "@/lib/server/characterAuth";
import { putVideo, r2Configured } from "@/lib/server/videoStorage";

export const maxDuration = 60;
const MAX_BYTES = 150 * 1024 * 1024;

/** Reference video for motion transfer (4–30s clip). Stored in R2 so Higgsfield can fetch it. */
export async function POST(req: NextRequest) {
  if (!r2Configured()) return NextResponse.json({ error: "Video storage (R2) not configured" }, { status: 503 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const mint = form?.get("mintAddress");
  const a = await authorizeCharacterOwner(req, typeof mint === "string" ? mint : null);
  if (a.error) return a.error;
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES || !file.type.startsWith("video/")) {
    return NextResponse.json({ error: "Upload a video under 150MB" }, { status: 400 });
  }
  try {
    const stored = await putVideo(new Uint8Array(await file.arrayBuffer()), { keyPrefix: `characters/${a.mint}/motion-ref`, contentType: file.type });
    return NextResponse.json({ url: stored.url });
  } catch {
    return NextResponse.json({ error: "Could not store that video" }, { status: 502 });
  }
}
