import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

export const runtime = "nodejs";

/**
 * Cancel a scheduled item. The Convex mutation scheduledContent.cancel is
 * secret-gated, so the client can no longer call it directly. This route
 * authenticates the operator (Privy Bearer) and ownership-scopes the supplied
 * mintAddress; the mutation itself then re-asserts the row's mintAddress equals
 * `expectedMintAddress` server-side, so a caller can't cancel another agent's
 * row by guessing its id. Body: { id, mintAddress }.
 */
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
    const err = requireOwnerWithSiws(auth, agent);
    if (err) return err;
  }

  await convex.mutation(api.scheduledContent.cancel, {
    id: id as Id<"scheduledContent">,
    expectedMintAddress: mintAddress,
    authSecret: secret,
  });
  return NextResponse.json({ ok: true });
}
