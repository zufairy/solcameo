# Supabase exit gate

The Stage board and old `/stage/reward/:id` links now read Convex and only show
campaigns finalized on the v2 on-chain treasury rail. This does **not** mean the
rest of the application can run with Supabase disabled yet.

## Remaining live dependencies

| Area | Current source | Required replacement |
| --- | --- | --- |
| Legacy content rewards, submissions, owners, communities | `lib/content-rewards.ts` (Supabase Postgres) | Export and backfill records into indexed Convex tables; switch arena, scanner, admin, builder, and campaign-source readers. |
| Content-reward post/approve/view updates | `lib/server/contentRewardSubmit.ts`, `contentRewardSubmissions.ts`, `contentRewardApprove.ts`, `/api/arena/views` | Convex mutations/queries with existing SIWS/internal authorization; preserve submission IDs, idempotency, and approval state. Never infer an on-chain payout from a copied legacy status. |
| Legacy reward source matching | `lib/server/campaignSourceMatch.ts`, `campaignSources.ts`, `/api/campaigns/match-content-reward`, `convex/campaignTranscribe.autoLinkContentReward` | Resolve against funded Convex campaign sources and return a Convex campaign ID. The automatic Supabase link from new campaign creation has been stopped. |
| Stock UGC clips | `lib/server/stockClips.ts` (Supabase Storage) | Copy original objects into R2, then list the R2 prefix. Do not switch the reader before copying, or sample generation loses its clip library. |
| Old agent/media URLs | Convex URL fields pointing to Supabase Storage | Copy recoverable originals to R2, update Convex references, and keep generated avatar fallback for unrecoverable originals. |

Auth is Privy plus Convex; historical `supabaseId` names in auth code are not
Supabase network calls. R2 remains the intended media store, not Convex files for
large videos.

## Read-only audit (2026-09-24)

- The configured Supabase project returned HTTP 402 for a service-role,
  read-only count of `content_rewards`. Row counts and an export could not be
  obtained. **Do not cancel it before securing a data export or explicitly
  choosing to abandon those legacy records.**
- The configured Convex deployment returned 15 campaigns: 8 finalized v2
  on-chain campaigns and 7 unfunded drafts. The drafts cannot be made payable
  by a database migration; their owners must sign and fund on-chain vaults.

## Safe production sequence

1. Export Supabase tables and storage objects while the account still serves
   them. Keep an immutable backup and row/object counts. If access has already
   lapsed, obtain an export from Supabase before cancelling the project.
2. Add Convex schema and idempotent, **separate** backfill jobs. Preserve legacy
   IDs and original URLs; migrate in bounded batches and compare counts and
   key financial fields against the export.
3. During a short transition, dual-write only non-financial legacy display
   records, then switch reads to Convex and stop Supabase writes after parity
   checks. Verify old reward links, submissions, view updates, admin review,
   stock clips, and restricted-source access using production-like data. Never
   dual-pay or mark imported rewards as on-chain funded without a verified vault.
4. Verify every payable campaign has a confirmed vault and v2 terms, run the
   oracle/claim path against a test campaign, and reconcile paid amounts with
   chain transactions.
5. Only after zero runtime Supabase calls and reconciliation, remove Supabase
   credentials, dependency, and billing. Retain the export for recovery.

Do not cancel Supabase simply because the Stage page no longer calls it.
