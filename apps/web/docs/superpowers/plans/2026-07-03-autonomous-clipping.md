# Autonomous Clipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-agent Home toggle that, when ON, makes a clip agent auto-seek a fit-matched funded campaign each daily scout, resolve its next un-clipped source video, and run the existing clip pipeline (which already renders → auto-posts → auto-submits).

**Architecture:** Reuse the existing daily scout (`find_jobs`) + clip pipeline (`clipJobs.enqueue`). Add: (1) an `autoClipEnabled` flag on the agent, (2) a pure "pick next un-clipped source" selector, (3) an internal action that runs after the scout for toggle-ON clip agents and enqueues one clip, (4) a Home toggle. Dedup derives from existing `clipJobs` rows keyed by `(mintAddress, campaign, sourceUrl)`. Charge a $0.10 scout fee (`clip.campaignscout`) per auto run; the clip's own skill fees meter as usual; refund-on-failure already handles 0-clip runs.

**Tech Stack:** Convex (mutations/queries/actions, schema), Next.js/React (AgentWorkspace Home UI), TypeScript, Vitest (`convexTest` for Convex, plain unit tests for pure functions).

## Global Constraints

- TypeScript, no `any` (cast via `unknown`). No `Co-Authored-By` trailer. End commit messages with the session trailer.
- Off by default — nothing auto-clips until the operator toggles ON.
- One new `(campaign, source-video)` per cycle; the daily spend cap is the hard ceiling.
- Eligibility: fit-matched (scout) + funded + resolvable source + not-already-clipped + restriction-safe.
- Reuse, don't duplicate: `clipJobs.enqueue`, `resolveCampaignSources`/Drive expansion, `recordUsage`, `isRestrictedCampaign`/restriction gates, the existing funding precheck, the `videoConfig`/mutation pattern.
- Work on branch `dev`; each task is its own commit, verified (tsc 58 baseline, vitest 17-baseline) before push.
- Convex mutations that write must be gated (owner SIWS via the route layer, or `authSecret === INTERNAL_CRON_SECRET`).

---

### Task 1: `autoClipEnabled` flag + toggle mutation

**Files:**
- Modify: `apps/web/convex/schema.ts` (the `influencers` table, near `installedSkills` ~line 119 / `videoConfig` ~line 171): add `autoClipEnabled: v.optional(v.boolean())`.
- Modify: `apps/web/convex/influencers.ts` — add a `setAutoClip` mutation.
- Test: `apps/web/convex/influencers.autoClip.test.ts` (new).

**Interfaces:**
- Produces: `api.influencers.setAutoClip({ mintAddress: string, enabled: boolean, authSecret: string }) → { ok: true, autoClipEnabled: boolean }`. Reads: agent doc now carries `autoClipEnabled?: boolean`.

- [ ] **Step 1: Write the failing test** (`influencers.autoClip.test.ts`, node env), mirroring the existing `convex/influencers` test style (`convexTest(schema, modules)`): create an influencer, call `api.influencers.setAutoClip` with a valid `authSecret` and `enabled:true`, assert the doc's `autoClipEnabled === true`; call again `enabled:false` → `false`; call with a wrong secret → rejects `/unauthorized/i`.
- [ ] **Step 2: Run it → FAIL** (`setAutoClip` not defined). `cd apps/web && npx vitest run convex/influencers.autoClip.test.ts`.
- [ ] **Step 3: Add the schema field** — in `schema.ts` `influencers` table add `autoClipEnabled: v.optional(v.boolean()),`.
- [ ] **Step 4: Implement `setAutoClip`** in `influencers.ts` — a `mutation` with args `{ mintAddress: v.string(), enabled: v.boolean(), authSecret: v.string() }`; assert `authSecret === process.env.INTERNAL_CRON_SECRET` (match the existing secret-gate idiom in this file), look up the influencer by `by_mint`, `ctx.db.patch(doc._id, { autoClipEnabled: args.enabled, updatedAt: Date.now() })`, return `{ ok: true, autoClipEnabled: args.enabled }`. (The Home UI calls this via a route that adds the secret, OR via an owner-SIWS route — see Task 4.)
- [ ] **Step 5: Run tests → PASS.**
- [ ] **Step 6: Commit** — `feat(agent): autoClipEnabled flag + setAutoClip mutation`.

---

### Task 2: Pure "pick next un-clipped source" selector

**Files:**
- Create: `apps/web/lib/server/autoClipSelect.ts`
- Test: `apps/web/lib/server/autoClipSelect.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AutoClipCandidateSource = { campaignId?: string; contentRewardId?: string; sourceUrl: string; title: string };
  export type AutoClipCandidate = { campaignId?: string; contentRewardId?: string; title: string; sources: { sourceUrl: string; name: string }[] };
  /** Returns the next un-clipped source across candidates (in candidate order, then source order),
   *  or null when every candidate source has already been clipped. `clippedKeys` is a Set of
   *  `campaignKey|sourceUrl` where campaignKey = campaignId ?? contentRewardId ?? "". */
  export function pickNextAutoClipSource(candidates: AutoClipCandidate[], clippedKeys: Set<string>): AutoClipCandidateSource | null;
  export function autoClipKey(campaignId: string | undefined, contentRewardId: string | undefined, sourceUrl: string): string;
  ```
- Consumes: nothing (pure). Caller pre-filters candidates to fit-matched + funded + restriction-safe.

- [ ] **Step 1: Write the failing test** covering: (a) first candidate's first source returned when nothing clipped; (b) a candidate with 3 sources where source #1 is clipped → returns source #2 (per-source-video dedup, same campaign); (c) all sources of candidate A clipped → moves to candidate B's first source; (d) everything clipped → `null`; (e) `autoClipKey` uses contentRewardId when campaignId absent; (f) empty candidates → `null`.
  ```ts
  import { pickNextAutoClipSource, autoClipKey } from "./autoClipSelect";
  const A = { campaignId: "cA", title: "A", sources: [{ sourceUrl: "u1", name: "1" }, { sourceUrl: "u2", name: "2" }] };
  test("skips a clipped source, picks the next in the same campaign", () => {
    const clipped = new Set([autoClipKey("cA", undefined, "u1")]);
    expect(pickNextAutoClipSource([A], clipped)?.sourceUrl).toBe("u2");
  });
  ```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `autoClipKey` = `${campaignId ?? contentRewardId ?? ""}|${sourceUrl}` and `pickNextAutoClipSource`: iterate candidates in order, then their `sources` in order, return the first `{campaignId, contentRewardId, sourceUrl, title}` whose `autoClipKey` is NOT in `clippedKeys`; `null` if none. No mutation, no `any`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(clip): pure next-un-clipped-source selector for autonomous clipping`.

---

### Task 3: `alreadyClippedKeys` query (dedup from existing clipJobs)

**Files:**
- Modify: `apps/web/convex/clipJobs.ts` — add an internal query `autoClippedKeysForMint`.
- Test: `apps/web/convex/clipJobs.autoClippedKeys.test.ts` (new).

**Interfaces:**
- Produces: `api.clipJobs.autoClippedKeysForMint({ mintAddress: string, authSecret: string }) → string[]` — the `autoClipKey(campaignId, contentRewardId, sourceUrl)` for every clipJob this agent has already run (any status EXCEPT a run that was refunded/failed-with-0-clips, which is eligible to retry). Use the `by_mint` index; bounded `.take()` (reuse the row-cap pattern in this file). Key format must match `autoClipSelect.autoClipKey`.

- [ ] **Step 1: Write the failing test** — insert 2 clipJobs for a mint (`campaignId:"cA", sourceUrl:"u1"` and `contentRewardId:"rB", sourceUrl:"u2"`), call the query, assert it returns `["cA|u1", "rB|u2"]` (order-insensitive). A failed-0-clip/refunded job for `u3` is NOT returned.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the query: read `clipJobs` by `by_mint` (bounded take), for each row with a `sourceUrl` build `${row.campaignId ?? row.contentRewardId ?? ""}|${row.sourceUrl}`, skip rows whose terminal state is the refunded/failed-0-clip marker (check how Task-#33's refund stamps a failed run — reuse that predicate; if none clean, include all non-error rows), return the deduped array. NO import of `autoClipSelect` into Convex if it pulls server-only deps — inline the identical key string.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(clip): autoClippedKeysForMint query (dedup source of truth for auto-clip)`.

---

### Task 4: Auto-clip step — internal action wired into the daily scout

**Files:**
- Create: `apps/web/convex/autoClip.ts` — internal action `runAutoClipForMint`.
- Modify: the daily-scout invocation path so a toggle-ON clip agent runs `runAutoClipForMint` after its scout. Verify the exact hook by reading: `convex/crons.ts` (`fireHeartbeatForAgent`, `dispatchAllPending`), `app/api/agents/run-task/route.ts` (`find_jobs` executor ~475/~1845), `convex/agentAutonomy.ts`. Prefer: after the daily scout for a clip agent with `autoClipEnabled`, schedule/call `internal.autoClip.runAutoClipForMint({ mintAddress })`.
- Test: `apps/web/convex/autoClip.test.ts` (new) — exercise the gating/selection with mocked candidates.

**Interfaces:**
- Consumes: `pickNextAutoClipSource`/`autoClipKey` (Task 2), `api.clipJobs.autoClippedKeysForMint` (Task 3), `api.clipJobs.enqueue` (existing: `{ mintAddress, sourceUrl, sourceType, campaignId?, contentRewardId?, authSecret }`), `api.usage.recordUsage` (existing; service `"clip.campaignscout"`, price 0.10 in `lib/economy/servicePrices.ts`), `isRestrictedCampaign` + the allowed-account check (`lib/restrictedCampaigns` / `lib/server/restrictedCampaignsAuth`), the existing funding precheck (`agentAccount.getWithNav` + `usage.todaysSpendQuery`, as used in `clipJobs.ts` ~1135-1177), and source expansion (`lib/server/campaignSources.resolveCampaignSources` for content_rewards / `contentLinks`+`contentFileUrls` expanded via the Drive helper for Convex campaigns).
- Produces: `internal.autoClip.runAutoClipForMint({ mintAddress: string }) → { clipped: boolean, sourceUrl?: string, reason?: string }`.

- [ ] **Step 1: Write the failing test** for the selection+gate logic. Since the action does IO, extract a pure helper `chooseAutoClip({ candidates, clippedKeys, spendableUsdc, dailyRemainingUsdc, estCostUsdc })` into `lib/server/autoClipSelect.ts` returning `{ source } | { skip: "no_new" | "insufficient_funds" | "cap" }`, and TEST THAT: no candidates → `no_new`; spendable < est → `insufficient_funds`; dailyRemaining < est → `cap`; otherwise → the selected source. (Restriction filtering happens before this — candidates are already restriction-safe.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `chooseAutoClip`** (pure, tested) + the action `runAutoClipForMint`:
  1. Load the agent; if `!autoClipEnabled` or not a clip agent → return `{ clipped:false, reason:"off" }`.
  2. Gather **fit-matched funded** candidate campaigns — reuse the scout/matching that `find_jobs` uses (read `run-task` `find_jobs` ~1845 + the campaign-scanner matching; extract or call the shared matcher). Filter to funded (Convex: `pdaAddress` set / on-chain funded; content_reward: budget>0) and **restriction-safe** (drop any `isRestrictedCampaign` this agent isn't allowed to clip).
  3. Expand each candidate's sources (content_reward → `resolveCampaignSources`; Convex campaign → `contentLinks ∪ contentFileUrls`, Drive folders expanded via the resolve-source-url/Drive helper).
  4. `clippedKeys = new Set(await runQuery(autoClippedKeysForMint))`.
  5. `estCostUsdc` = 0.10 (scout) + the agent's wired clip-skill run cost (`clipSkillRunCost` from `lib/economy/servicePrices`, as `clipJobs` computes). Read spendable + daily remaining as `clipJobs` does.
  6. `const choice = chooseAutoClip({...})`. If `choice.skip` → return `{ clipped:false, reason: choice.skip }` (NO charge).
  7. Charge the scout fee: `await runMutation(api.usage.recordUsage, { mintAddress, service:"clip.campaignscout", qty:1, idemKey:`autoclip:${mintAddress}:${autoClipKey(...)}`, authSecret })`; if it denies (funds) → return `{clipped:false, reason:"insufficient_funds"}`.
  8. `await runMutation(api.clipJobs.enqueue, { mintAddress, sourceUrl: choice.source.sourceUrl, sourceType: "auto", campaignId: choice.source.campaignId, contentRewardId: choice.source.contentRewardId, authSecret })`. The existing pipeline handles clip → post → submit.
  9. Return `{ clipped:true, sourceUrl }`.
  Idempotency: the `recordUsage` idemKey + `autoClippedKeysForMint` dedup make a same-cycle re-run a no-op.
- [ ] **Step 4: Wire it into the daily scout.** After a clip agent's daily scout/`find_jobs`, if `autoClipEnabled`, `ctx.scheduler.runAfter(0, internal.autoClip.runAutoClipForMint, { mintAddress })` (or the direct call). Confirm the exact site by reading crons.ts/agentAutonomy.ts. Add a `logp`/task log so it appears in "Recent activity".
- [ ] **Step 5: Run tests (chooseAutoClip) → PASS.** Run `tsc` (expect 58 baseline, none new in your files).
- [ ] **Step 6: Commit** — `feat(clip): autonomous auto-clip step — scout→pick source→gate→enqueue (one per cycle)`.

---

### Task 5: Home toggle UI

**Files:**
- Modify: `apps/web/components/builder/AgentWorkspace.tsx` — add the toggle near the Earnings / autonomous-tasks area (shown only for clip agents).
- Modify (if needed): a small owner-gated route or reuse the existing config-save route so the client can call `setAutoClip` (the client can't hold `INTERNAL_CRON_SECRET`). Follow how the existing `videoConfig`/autonomy toggles are saved from AgentWorkspace (they go through an owner-authed route or a Convex mutation the client is allowed to call). If `setAutoClip` must be client-callable, add an owner-SIWS route `app/api/agents/auto-clip/route.ts` that verifies ownership then calls `setAutoClip` with the server secret (mirror an existing agent-config route).

**Interfaces:**
- Consumes: `autoClipEnabled` off the agent doc (already loaded in AgentWorkspace); a save path to `setAutoClip`.

- [ ] **Step 1:** Read how AgentWorkspace currently saves a per-agent toggle/config (search for `videoConfig` save, the autonomy/auto-post toggles) and reuse that owner-authed path.
- [ ] **Step 2:** Add a toggle row: label "Autonomous clipping", sub "Auto-seek & clip campaigns · ~$0.10/run + clip fees", bound to `autoClipEnabled`, `onChange` → save via the reused path (optimistic + revert on error). Render only when the agent is a clip agent. Add a one-line hint showing the most recent auto-clip from Recent activity if trivially available.
- [ ] **Step 3:** `tsc` clean (58 baseline, none new in the file). Hand-trace the toggle (no clean unit test for the component).
- [ ] **Step 4: Commit** — `feat(builder): Home toggle for autonomous clipping`.

---

### Task 6: Verify + deploy notes

- [ ] Run full `npx vitest run` (expect 17-baseline failures, all new tests green) and `npx tsc --noEmit` (58 baseline).
- [ ] Merge each task's commit to `dev`, push individually.
- [ ] **Deploy:** `npx convex deploy` (new schema field + `setAutoClip` + `autoClippedKeysForMint` + `runAutoClip*` + the wiring) THEN Railway rebuild (the Home toggle). Document in the PR/notes.

---

## Self-review notes
- **Spec coverage:** toggle (T1,T5), one-per-cycle + per-source-video dedup (T2,T3), fit+funded+restriction+funding eligibility (T4), $0.10 scout fee + clip fees (T4 recordUsage), reuse daily scout (T4 wiring), tests (T1-T4). Covered.
- **Ambiguity flagged for the implementer:** the exact fit-match reuse point and the exact daily-scout hook site must be confirmed by reading `find_jobs`/`crons.ts`/`agentAutonomy.ts` (Task 4 Steps 2/4) — behavior + interfaces are fixed; the wiring site is the one thing to verify live.
- **Type consistency:** `autoClipKey` string format identical in T2, T3, T4. `enqueue` args match the verified signature. `chooseAutoClip`/`pickNextAutoClipSource` in one module.
