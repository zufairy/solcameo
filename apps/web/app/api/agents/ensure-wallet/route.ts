import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, prepareAuthedJson } from "@/lib/server/solstarRoute";
import { ensureInfluencerWallet } from "@/lib/server/agentWallet";

export const runtime = "nodejs";

/** Makes sure the caller's agent has a funding wallet and returns its address (idempotent). */
export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req, 512);
  if (!prep.ok) return prep.res;
  const { body, wallet } = prep;
  if (typeof body.mintAddress !== "string" || !/^[A-Za-z0-9]{1,64}$/.test(body.mintAddress)) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  try {
    const agent = await convexClient().query(api.influencers.getByMint, { mintAddress: body.mintAddress });
    if (!agent) return NextResponse.json({ error: "character_not_found" }, { status: 404 });
    if (agent.creatorWallet !== wallet) return NextResponse.json({ error: "not_owner" }, { status: 403 });
    const { agentWallet } = await ensureInfluencerWallet(body.mintAddress);
    return NextResponse.json({ agentWallet });
  } catch (e) { return errorResponse(e); }
}
