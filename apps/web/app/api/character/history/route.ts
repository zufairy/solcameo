import { NextRequest, NextResponse } from "next/server";
import { authorizeCharacterScope } from "@/lib/server/characterDraft";
import { getObjectText, imagePublicUrl, listImageObjects } from "@/lib/server/imageStorage";
import { characterResult } from "@/lib/server/characterResult";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const a = await authorizeCharacterScope(req, q.get("mint"), q.get("draft") === "1");
  if (a.error) return a.error;
  try {
    const prefix = `characters/${a.mint}/`;
    const records = await listImageObjects(prefix);
    // Resume recent accepted jobs even if the user closed the tab before completion.
    const recent = records.filter(o => o.key.startsWith(`${prefix}jobs/`)).slice(0,24);
    const recovered = await Promise.all(recent.map(async record => {
      try {
        const job = JSON.parse(await getObjectText(record.key) ?? "null");
        if (!job?.requestId) return null;
        const result = await characterResult(a.mint, job.requestId);
        return { job, result };
      } catch { return null; }
    }));
    const images = new Map<string, { url: string; model: string; ratio: string }>();
    // Legacy results have no job manifest but are still recoverable from the owner's generated-image folder.
    for (const record of records.filter(o => o.key.startsWith(`${prefix}gen/`) && /\.(png|jpe?g|webp)$/i.test(o.key)).slice(0,200)) {
      const url = imagePublicUrl(record.key);
      images.set(url, { url, model: "reference", ratio: "3:4" });
    }
    for (const entry of recovered) if (entry?.result.status === "completed" && "urls" in entry.result) {
      for (const url of entry.result.urls ?? []) images.set(url, { url, model: entry.job.model, ratio: entry.job.ratio });
    }
    return NextResponse.json({ images: [...images.values()], pending: recovered.filter(e => e && ["queued","in_progress"].includes(e.result.status)).length }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not load image history. Your stored portraits have not been deleted." }, { status: 502 }); }
}
