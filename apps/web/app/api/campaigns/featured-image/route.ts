import { NextRequest, NextResponse } from "next/server";
import { crawlProductImageCandidates } from "@/lib/server/productImageCrawl";

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url")?.trim();
  if (!rawUrl) {
    return NextResponse.json({ imageUrl: null });
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
    if (!/^https?:$/.test(url.protocol)) {
      return NextResponse.json({ imageUrl: null });
    }
  } catch {
    return NextResponse.json({ imageUrl: null });
  }

  const [imageUrl = null] = await crawlProductImageCandidates(url.toString(), 1).catch(() => []);
  return NextResponse.json({ imageUrl });
}
