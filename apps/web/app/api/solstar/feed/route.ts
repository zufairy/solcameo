import { loadCalloutTrades } from "@/lib/server/calloutTrades";
import { tradeCallText, type CalloutTrade } from "@/lib/solstar/calloutTrade";
import { isCalloutAttachment, isGiphyUrl, CALLOUT_MEDIA_LIMIT } from "@/lib/solstar/calloutMedia";
import { NextResponse, type NextRequest } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { convexClient, errorResponse, prepareAuthedJson, isConvexIdString } from "@/lib/server/solstarRoute";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const prep = await prepareAuthedJson(req, 12288);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;

  const text = body.body;
  if (typeof text !== "string") return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (body.characterId !== undefined && !isConvexIdString(body.characterId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  if (body.calloutMetric !== undefined && !["earnings", "views", "trade"].includes(String(body.calloutMetric))) return NextResponse.json({ error: "invalid_callout_metric" }, { status: 400 });
  if (body.tradePnlUsd !== undefined || body.onchainTrade !== undefined) return NextResponse.json({ error: "Manual trade P&L is not supported." }, { status: 400 });
  if (body.calloutMetric === "trade" && (typeof body.tradeMint !== "string" || body.tradeMint.length < 32 || body.tradeMint.length > 44)) return NextResponse.json({ error: "Select a traded coin." }, { status: 400 });

  if (body.attachments !== undefined) {
    const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");
    if (!Array.isArray(body.attachments) || body.attachments.length > CALLOUT_MEDIA_LIMIT || !body.attachments.every(a => isCalloutAttachment(a) && (isGiphyUrl(a.url) || (base && a.url.startsWith(`${base}/callouts/`))))) return NextResponse.json({ error: "invalid_attachment" }, { status: 400 });
  }
  try {
    let onchainTrade: CalloutTrade | undefined;
    if (body.calloutMetric === "trade") {
      const result = await loadCalloutTrades(wallet, String(body.tradeMint), true);
      onchainTrade = result.coins.find(t => t.mint === body.tradeMint);
      if (!onchainTrade) return NextResponse.json({ error: "No verified trade and complete cost basis found for this coin. Refresh and try again." }, { status: 422 });
    }
    const res = await convexClient().mutation(api.solstarFeed.postChat, { wallet, body: text.trim() || (onchainTrade ? tradeCallText(onchainTrade) : text), ...(onchainTrade ? { onchainTrade } : {}), ...(Array.isArray(body.attachments) ? { attachments: body.attachments as import("@/lib/solstar/calloutMedia").CalloutAttachment[] } : {}), authSecret: secret, ...(body.characterId && body.calloutMetric !== "trade" ? { characterId: body.characterId as Id<"ssCharacters"> } : {}), ...(typeof body.theme === "string" ? { theme: body.theme } : {}), ...(typeof body.callCapSol === "number" ? { callCapSol: body.callCapSol } : {}), ...(body.calloutMetric ? { calloutMetric: body.calloutMetric as "earnings" | "views" | "trade" } : {}),  });
    return NextResponse.json({ ...res, ...(onchainTrade ? { onchainTrade } : {}) });
  } catch (e) {
    return errorResponse(e);
  }
}
