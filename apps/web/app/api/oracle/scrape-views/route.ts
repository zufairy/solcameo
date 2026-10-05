import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { fetchScrapedViews, fetchUploadPostViews, type ScrapePlatform } from "@/lib/server/scraperService";
import { listDueRewardSubmissions, setRewardSubmissionViews } from "@/lib/server/contentRewardSubmissions";

export const maxDuration = 300;
export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
// String refs so this typechecks before `npx convex deploy` regenerates types.
const SET_PROGRESS = makeFunctionReference<"mutation">("submissions:setSyncProgress");
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");
const ACTIVE_HANDLES = makeFunctionReference<"query">("contentRewardMeasurements:activeHandles");
// Convex campaign/clipping `submissions` store (the "campaign that joined" rows) —
// synced in a second pass so their views + permalink stay fresh WITHOUT waiting for
// the on-chain oracle to settle. See the CONVEX PASS below.
const DUE_CONVEX = makeFunctionReference<"query">("submissions:dueForScrape");
const RECORD_CONVEX = makeFunctionReference<"mutation">("submissions:recordScrapedViews");

type ConvexDueRow = {
  _id: string;
  postUrl: string | null;
  platform: string;
  viewCount: number;
  uploadPostRequestId: string | null;
  platformPostId: string | null;
  influencerMint: string;
};

type Handle = { contentRewardSubmissionId: string; uploadPostRequestId: string | null; platformPostId: string | null; mintAddress: string; platform: string };

// yt-dlp metadata probes (over the residential proxy) take a few seconds each, so
// the worker is BOTH count-bounded (BATCH) and time-bounded (DEADLINE_MS): it
// stops launching new probes once the deadline passes and returns what it has
// with `capped:true` — telling the admin to click again (and the page polls so
// the freshly-written counts already show). Rows written so far persist.
const BATCH = 40;
const CONCURRENCY = 3; // matches jobtepi — keeps residential-proxy contention low (fewer 403/timeouts)
const DEADLINE_MS = 110_000;

/**
 * Residential-proxy view-sync worker. For one platform (tiktok | instagram |
 * youtube), re-reads each AI clipper / content-reward submission's live view
 * count via vello's own scraper stack (yt-dlp + the YTDLP_PROXY residential
 * proxy) and writes it back onto the Supabase `content_rewards_submissions` row.
 * View counts never decrease.
 *
 * Auth: the internal cron secret (X-Internal-Secret) OR an admin Supabase token
 * (`accessToken` in the body). The admin path is what the browser uses — it calls
 * this route SAME-ORIGIN, so it works on localhost and prod without depending on
 * NEXT_PUBLIC_APP_URL (the cloud-action indirection 404'd against prod).
 */
export async function POST(req: NextRequest) {
  if (!process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  const convex = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;

  const body = (await req.json().catch(() => ({}))) as { platform?: string; accessToken?: string; mode?: string };
  const platform = body.platform as ScrapePlatform;
  if (!["tiktok", "instagram", "youtube"].includes(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }
  // mode "analytics" → upload-post analytics only (official API, no proxy).
  // mode "all" → same as analytics-only for stability.
  // mode "scrape" (default) → proxy scrape only.
  const useUploadPost = body.mode === "all" || body.mode === "analytics";
  // Convex-pass proxy fallback when upload-post analytics can't measure a row:
  // "all" may fall back to a residential-proxy scrape; "analytics" stays
  // official-API-only. (Was referenced without ever being defined — a
  // ReferenceError that killed the whole Convex sync pass at runtime.)
  const allowProxyFallback = body.mode === "all";

  // Authorize: internal secret OR an admin Supabase token (verified via Convex).
  if (!checkInternalSecret(req)) {
    if (!body.accessToken || !convex) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const chk = (await convex.action(CHECK_ADMIN, { accessToken: body.accessToken }).catch(() => null)) as { admin: boolean } | null;
    if (!chk?.admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const dueRes = await listDueRewardSubmissions(platform, BATCH);
  if (!dueRes.ok) {
    return NextResponse.json({ ok: false, error: dueRes.error ?? "due list failed" }, { status: 500 });
  }
  const due = dueRes.rows;

  // Upload-post handles per submission (request_id + mint) for the upload-post path.
  const handleBySubmission = new Map<string, { requestId: string | null; mintAddress: string }>();
  if (useUploadPost && convex) {
    try {
      const handles = (await convex.query(ACTIVE_HANDLES, { authSecret: secret })) as Handle[];
      for (const h of handles) {
        handleBySubmission.set(h.contentRewardSubmissionId, { requestId: h.uploadPostRequestId, mintAddress: h.mintAddress });
      }
    } catch { /* no handles → upload-post lookups will report no_handle */ }
  }

  // Live progress (best-effort): the admin page subscribes to submissions.getSyncProgress.
  const startedAt = Date.now();
  let scanned = 0;
  let measured = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let timedOut = false;

  async function pushProgress(running: boolean, note?: string) {
    if (!convex) return;
    try {
      await convex.mutation(SET_PROGRESS, {
        authSecret: secret, platform, total: due.length, done: scanned, updated, running, startedAt,
        ...(running ? {} : { finishedAt: Date.now() }), ...(note ? { note } : {}),
      });
    } catch { /* progress is best-effort — never fail the sync over it */ }
  }

  await pushProgress(true);

  let idx = 0;
  async function runOne() {
    while (idx < due.length) {
      if (Date.now() - startedAt > DEADLINE_MS) { timedOut = true; break; }
      const row = due[idx++];
      scanned += 1;
      try {
        let r;
        if (useUploadPost) {
          // Upload-post analytics (official platform API) — no residential proxy.
          const h = handleBySubmission.get(row.id);
          r = await fetchUploadPostViews({
            platform,
            requestId: h?.requestId ?? null,
            postUrl: row.contentUrl,
            mintAddress: h?.mintAddress ?? null,
          });
        } else {
          // Per-platform button → residential-proxy scrape only (sticky session + retry).
          r = await fetchScrapedViews(platform, row.contentUrl);
        }
        if (r.ok) {
          measured += 1;
          // Backfill the real permalink the upload-post analytics resolved (only set
          // on the upload-post path) when the stored content_url is the raw clip/CDN
          // url — so a genuinely-posted clip stops showing "not posted"/no-link.
          const rec = await setRewardSubmissionViews(row.id, r.views, row.views, {
            resolvedPostUrl: r.postUrl ?? null,
            currentContentUrl: row.contentUrl,
          });
          if (rec.updated || rec.linkUpdated) updated += 1;
        } else {
          skipped += 1;
        }
      } catch (e) {
        errors += 1;
        console.warn(`[scrape-views] ${platform} row ${row.id} errored:`, e instanceof Error ? e.message : e);
      }
      await pushProgress(true); // tick after each row → realtime bar
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, due.length)) }, () => runOne()));

  // ── CONVEX PASS ────────────────────────────────────────────────────────────
  // Also sync the Convex campaign/clipping `submissions` (the "campaign that joined"
  // rows). These are a SEPARATE store from the Supabase content-reward rows above
  // and were never synced by this worker (submissions:dueForScrape/recordScrapedViews
  // had no callers) — so a clipping agent's campaign post sat at 0 views with no link
  // until the on-chain oracle settled it. Measure each by its upload-post handle
  // (request_id → analytics, needs NO url) with a proxy-scrape fallback, and backfill
  // views + the resolved permalink. Best-effort + time-bounded; never fails the run.
  if (convex && Date.now() - startedAt < DEADLINE_MS) {
    try {
      const convexDue = (await convex.query(DUE_CONVEX, { authSecret: secret, platform, limit: BATCH })) as ConvexDueRow[];
      let cidx = 0;
      async function runOneConvex() {
        while (cidx < convexDue.length) {
          if (Date.now() - startedAt > DEADLINE_MS) { timedOut = true; break; }
          const row = convexDue[cidx++];
          scanned += 1;
          try {
            let r;
            if (useUploadPost) {
              r = await fetchUploadPostViews({
                platform,
                requestId: row.uploadPostRequestId,
                postUrl: row.postUrl,
                mintAddress: row.influencerMint,
              });
              if (!r.ok && allowProxyFallback && row.postUrl) r = await fetchScrapedViews(platform, row.postUrl);
            } else if (row.postUrl) {
              r = await fetchScrapedViews(platform, row.postUrl);
            } else {
              r = { ok: false as const, reason: "no_url_or_handle" };
            }
            if (r.ok) {
              measured += 1;
              const rec = (await convex!.mutation(RECORD_CONVEX, {
                authSecret: secret,
                id: row._id,
                viewCount: r.views,
                ...(r.postUrl ? { postUrl: r.postUrl } : {}),
                ...(r.platformPostId ? { platformPostId: r.platformPostId } : {}),
              })) as { ok: boolean; updated: boolean };
              if (rec.updated) updated += 1;
            } else {
              skipped += 1;
            }
          } catch (e) {
            errors += 1;
            console.warn(`[scrape-views] ${platform} CONVEX row ${row._id} errored:`, e instanceof Error ? e.message : e);
          }
          await pushProgress(true);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, convexDue.length)) }, () => runOneConvex()));
    } catch (e) {
      console.warn(`[scrape-views] ${platform} convex pass failed:`, e instanceof Error ? e.message : e);
    }
  }

  const capped = timedOut || idx < due.length || due.length >= BATCH;
  const note = `${measured} fetched · ${updated} updated${skipped ? ` · ${skipped} skipped` : ""}${errors ? ` · ${errors} errors` : ""}${capped ? " · more pending" : ""}`;
  await pushProgress(false, note);

  return NextResponse.json({ ok: true, platform, scanned, measured, updated, skipped, errors, capped });
}
