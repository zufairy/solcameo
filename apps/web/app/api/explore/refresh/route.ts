import { NextRequest, NextResponse } from "next/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { rebuildLibrary } from "@/lib/explore/library";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Re-scrape the whole reference library into R2 and memory. Called by a Convex cron; internal secret only. */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const snapshot = await rebuildLibrary();
  if (!snapshot) return NextResponse.json({ ok: false, error: "Upstream feed unavailable; the previous snapshot is kept." }, { status: 502 });
  return NextResponse.json({ ok: true, items: snapshot.items.length, total: snapshot.total, ms: Date.now() - started });
}
