import { NextResponse } from "next/server";
import { fetchLanding } from "@/lib/solami/blur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** Beam's public landing lookup for one signature: did it land, via Jito or not, which region, and what was tipped. */
export async function GET(req: Request) {
  const signature = new URL(req.url).searchParams.get("signature")?.trim() ?? "";
  if (!SIGNATURE.test(signature)) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  try {
    const landing = await fetchLanding(signature);
    return NextResponse.json({ signature, seenByBeam: !!landing, landing }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "lookup_failed" }, { status: 502 }); }
}
