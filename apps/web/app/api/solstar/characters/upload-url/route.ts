import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, internalSecret, requireProvenWallet } from "@/lib/server/solstarRoute";
export async function POST(req: NextRequest) {
  const auth = await requireProvenWallet(req);
  if ("res" in auth) return auth.res;
  const secret = internalSecret();
  if (!secret) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  if (req.body) {
    const reader = req.body.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) { await reader.cancel(); return NextResponse.json({ error: "body_too_large" }, { status: 413 }); }
    }
  }
  try { return NextResponse.json({ uploadUrl: await convexClient().mutation(api.solstarCreate.generateUploadUrl, { authSecret: secret }) }); }
  catch (error) { return errorResponse(error); }
}
