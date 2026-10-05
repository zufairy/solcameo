import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as Res } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "./requireAuth";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** Auth + SIWS ownership of the agent. Returns an error response, or the mint to use. */
export async function authorizeCharacterOwner(
  req: NextRequest,
  mintAddress: string | null | undefined,
): Promise<{ error: NextResponse; mint?: never } | { error?: never; mint: string }> {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return { error: auth.error };
  const mint = (mintAddress ?? "").trim();
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(mint)) return { error: Res.json({ error: "mintAddress required" }, { status: 400 }) };
  if (!CONVEX_URL) return { error: Res.json({ error: "Convex not configured" }, { status: 500 }) };
  const agent = await new ConvexHttpClient(CONVEX_URL).query(api.influencers.getByMint, { mintAddress: mint });
  if (!agent) return { error: Res.json({ error: "Agent not found" }, { status: 404 }) };
  if (!auth.internal) {
    const ownerErr = requireOwnerWithSiws(auth, agent);
    if (ownerErr) return { error: ownerErr };
  }
  return { mint };
}

export const characterKey = (mint: string) => `characters/${mint}/character.json`;
