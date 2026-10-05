import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { getAgentQuotaIdentity } from "@/lib/server/agentQuota";

export async function GET(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;
  if (auth.internal) return NextResponse.json({ error: "User session required" }, { status: 400 });
  try {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return NextResponse.json({ error: "Convex not configured" }, { status: 503 });
    const convex = new ConvexHttpClient(url);
    const identity = await getAgentQuotaIdentity(convex, auth.user, auth.provenWallet);
    const quote = await convex.query(api.mintFee.quoteMintFee, {
      creatorWallet: identity.creatorWallets[0] || "",
      creatorWallets: identity.creatorWallets, creatorDid: identity.creatorDid,
      agentLimit: identity.agentLimit, standardFeeUsdc: 0, forceFree: true,
    });
    return NextResponse.json({
      agents: identity.agents, agentCount: quote.priorMints,
      agentLimit: quote.agentLimit,
      canCreate: identity.agentLimit < 0 || quote.priorMints < identity.agentLimit,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not check agent limit. Please retry." }, { status: 503 });
  }
}
