import { NextRequest, NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, isConvexIdString, jsonSafe, prepareAuthedJson } from "@/lib/server/solstarRoute";
import { ensureInfluencerWallet } from "@/lib/server/agentWallet";
import { launchOptionsSchema } from "@/lib/pump/economics";
export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;
  if (typeof body.name !== "string" || typeof body.ticker !== "string" || typeof body.bio !== "string" || typeof body.category !== "string" || !isConvexIdString(body.imageStorageId) || typeof body.rightsAttested !== "boolean" || typeof body.idempotencyKey !== "string") return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const options = body.launchOptions === undefined ? undefined : launchOptionsSchema.safeParse(body.launchOptions);
  if (options && !options.success) return NextResponse.json({ error: "invalid_launch_options" }, { status: 400 });
  try {
    const result = await convexClient().mutation(api.solstarCreate.createCharacter, {
      ...(options?.success ? { launchOptions: options.data } : {}),
      wallet, name: body.name, ticker: body.ticker.toUpperCase(), bio: body.bio, category: body.category,
      imageStorageId: body.imageStorageId as Id<"_storage">, rightsAttested: body.rightsAttested, idempotencyKey: body.idempotencyKey, authSecret: secret,
    });
    const walletSetup = await ensureInfluencerWallet(result.agentMintAddress);
    return NextResponse.json(jsonSafe({ ...result, agentWallet: walletSetup.agentWallet }));
  } catch (error) { return errorResponse(error); }
}
