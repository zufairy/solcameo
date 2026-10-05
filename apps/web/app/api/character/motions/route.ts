import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 20;

const FEED = "https://cms.higgsfield.ai/higgsfield-multiplier/video-explore/v2";

export interface MotionItem {
  id: string;
  title: string;
  /** Short looping preview (the finished example). */
  previewUrl: string;
  thumbUrl?: string;
  /** The source motion video — what Genjutsu extracts motion from. */
  videoUrl: string;
  duration: number;
}

type RawVariant = { type?: string; media?: { url?: string; thumbnail_url?: string } };
type RawItem = {
  id?: string; title?: string; job_set_type?: string;
  original_video?: { url?: string; duration?: number; thumbnail_url?: string };
  variants?: RawVariant[];
};

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\//.test(u);

/** Higgsfield's public motion library (community trending presets): links only, nothing is copied. */
export async function GET(req: NextRequest) {
  const cursor = Math.max(1, Math.min(500, Number(req.nextUrl.searchParams.get("cursor")) || 1));
  try {
    const res = await fetch(`${FEED}?lang=en&source=community&size=24&cursor=${cursor}&sort=trending`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return NextResponse.json({ error: "Motion library unavailable" }, { status: 502 });
    const data = (await res.json()) as { items?: RawItem[]; cursor?: number; total?: number };
    const items: MotionItem[] = [];
    for (const it of data.items ?? []) {
      const src = it.original_video;
      if (!it.id || !https(src?.url)) continue;
      const edit = it.variants?.find((v) => v.type === "edit")?.media;
      const dur = Number(src?.duration) || 0;
      if (dur && dur < 4) continue; // Genjutsu needs ≥4s
      items.push({
        id: it.id,
        title: it.title || "Motion",
        previewUrl: https(edit?.url) ? edit.url : src.url,
        thumbUrl: https(edit?.thumbnail_url) ? edit.thumbnail_url : https(src?.thumbnail_url) ? src.thumbnail_url : undefined,
        videoUrl: src.url,
        duration: dur,
      });
    }
    return NextResponse.json({ items, next: data.cursor ?? cursor + 1, total: data.total ?? 0 }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "Motion library unavailable" }, { status: 502 });
  }
}
