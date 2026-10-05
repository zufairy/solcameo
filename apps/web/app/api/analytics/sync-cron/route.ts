import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { syncViewsForMints } from "@/lib/server/analyticsSync";

export const maxDuration = 60;
export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const LIST_ALL_MINTS = makeFunctionReference<"query">("influencers:listAllMintAddresses");

// Per-tick cap across ALL agents (not per-agent) — bounds the tick's cost the
// same way the interactive route bounds one operator's click. Running every
// ~20 min (see convex/crons.ts), this steadily cycles through recent activity
// across every agent instead of only refreshing when someone happens to open
// /analytics and click Refresh — which is the actual gap this route closes:
// the Analytics page's Convex queries are already reactive (live-updating),
// the view COUNTS themselves just never got refreshed automatically.
const CLIPS_LIMIT = 200;
const SUBS_LIMIT = 200;
const DEADLINE_MS = 50_000;

/**
 * Background driver for lib/server/analyticsSync.ts, covering EVERY minted
 * agent instead of one operator's owned mints. Called on an interval by
 * convex/crons.ts ("sync analytics views") — see that file for the cadence
 * rationale. Internal-secret-gated; never reachable from the browser.
 */
export async function POST(req: NextRequest) {
  if (!process.env.INTERNAL_CRON_SECRET || !CONVEX_URL) {
    return NextResponse.json({ ok: false, error: "Not configured" }, { status: 500 });
  }
  const secret = req.headers.get("X-Internal-Secret") ?? "";
  if (secret !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const convex = new ConvexHttpClient(CONVEX_URL);

  const mintAddresses = (await convex.query(LIST_ALL_MINTS, {}).catch(() => [])) as string[];
  if (mintAddresses.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, updated: 0, note: "No agents" });
  }

  // clipJobs.dueForScrapeByMints silently caps to the FIRST 25 mints it's
  // given (`mints.slice(0, 25)`) — passing every mint in one call would only
  // ever sync the newest 25 agents and starve the rest forever. Chunk into
  // batches of 25 and rotate the STARTING chunk by wall-clock tick so every
  // agent's turn comes up over successive runs instead of always starting
  // from the same front of the list.
  const CHUNK = 25;
  // Must match convex/crons.ts's "sync analytics views" interval so each tick
  // rotates to the NEXT chunk instead of re-processing the same one twice.
  const ROTATE_MS = 5 * 60_000;
  const chunks: string[][] = [];
  for (let i = 0; i < mintAddresses.length; i += CHUNK) chunks.push(mintAddresses.slice(i, i + CHUNK));
  const rotate = Math.floor(Date.now() / ROTATE_MS) % chunks.length;
  const ordered = [...chunks.slice(rotate), ...chunks.slice(0, rotate)];

  const startedAt = Date.now();
  const totals = { scanned: 0, measured: 0, updated: 0, errors: 0, clipsDueCount: 0, withHandleCount: 0, backfillCount: 0, subsDueCount: 0 };
  let chunksRun = 0;
  for (const chunk of ordered) {
    const remaining = DEADLINE_MS - (Date.now() - startedAt);
    if (remaining < 8_000) break; // not enough budget left for another chunk to do meaningful work
    const r = await syncViewsForMints({
      convex, secret, mintAddresses: chunk,
      clipsLimit: CLIPS_LIMIT, subsLimit: SUBS_LIMIT, deadlineMs: remaining,
    });
    chunksRun++;
    totals.scanned += r.scanned; totals.measured += r.measured; totals.updated += r.updated; totals.errors += r.errors;
    totals.clipsDueCount += r.clipsDueCount; totals.withHandleCount += r.withHandleCount;
    totals.backfillCount += r.backfillCount; totals.subsDueCount += r.subsDueCount;
  }

  console.log(`[analytics/sync-cron] agents=${mintAddresses.length} chunks=${chunksRun}/${ordered.length} scanned=${totals.scanned} measured=${totals.measured} updated=${totals.updated} errors=${totals.errors}`);
  return NextResponse.json({ ok: true, agents: mintAddresses.length, chunksRun, chunksTotal: ordered.length, ...totals });
}
