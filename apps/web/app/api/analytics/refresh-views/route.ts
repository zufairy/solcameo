import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { requireAuth } from "@/lib/server/requireAuth";
import { LIST_BY_CREATORS, syncViewsForMints } from "@/lib/server/analyticsSync";

export const maxDuration = 30;
export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

// Interactive refresh: was capped at 60+60=120 rows total, which silently
// truncated an operator with more posted videos than that (a 146-posted
// account only ever saw ~85 "checked" — the rest never got attempted, not
// even considered stale). Raised to comfortably cover a full-catalog account;
// the per-pass worker pool (analyticsSync.ts, concurrency 16) plus the
// deadline-checked loop still bail out gracefully if a slow upstream call
// eats the budget, so this is a ceiling, not a guaranteed full scan.
const CLIPS_LIMIT = 400;
const SUBS_LIMIT = 400;
// Kept under maxDuration so a slow/hanging upstream call can't turn "click
// Refresh" into a multi-minute wait — leaves ~5s of maxDuration headroom for
// the stream to flush its final line and close cleanly.
const DEADLINE_MS = 25_000;

/**
 * User-facing "Refresh" on /analytics. See lib/server/analyticsSync.ts for the
 * actual sync engine (shared with the background cron in
 * app/api/analytics/sync-cron/route.ts, which covers ALL agents automatically
 * so the page no longer depends on someone remembering to click this).
 * Ownership is derived server-side from the authenticated Privy user's linked
 * wallets — the client never gets to name arbitrary mints.
 */
export async function POST(req: NextRequest) {
  if (!process.env.INTERNAL_CRON_SECRET || !CONVEX_URL) {
    return NextResponse.json({ ok: false, error: "Not configured" }, { status: 500 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const secret = process.env.INTERNAL_CRON_SECRET;
  const convex = new ConvexHttpClient(CONVEX_URL);

  const wallets = (auth.user.walletAddresses ?? []).filter(Boolean);
  if (wallets.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, updated: 0, note: "No linked wallet" });
  }

  const owned = (await convex
    .query(LIST_BY_CREATORS, { creatorWallets: wallets })
    .catch(() => [])) as { mintAddress: string }[];
  const mintAddresses = [...new Set(owned.map((a) => a.mintAddress))];
  if (mintAddresses.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, updated: 0, note: "No agents" });
  }

  // Stream NDJSON (one JSON object per line) instead of a single buffered
  // response — syncViewsForMints' onProgress fires in real time as each row
  // clears the official upload-post analytics call, so the client can render
  // a determinate progress bar keyed to actual rows-done/total instead of
  // faking one against a timer or leaving the button spinning with no signal.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      // Flush a byte immediately, before the first Convex round-trip — Railway's
      // edge proxy (railway-hikari) has been seen returning 503 on this route
      // when TTFB is slow, since it has no bytes yet to tell it the backend is
      // alive. This line is a no-op for the client (falls through the `else`
      // branch in the reader loop) but guarantees sub-second TTFB every time.
      send({ type: "start" });
      try {
        const result = await syncViewsForMints({
          convex, secret, mintAddresses,
          clipsLimit: CLIPS_LIMIT, subsLimit: SUBS_LIMIT, deadlineMs: DEADLINE_MS,
          onProgress: (scanned, total) => send({ type: "progress", scanned, total }),
        });
        send({ type: "done", ok: true, ...result });
      } catch (e) {
        send({ type: "done", ok: false, error: e instanceof Error ? e.message : "Sync failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
