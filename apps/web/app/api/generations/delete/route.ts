import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

// String ref so this typechecks before `npx convex deploy` regenerates api types.
const DELETE_GENERATION = makeFunctionReference<"mutation">("agentTasks:deleteGeneration");

/** Delete a generation + cancel its scheduled posts. Body: { id, mintAddress }. */
export async function POST(req: NextRequest) {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const { id, mintAddress } = (await req.json()) as { id?: string; mintAddress?: string };
  if (!id || !mintAddress) return NextResponse.json({ error: "missing id or mintAddress" }, { status: 400 });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
  if (!auth.internal) {
    if (!agent?.creatorWallet) return NextResponse.json({ error: "Forbidden — agent has no owner wallet" }, { status: 403 });
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }
  try {
    const res = await convex.mutation(DELETE_GENERATION, { id, mintAddress, authSecret: secret });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 500 });
  }
}
