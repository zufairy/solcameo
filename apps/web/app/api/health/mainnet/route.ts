import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { mainnetReadiness } from "@/lib/server/mainnetReadiness";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Pre-launch money checklist. Operator-only (bearer INTERNAL_CRON_SECRET); never exposes secret values. */
export async function GET(req: NextRequest) {
  const expected = Buffer.from(process.env.INTERNAL_CRON_SECRET ?? "");
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await mainnetReadiness(), { headers: { "Cache-Control": "no-store" } });
}
