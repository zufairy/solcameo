import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { syncViewsForMints } from "@/lib/server/analyticsSync";

export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");
const LIST_ALL_MINTS = makeFunctionReference<"query">("influencers:listAllMintAddresses");

const CHUNK = 25;
const CLIPS_LIMIT = 400;
const SUBS_LIMIT = 400;
const DEADLINE_MS = 270_000;

/**
 * Admin "Sync all views" on /admin/posts. Same engine as the user-facing
 * /analytics Refresh and the 5-min cron (lib/server/analyticsSync
 * .syncViewsForMints → upload-post analytics API → clips.viewCount +
 * submissions.viewCount), but over EVERY agent in one click, streamed as NDJSON
 * progress so the button shows real work. The admin table is a reactive
 * Convex query, so rows update live as each view count lands.
 *
 * The previous button called /api/oracle/scrape-views per platform — that
 * route only knows tiktok/instagram/youtube (hence "Invalid platform" for
 * facebook/x/threads) and syncs content-reward measurement handles, not the
 * posted `clips` this page lists (hence "0 fetched").
 *
 * Auth: INTERNAL_CRON_SECRET header OR an admin Supabase token in the body.
 */
export async function POST(req: NextRequest) {
  if (!process.env.INTERNAL_CRON_SECRET || !CONVEX_URL) {
    return NextResponse.json({ ok: false, error: "Not configured" }, { status: 500 });
  }
  const convex = new ConvexHttpClient(CONVEX_URL);
  const body = (await req.json().catch(() => ({}))) as { accessToken?: string; mintAddresses?: string[] };
  if (!checkInternalSecret(req)) {
    if (!body.accessToken) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const chk = (await convex.action(CHECK_ADMIN, { accessToken: body.accessToken }).catch(() => null)) as { admin: boolean } | null;
    if (!chk?.admin) return NextResponse.json({ ok: false, error: "Admin only" }, { status: 403 });
  }
  const secret = process.env.INTERNAL_CRON_SECRET;

  const requested = Array.isArray(body.mintAddresses) ? body.mintAddresses.filter((m) => typeof m === "string" && m) : [];
  const mintAddresses = requested.length > 0
    ? [...new Set(requested)]
    : ((await convex.query(LIST_ALL_MINTS, {}).catch(() => [])) as string[]);
  if (mintAddresses.length === 0) {
    return NextResponse.json({ ok: true, agents: 0, scanned: 0, updated: 0, note: "No agents" });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const startedAt = Date.now();
      const chunks: string[][] = [];
      for (let i = 0; i < mintAddresses.length; i += CHUNK) chunks.push(mintAddresses.slice(i, i + CHUNK));
      const totals = { scanned: 0, measured: 0, updated: 0, errors: 0 };
      send({ type: "start", agents: mintAddresses.length, chunks: chunks.length });
      try {
        let done = 0;
        for (const chunk of chunks) {
          const remaining = DEADLINE_MS - (Date.now() - startedAt);
          if (remaining < 8_000) { send({ type: "note", note: `time budget reached after ${done}/${chunks.length} agent groups` }); break; }
          const r = await syncViewsForMints({
            convex, secret, mintAddresses: chunk,
            clipsLimit: CLIPS_LIMIT, subsLimit: SUBS_LIMIT, deadlineMs: remaining,
            onProgress: (scanned, total) => send({ type: "progress", chunk: done + 1, chunks: chunks.length, scanned, total, updated: totals.updated }),
          });
          done++;
          totals.scanned += r.scanned; totals.measured += r.measured; totals.updated += r.updated; totals.errors += r.errors;
          send({ type: "chunk", chunk: done, chunks: chunks.length, ...totals });
        }
        send({ type: "done", ok: true, agents: mintAddresses.length, chunksRun: done, chunksTotal: chunks.length, ...totals });
      } catch (e) {
        send({ type: "done", ok: false, error: e instanceof Error ? e.message : "Sync failed", ...totals });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
