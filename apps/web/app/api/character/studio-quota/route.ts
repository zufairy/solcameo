import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/requireAuth";
import { studioAccountKey, studioQuota, studioTreasury } from "@/lib/server/studioGenBilling";
import { STUDIO_IMAGE_USD } from "@/lib/studio/pricing";

export const runtime = "nodejs";

/** Free allowance left, per-image price and the treasury the client pays into. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  try {
    const q = await studioQuota(auth.user);
    return NextResponse.json({ ...q, priceUsd: STUDIO_IMAGE_USD, treasury: studioTreasury(), account: studioAccountKey(auth.user) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not load your free generations." }, { status: 503 }); }
}
