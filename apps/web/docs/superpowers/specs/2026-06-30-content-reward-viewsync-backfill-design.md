# Content-Reward View-Sync — Backfill Existing Posts

**Date:** 2026-06-30
**Status:** Approved (design) → implementing
**Scope:** One-shot, admin-triggered backfill that seeds `contentRewardMeasurements` rows for content-reward clips posted BEFORE the view-sync feature, so the worker / Sync-Now measures their views too. Follow-up to `2026-06-30-content-reward-view-sync-design.md`.

## Why it's possible
Posted clips persist their analytics handles on the Convex `clips` table — `platformPostId` / `uploadPostRequestId` + `postUrl` + `platform` (written by `setClip`, `clipJobs.ts:116-120`; schema `1051-1056`). Each clip's `clipJob` carries `contentRewardId` (`schema:1004`). So existing content-reward posts (funded OR unfunded) are recoverable — no fragile upload-post media-recovery needed.

## Design
1. **Candidate query** — `contentRewardMeasurements.backfillCandidates` (public, secret-gated). Scans the most-recent N `clipJobs` (`order("desc").take(jobLimit)`, default 500, cap 2000 — best-effort/bounded), keeps those with a `contentRewardId`, and for each emits its `clips` (via `by_job`) that are `status:"posted"`, have a `postUrl`, and have a `platformPostId` or `uploadPostRequestId`. Emits `{ contentRewardId, mintAddress, platform, platformPostId, uploadPostRequestId, postUrl, postedAt }`.
2. **Supabase match helper** — `findContentRewardSubmissionId({ contentRewardId, contentUrl })` in `lib/server/contentRewardApprove.ts` (co-located with the existing Supabase client). Looks up `content_rewards_submissions.id` where `content_reward_id == contentRewardId` AND `content_url == postUrl`. Returns the id or null.
3. **Backfill worker route** — `POST /api/oracle/backfill-measurements` (internal-secret gated, nodejs). Pulls candidates from Convex → for each, resolves the ryze submission id via the helper → `upsert`s a measurement row (reuses the existing idempotent `upsert`). Small concurrency. Returns `{ scanned, matched, seeded, skipped, errors }`.
4. **Admin action** — `contentRewardMeasurements.backfillNow({ accessToken })` (admin-gated via `resolveAdmin`) → drives the route with the internal secret → returns the summary.
5. **Admin button** — "Backfill old posts" on `/admin/agents`, beside "Sync views now". Backfill **seeds**; the operator then clicks **Sync views now** (or waits for the 8h cron) to measure.

## Best-effort caveats
- Matches clip↔ryze **by URL** — a clip whose permalink never resolved (posted with a fallback URL that differs from the ryze `content_url`) won't match → counted as `skipped`, not errored.
- Scans the recent N clipJobs (bounded); very old content-reward jobs beyond the cap aren't reached (re-run with a larger `jobLimit` if needed).
- Idempotent (`upsert` no-ops on an existing `contentRewardSubmissionId`); safe to re-run.

## What it does NOT change
Payouts, on-chain, the worker, the `contentRewardMeasurements` schema (reuses `upsert`), the `/stage/reward` UI.

## Testing
- Manual: click Backfill old posts → see `seeded`/`matched`/`skipped` → click Sync views now → existing `/stage/reward` posts show real views.
- The candidate filter + the Supabase match are the load-bearing bits; verify via the returned counts.

## Touch points
`convex/contentRewardMeasurements.ts` (+`backfillCandidates` query, +`backfillNow` action) · `lib/server/contentRewardApprove.ts` (+`findContentRewardSubmissionId`) · `app/api/oracle/backfill-measurements/route.ts` (new) · `components/admin/agents-section.tsx` (+button). Needs the same `npx convex deploy` + Next redeploy as the parent feature.
