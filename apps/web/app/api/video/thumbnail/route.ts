import { NextRequest, NextResponse } from "next/server";
import { fetchDriveVideoThumbnail } from "@/lib/server/driveDownload";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  const url = req.nextUrl.searchParams.get("url") ?? "";
  const thumbnail = await fetchDriveVideoThumbnail(url);
  if (!thumbnail) return NextResponse.json({ error: "Thumbnail not available" }, { status: 404 });
  return new Response(thumbnail.bytes, {
    headers: {
      "Content-Type": thumbnail.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
