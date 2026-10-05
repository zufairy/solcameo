# Content-Reward View Sync — Decouple View Measurement from the On-Chain Vault

**Date:** 2026-06-30
**Status:** Approved (design) → ready for implementation plan
**Scope:** Make `/stage/reward` (content-reward) clip submissions show **real, updating view counts** — independent of the dead on-chain escrow vault — refreshed **at least twice a day**, plus an admin **"Sync Now"** button to force-refresh all clipping agents' view counts on demand.

---

## 1. Summary

Today the `/stage/reward` submission modal shows **Views: 0** for AI-clipping-agent posts even when they have real views. Root cause: the oracle only measures + backfills a content-reward submission's views when a **Convex `submissions` row** exists carrying its `contentRewardSubmissionId`, and that row is created **only inside the funded on-chain v2 vault bridge** (`clipJobs.ts:~1709-1730`) — which is the dead rail (stale escrow IDL). No funded vault → no Convex row → the oracle never measures → views stay 0.

But **view measurement is pure off-chain work** (an upload-post read + a Supabase write — `updateContentRewardViews`, `contentRewardApprove.ts:40`). This spec decouples it: track every content-reward clip post in a dedicated table, re-measure on a schedule (≥2×/day), and backfill the jobtepi display row — with **zero dependency on the vault or any payout**. Plus an admin Sync-Now trigger.

---

## 2. Goals / Non-goals

**Goals**
- Content-reward clips show real views on `/stage/reward`, first value appearing soon after posting (not at 48h).
- Views refresh **≥ 2×/day** automatically (target cadence ~3×/day for margin).
- Admin "Sync Now" button force-refreshes **all** tracked clipping-agent view counts immediately.
- No dependency on the on-chain vault / escrow IDL; works today.

**Non-goals (this iteration)**
- No change to the payout logic, the on-chain rails, or the `submissions` table.
- Vello-native campaign clips (they already create a Convex submission → already measured) — out of scope.
- UGC videos (they don't auto-submit to content-rewards yet) — out of scope.
- Manual "Post now" submissions (carry no analytics handles) — unchanged, still unmeasurable.

---

## 3. Background — verified current state

- **Display reads jobtepi:** the `/stage/reward` modal renders `submission.views` (`components/campaign/content-reward-detail.tsx:563`) from the Supabase `content_rewards_submissions.views` column (`lib/content-rewards.ts:201,252`). It is **read-only** here.
- **The only writer of that column** is `updateContentRewardViews({ submissionId, views })` (`lib/server/contentRewardApprove.ts:40`).
- **It's called once today**, from the oracle worker after settling a Convex submission (`app/api/oracle/run/route.ts:223-231`), gated on `s.contentRewardSubmissionId` being present.
- **That link is set only in the funded-v2 bridge** (`clipJobs.ts:~1709-1730`, via `submitClipToCampaign` which requires a Convex `campaignId`). Unfunded content-rewards → no Convex row → never measured.
- **Reusable pieces:** `getPostAnalytics()` (`lib/server/uploadPost.ts:522`, live per-call), `scoreSubmission()` (`lib/server/oracleFraud.ts:191`, view-field resolution + fraud checks), `updateContentRewardViews()` (`contentRewardApprove.ts:40`).
- **Auth patterns:** `requireAdmin()` (`convex/lib/auth.ts:9`) / `assertAdminUser` + `accessToken` (`convex/admin.ts`); crons POST to Next routes with `X-Internal-Secret` (`crons.ts`).

---

## 4. Design

### 4.1 Data model — new isolated table
`contentRewardMeasurements` (Convex), deliberately separate from `submissions` so it can **never** touch a payout path:

| field | type | note |
|---|---|---|
| `contentRewardId` | string | jobtepi content_reward id |
| `contentRewardSubmissionId` | string | the jobtepi row to backfill (unique key) |
| `mintAddress` | string | the clipping agent |
| `platform` | string | tiktok/instagram/youtube/x/… |
| `platformPostId` | optional string | analytics handle |
| `uploadPostRequestId` | optional string | analytics handle |
| `postedAt` | number | epoch ms |
| `viewCount` | optional number | last measured |
| `lastMeasuredAt` | optional number | epoch ms |
| `status` | "active" \| "stopped" | stop = closed or aged out |

Indexes: `by_submission` (`contentRewardSubmissionId`, for idempotent upsert) and `by_status` (`status`, for the worker scan).

### 4.2 Create the measurement row at post time
In `clipJobs.finalizeJob`, wherever a clip posts to a content-reward (we already have `crSubId` + the post handles), **always** upsert a `contentRewardMeasurements` row — **lift this out of the `if (fundedVault)` gate** at `clipJobs.ts:~1709`. So a tracking row is created whether or not a vault exists. Upsert is idempotent on `contentRewardSubmissionId`. Requires ≥1 analytics handle (`platformPostId` or `uploadPostRequestId`); skip if neither (unmeasurable).

### 4.3 The re-measure loop (≥2×/day)
- **New Next worker route** `POST /api/oracle/measure-views` (internal-secret gated), separate from `/api/oracle/run` so it can never disturb payout settlement. Accepts `{ force?: boolean }`. Per run:
  1. Query `active` measurement rows (batched, e.g. 100/run, oldest `lastMeasuredAt` first).
  2. For each: `getPostAnalytics()` → `scoreSubmission()` to resolve a sane `viewCount` → `updateContentRewardViews(contentRewardSubmissionId, viewCount)` → patch `viewCount` + `lastMeasuredAt`.
  3. **Stop rule:** mark `status:"stopped"` when the content-reward/campaign is closed **or** `postedAt` is older than `MEASURE_MAX_AGE_DAYS` (default **30**).
  4. Return `{ scanned, measured, updated, stopped, errors }`.
- **Schedule — new cron** `crons.interval("sync content-reward views", { hours: 8 }, …)` → POSTs the worker with the internal secret (`force:false`). Every 8h = **3×/day per post**, comfortably ≥2×. (The existing 30-min payout oracle cron is untouched.)
- **First reading:** the first 8h tick after the post exists; in practice the page leaves 0 within hours, not 48h. (Optionally tighten the first cron to also catch brand-new rows — keep simple: 8h is acceptable; revisit if "first value too slow.")

### 4.4 Admin "Sync Now" button
- **Button:** on an admin page (recommended `app/admin/agents/page.tsx`; `app/admin/crons` is an acceptable alternative), labelled **"Sync Now"**, with busy spinner + a result toast ("Refreshed N posts, updated M view counts, S stopped, E errors").
- **Convex action** `oracle.syncContentRewardViewsNow({ accessToken })`: `requireAdmin(accessToken)` (mirrors `convex/admin.ts`), then `fetch(${NEXT_PUBLIC_APP_URL}/api/oracle/measure-views, { X-Internal-Secret, body: { force: true } })`, returns the worker summary.
- **`force:true`** makes the worker re-measure **all** active rows immediately, ignoring any cadence gating — i.e. pulls fresh views for every tracked clipping-agent post on demand. Bounded to `active` rows + the same per-run batch/429 handling so a large fleet can't melt the rate limit (loops batches until done).

### 4.5 Rate-limit safety
Because we now poll repeatedly, add **429 / error back-off** to the analytics fetch path used by the worker (today `getPostAnalytics` has none): on 429, skip the row this run (it retries next cycle) and slow the batch. Reads stay within the upload-post plan (no per-call charge — only rate-limit budget).

---

## 5. What it deliberately does NOT change
- **Payout / settlement logic** — untouched; measurement rows have no payout path and can't mis-pay.
- **On-chain rails** — no dependency; works regardless of the escrow IDL.
- **`submissions` table & `/api/oracle/run`** — unchanged.
- **`/stage/reward` UI** — unchanged; it already reads `submission.views`, which now gets backfilled.

---

## 6. Auth model
- Cron → worker: `X-Internal-Secret` (existing pattern).
- Admin button → Convex action: Privy `accessToken` → `requireAdmin` (existing pattern) → worker with internal secret. The browser never holds the internal secret.

---

## 7. Edge cases & error handling
- **No analytics handle** → no measurement row created (unmeasurable; same as today).
- **Per-platform:** TikTok/YouTube/Instagram/Threads return real views; X uses impressions; **FB/LinkedIn/Reddit have no true view metric** → `scoreSubmission` yields proxy/0 → row stays measured-as-0 (display honest), not errored.
- **Analytics not ready / error** → leave `viewCount` as-is, retry next cycle; 429 → skip + back-off.
- **Idempotent upsert** on `contentRewardSubmissionId` (re-posts/duplicates don't create dupes).
- **Aged/closed** → `status:"stopped"`, excluded from future runs (and from Sync Now).
- **`NEXT_PUBLIC_APP_URL` unset in Convex env** → action/cron log + no-op (matches existing oracle behavior).

---

## 8. Testing / verification
- **Unit:** worker due-selection (active vs stopped, batch order); stop rule (age/closed); `buildViewsBackfillPatch` (already tested); 429 back-off branch; admin-action `requireAdmin` rejection.
- **Integration:** mock `getPostAnalytics` → assert `updateContentRewardViews` called with the scored count + `lastMeasuredAt` patched; assert `force:true` ignores cadence and processes all active rows; assert a `stopped` row is skipped.
- **Manual:** post a content-reward clip → confirm a measurement row is created without a funded vault → run Sync Now → `/stage/reward` shows the real count within seconds.
- Run existing oracle/clip test suites + lint/build before completion.

---

## 9. Out of scope / future
- Extending measurement to Vello-native unfunded campaigns or UGC.
- Surfacing the live view count anywhere beyond `/stage/reward` (e.g. the agent cockpit).
- A tapering cadence (8h flat is the v1; revisit if cost/freshness needs tuning).

---

## 10. Open questions
None blocking. Defaults chosen: cadence **every 8h (3×/day)**; first read on the first tick after the post exists; **stop after 30d or campaign close**; Sync Now lives on `app/admin/agents`; measurement table kept separate from `submissions`.
