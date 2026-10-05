# Autonomous Clipping — Design Spec

**Date:** 2026-07-03
**Status:** Approved (brainstorm) → planning
**Branch:** `dev`

## Goal

Let a clip agent, when the operator flips a **toggle on its Home page**, run the full clipping loop **on its own**: seek a fit-matched, funded campaign it hasn't clipped yet → resolve its source video → run the clip pipeline → auto-post → auto-submit. One new source video per cycle. Off by default.

This is a *delta*, not a new system: ~80% of the machinery exists (campaign scouting via `clip.campaignscout`, the clip pipeline which already auto-posts + auto-submits once a job is enqueued, Drive-folder source expansion, the daily heartbeat, per-run metering, refund-on-failure). The new part is the **"clipper brain"**: connect scout → auto-enqueue a clip → gated by the toggle.

## Decisions (from brainstorm Q&A)

1. **Control:** a per-agent **toggle on Home** ("Autonomous clipping"). Default **OFF** (money-spending loop → explicit opt-in). When ON, the agent auto-clips.
2. **Volume:** **one new `(campaign, source-video)` per cycle.** Dedup is at the **source-video** level — a campaign whose Drive folder holds multiple videos is worked through **one video per cycle** before the campaign is considered done. The daily spend cap remains the hard ceiling.
3. **Eligibility:** pick from campaigns that are (a) **fit-matched** to the agent (the Scout's niche/persona match), (b) **funded** (real payout — `pdaAddress`/on-chain-funded for Convex, budget>0 for content_rewards), (c) have a **resolvable source** the agent hasn't clipped, and (d) **restriction-safe** (never auto-clip one of the 12 restricted campaigns unless this agent's account is the allowed one).
4. **Cost:** each autonomous run charges the **$0.10 scout/autonomous fee** (the existing `clip.campaignscout` service price) **plus the clip's normal per-editing-skill fees** (unchanged metering). Refund-on-failure (already shipped) covers a run that yields 0 clips.
5. **Mechanism:** **reuse the existing daily scout / heartbeat.** The auto-clip step hangs off the daily "Scout brand campaigns" flow for clip agents — no separate cron.

## Data model

- **New agent field** `autoClipEnabled: boolean` (optional; default false) on the agent record (`influencers` / the doc surfaced to Home). Set via a secret-gated (or SIWS-owner-gated) mutation.
- **Dedup source of truth:** derive "already clipped" from **existing `clipJobs` rows** keyed by `(mintAddress, campaignId | contentRewardId, sourceUrl)`. A `(campaign, source-video)` is "done" if a `clipJobs` row exists for it for this agent (any terminal status except a refunded/failed-0-clip run, which may be retried). Only add a dedicated `autoClipProgress` table if deriving from `clipJobs` proves insufficient (documented fallback, not v1 default).

## Components

1. **Home toggle UI** (`components/builder/AgentWorkspace.tsx`, near the Earnings / autonomous-tasks area): an ON/OFF switch "Autonomous clipping — auto-seek & clip campaigns · ~$0.10/run + clip fees", plus a one-line "recent auto-clips / next run" hint. Calls the toggle mutation. Shown only for clip agents.
2. **Toggle mutation** (Convex, on the agent doc): set `autoClipEnabled`, owner-gated.
3. **Source selector** — a **pure, testable** function: given (fit-matched funded candidate campaigns, each with its resolved source videos) + (the agent's already-clipped `(campaign, sourceUrl)` set), return the **next un-clipped source** `{ campaignId?/contentRewardId?, sourceUrl, title }` or `null`. Encapsulates the per-source-video dedup + "one per cycle" pick (best/oldest un-clipped).
4. **Auto-clip step** — invoked from the daily scout flow for a clip agent when `autoClipEnabled`: run the Scout to get fit-matched funded candidates, expand each candidate's source (reuse `resolveCampaignSources` / the Drive-folder expander), run the selector, funding/cap/restriction gate, charge the $0.10 scout fee (`recordUsage` service `clip.campaignscout`), then **`clipJobs.enqueue`** with the source + `campaignId`/`contentRewardId` so the existing pipeline runs → posts → submits.

## Data flow (one cycle, toggle ON)

```
daily heartbeat / scout run (clip agent, autoClipEnabled)
  → scout fit-matched OPEN + FUNDED campaigns (existing matching)
  → for each candidate: resolve source videos (Drive-folder expand)
  → selector: next un-clipped (campaign, source-video) vs existing clipJobs   → null? idle, no charge, done
  → restriction gate (isRestrictedCampaign + allowed?)                        → not allowed? skip candidate
  → funding gate: spendable ≥ $0.10 + est clip cost AND daily cap not hit     → can't afford? skip, done
  → charge $0.10 scout fee (recordUsage clip.campaignscout)
  → clipJobs.enqueue({ mintAddress, sourceUrl, campaignId/contentRewardId, config, autoPost })
        → existing pipeline: download → transcribe → cut → render → auto-post → auto-submit
  → stop (one per cycle)
```

## Guardrails / error handling

- **Off by default**; nothing auto-clips until the operator toggles ON.
- **Funding:** skip the whole run when spendable < ($0.10 + estimated clip cost) or the daily spend cap is reached (reuse the existing clip precheck; no scout fee charged if it can't proceed).
- **Restriction:** never auto-enqueue a restricted campaign for a non-allowed agent (reuse `isRestrictedCampaign` / the restriction gates).
- **Unresolvable source** (private Drive / no Drive key / empty folder): skip that source, try the next candidate; if none resolvable → idle (no charge).
- **No new fit-matched funded campaigns:** idle, no charge.
- **Failed run (0 clips):** the existing refund-on-failure (#33) voids the run's fees.
- **One per cycle:** hard bound; the daily cap is the secondary ceiling.
- **Dedup:** never re-clip a `(campaign, source-video)` already clipped by this agent.

## Testing

- **Selector (pure):** unit tests — picks the next un-clipped fit-matched funded source; per-source-video dedup (multi-video folder → one per cycle, moves on only when all done); returns null when nothing new; never returns a restricted-and-not-allowed source; never returns an already-clipped source.
- **Funding/cap skip:** below spendable / cap-hit → no enqueue, no scout charge.
- **Toggle mutation:** owner-gated; flips the field.
- Pipeline / post / submit / refund already have coverage — not re-tested here.

## Out of scope (YAGNI for v1)

- Configurable "campaigns per cycle" number (fixed at **one** per cycle; can add later).
- A separate/faster cron (reuse the daily scout cadence).
- A new `autoClipProgress` table (derive dedup from `clipJobs` first).
- Auto-connecting social accounts / auto-funding.
- Changing the clip pipeline, posting, submit, or metering beyond adding the $0.10 scout fee on the auto path.

## Deploy

- New schema field + toggle mutation + any new query → **`npx convex deploy`**.
- Toggle UI → **Railway** rebuild.

## Key integration points (verify during implementation)

- `lib/builder/skillSplit.ts` — Scout campaigns → `find_jobs`; `clip.campaignscout` mapping.
- `app/api/agents/autonomy-loop/route.ts` + `convex/agentAutonomy.ts` + `convex/crons.ts` (`fireHeartbeatForAgent`, `dispatchAllPending`) — the daily heartbeat/scout path.
- `convex/clipJobs.ts` `enqueue` (called today from `app/api/agents/run-task/route.ts` clip_source / join_clip_campaign ~1234/1280) + the funding precheck (~1135-1177).
- `lib/server/campaignSources.ts` `resolveCampaignSources` / `/api/clip/resolve-source-url` — source expansion.
- `lib/economy/servicePrices.ts` `clip.campaignscout` = 0.10; `convex/usage.ts` `recordUsage`.
- `lib/restrictedCampaigns.ts` / `lib/server/restrictedCampaignGates.ts` — restriction gate.
- `components/builder/AgentWorkspace.tsx` — Home page (toggle UI), the "Scout brand campaigns" card (~4647).
