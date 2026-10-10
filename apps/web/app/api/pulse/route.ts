import { NextResponse } from "next/server";
import { pulseHub } from "@/lib/solami/pulseHub";
import { solamiDataKey } from "@/lib/solami/blur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live Solana market pulse from Solami Blur. Polling this keeps the shared stream open; the key never reaches the browser. */
export async function GET(req: Request) {
  const hub = pulseHub();
  if (new URL(req.url).searchParams.get("retry") === "1") hub.resume();
  hub.touch();
  const now = Date.now();
  const feeds = hub.agg.feeds();
  // Attach names/logos the stream has resolved so the page never needs a second lookup.
  const named = <T extends { mint: string }>(rows: T[]) => rows.map((r) => ({ ...r, ...(hub.agg.metaFor(r.mint) ?? {}) }));
  return NextResponse.json({
    configured: !!solamiDataKey(),
    now,
    stream: hub.snapshot(),
    window: hub.agg.window(15, now),
    feeds: { launches: feeds.launches, bigSwaps: named(feeds.bigSwaps), surges: named(feeds.surges), graduations: named(feeds.graduations), liquidity: named(feeds.liquidity) },
  }, { headers: { "Cache-Control": "no-store" } });
}
