# Autonomous Agent Economy Loop — Design

**Date:** 2026-06-03
**Status:** Draft for review
**Scope:** Complete the existing autonomy infrastructure so agents operate themselves 24/7 via the heartbeat, create and execute their own tasks from what the builder configured, and pay real on-chain returns to share investors when campaign work is verified.

---

## 1. Goal & success criteria

A minted agent should run with **no human in the loop**:

1. Its **heartbeat** fires on its configured interval (server-side cron), even when nobody is viewing the site.
2. On each beat it **plans its own tasks** from its operating manual + persona + installed skills + open campaigns ("refers to what the builder built it to be").
3. It **executes** those tasks (make video → post to connected socials → submit to campaign).
4. When campaign work is **verified**, USDC pays out from the campaign escrow and is **distributed on-chain to share investors** (and operator/protocol) by ownership %, closing the virtual economy.
5. The operator/investor UI reflects this: the **currently-running task is pinned to the top**, and earnings/APR update.

**Done when:** an agent with `heartbeatEnabled = true` produces tasks and (where socials/campaigns are connected) posted content and a recorded investor distribution, with zero manual triggering, and the agent profile Tasks tab shows the running task first.

This is **one cohesive subsystem** (the autonomous economy loop), suitable for a single implementation plan.

---

## 2. What already exists (do not rebuild)

- `convex/crons.ts` — `heartbeat` internal action runs every minute; for each agent checks `heartbeatEnabled` + per-agent interval (`heartbeatCron`) vs `heartbeatLastFiredAt`; calls `markHeartbeatFired` then `POST /api/agents/autonomy-loop`.
- `app/api/agents/autonomy-loop/route.ts` — `planTasksFromHeartbeat` reads the operating manual (`heartbeatMarkdown`) + persona + memory + open campaigns (when the Campaigns skill is installed) and inserts pending `agentTasks`; then executes pending tasks via `run-task`.
- `app/api/agents/run-task/route.ts` — executes a task (video defers to `videoJobs.generate`, `post_content`, `campaign_submit`, etc.).
- Builder persists `heartbeatEnabled / heartbeatCron / heartbeatMarkdown` at mint (`app/builder/page.tsx`).
- Escrow: `programs/vello-escrow` `approve_submission` releases campaign USDC to the **agent-wallet PDA's ATA**; `convex/campaigns.ts markVerified` computes `payoutAmountUsdc` on oracle approval.
- `convex/investments.ts` `listByMint` — per-wallet shares for an agent.

## 3. Gaps this design fills

| # | Gap | Severity |
|---|-----|----------|
| A | `requireAuth` (Bearer) was added to **both** `autonomy-loop` and `run-task`. Internal callers (cron, autonomy-loop→run-task, videoJobs→run-task) send no token → every internal call 401s → the whole autonomous chain is dead. | 🔴 blocker |
| B | Verify the loop end-to-end once auth is fixed; skip pre-mint/disabled agents; ensure planned tasks execute. | 🟡 |
| C | No path distributes verified campaign earnings to share investors on-chain. `monthlyEarnings` only changes on invest. | 🟡 |
| D | The currently-running task isn't pinned to the top of the Tasks tab. | 🟢 |

---

## 4. Architecture

```
[Convex cron: every 1m]
   └─ heartbeat() ── for each due agent ──▶ POST /api/agents/autonomy-loop   (x-vello-internal)
                                              │
                                              ├─ planTasksFromHeartbeat()  →  insert pending agentTasks
                                              └─ for each pending task ──▶ POST /api/agents/run-task   (x-vello-internal)
                                                                              │
                                                  create_video ──▶ videoJobs.enqueue ──▶ generate (render+stitch)
                                                                              │            └─ autoPost → POST /api/agents/run-task (x-vello-internal) → post_content
                                                  campaign_submit ──▶ submissions.submit / setPostLink
                                                                              │
[Oracle verifies submission] ── markVerified() ── payoutAmountUsdc ──▶ on-chain approve_submission (USDC → agent wallet)
                                                                              │
                                              ▶ POST /api/agents/distribute-earnings   (x-vello-internal)
                                                  ├─ read investments(by_mint) + totalShares
                                                  ├─ split payout: investors 50% / builder 45% / protocol 5%
                                                  ├─ transfer USDC to each investor wallet (treasury signer)
                                                  ├─ record distributions ledger (+ txSig) ; mark "pending" if signing unconfigured
                                                  └─ roll payout into agent monthlyEarnings (economy/APR)
```

---

## 5. Components

### 5.1 `requireAuthOrInternal(req)` — `lib/server/requireAuth.ts`
New exported helper alongside `requireAuth`. Returns the same `AuthResult` shape but **also** succeeds when the request carries `x-vello-internal: <INTERNAL_API_SECRET>` (env), returning a synthetic internal principal (`{ internal: true }`). Used by `autonomy-loop` and `run-task` and `distribute-earnings`.
- `INTERNAL_API_SECRET` is a new server env var. If unset, internal auth is disabled (only Bearer works) and a one-time warning is logged so the cron path is debuggable.
- `requireAuth` (strict user-only) is unchanged for user-facing routes (e.g. `/api/social/*`).

### 5.2 Internal callers send the header
- `convex/crons.ts` heartbeat fetch → add `x-vello-internal` header (`process.env.INTERNAL_API_SECRET`).
- `autonomy-loop` → `run-task` internal fetch → add header.
- `videoJobs.generate` → `run-task` autopost fetch → add header (forwarded from enqueue, like `kieApiKey`).
- `app/api/influencer/generate-content` already enqueues `videoJobs`; no change needed beyond the header threading in videoJobs.

### 5.3 `convex/distributions.ts`
- Table `distributions` (new): `mintAddress, campaignId?, submissionId?, totalPayoutUsdc, builderUsdc, protocolUsdc, investorUsdc, splits: [{ wallet, shares, usdc, txSignature?, status }], status ("paid" | "partial" | "pending"), createdAt`.
- `record` mutation (insert), `listByMint` query (for the UI), `markSplitPaid` mutation (attach txSig per split).
- Schema index `by_mint`.

### 5.4 `/api/agents/distribute-earnings` (POST, internal-auth)
Input: `{ mintAddress, payoutUsdc, campaignId?, submissionId? }`.
1. `requireAuthOrInternal`.
2. Read `investments.listByMint` + agent `totalShares`, `creatorWallet`.
3. Split: `investorUsdc = payout * INVESTOR_PCT`, `builderUsdc = payout * BUILDER_PCT`, `protocolUsdc = payout * PROTOCOL_PCT`. Per investor: `usdc = investorUsdc * (sharesBought / soldShares)` where `soldShares = Σ investor shares` (unsold shares are creator-retained → fold into the builder cut).
4. If a treasury signer is configured (`TREASURY_WALLET_SECRET` + USDC mint), transfer USDC to each investor wallet (and the builder/protocol wallets), capturing txSignatures. Otherwise mark each split `pending`.
5. `distributions.record(...)`; `influencers.addEarnings(mintAddress, payoutUsdc)` (rolls into `monthlyEarnings`/economy).
- **Default split:** `INVESTOR_PCT = 0.50`, `BUILDER_PCT = 0.45`, `PROTOCOL_PCT = 0.05` — defined as named constants so they're trivially tunable. The **builder** (the agent's creator/operator) takes 45%; the **protocol** takes 5%; **investors** share 50% pro-rata by shares. (Builder wallet = `creatorWallet`; protocol wallet = `NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET`. Unsold/creator-retained shares fold their portion into the builder cut.)

### 5.5 Trigger from verification
`markVerified` (oracle approval, decision = "approved") already computes `payoutAmountUsdc`. After it patches the submission, enqueue a call to `/api/agents/distribute-earnings` for `{ mintAddress, payoutUsdc, campaignId, submissionId }`. Because `markVerified` is a Convex mutation, dispatch via `ctx.scheduler.runAfter(0, internal.distributions.dispatch, ...)` where `dispatch` is an internal action that does the HTTP call with the internal header (mutations can't `fetch`).

### 5.6 `influencers.addEarnings` mutation
`{ mintAddress, usdc }` → increment a new optional `lifetimeEarningsUsdc` field, and recompute `monthlyEarnings` as the **trailing-30-day sum of `totalPayoutUsdc` from the `distributions` ledger** for that mint (queried inside the mutation by `by_mint` + `createdAt >= now - 30d`). This is the single source of truth for `monthlyEarnings`; the older invest-time mutation of `monthlyEarnings` is left alone for now since it reflects share-price mechanics, not earnings. `monthlyEarnings` drives the TVL/APR shown to investors.

### 5.7 Tasks UI — pin running first
In the agent profile Tasks tab (`components/influencer/influencer-profile.tsx`), sort the task list with a status rank: `running (0) → pending/awaiting_approval (1) → succeeded/failed/cancelled (2)`, then by `startedAt`/`_creationTime` desc. The existing "Live" section already filters running/pending; ensure the History table below is also rank-sorted so a running task is unambiguously first. Small, isolated change.

---

## 6. Data flow & idempotency

- **Double-fire:** the cron marks `heartbeatLastFiredAt` *before* dispatch (already implemented) → no double heartbeat.
- **Duplicate distribution:** keyed on `submissionId`. `distributions.record` checks for an existing row with the same `submissionId` and no-ops if present (oracle webhook retries are safe). `markVerified` is already idempotent.
- **Partial on-chain failure:** per-split status lets a retry pay only the `pending` splits. Distribution failure never reverts the verification.

## 7. Error handling

- Internal auth: if `INTERNAL_API_SECRET` is unset, internal routes log a single warning and reject internal calls (so the failure is visible, not silent).
- Treasury signing unconfigured (devnet): distribution is recorded `pending` (not an error) — matches the codebase's existing "recorded for manual review" pattern. The UI shows pending splits.
- Render/post failures inside run-task remain best-effort (already the case); they don't break the heartbeat.

## 8. Testing

- **Auth:** unit-test `requireAuthOrInternal` — accepts valid Bearer, accepts valid internal header, rejects neither; rejects internal header when `INTERNAL_API_SECRET` unset.
- **Split math:** unit-test the pro-rata split (sums to payout within rounding; unsold shares fold to the builder cut; zero-investor case → the 50% investor pool also folds to the builder, leaving builder 95% / protocol 5%).
- **Idempotency:** `distributions.record` second call with same `submissionId` is a no-op.
- **End-to-end (devnet, manual):** enable heartbeat on a test agent with the Campaigns + Social skills; confirm within one interval that tasks are created, a video renders + posts (when connected), a submission is created, and on verification a `distributions` row appears with the correct split.

## 9. Out of scope (YAGNI)

- No new Anchor instruction / program redeploy. Investor distribution is server-treasury-signed transfers, not an on-chain pro-rata escrow instruction. (Can be a later upgrade.)
- No change to the oracle/verification service itself — we only hook its existing "approved" outcome.
- Trader profit distribution (the user chose campaign-escrow → investors); traders keep their existing wallet flow.
- No UI for editing the split percentages (constants only) in this iteration.

## 10. Env / config summary

| Var | Purpose | Behaviour if unset |
|-----|---------|--------------------|
| `INTERNAL_API_SECRET` | server-to-server auth for cron/internal calls | internal calls rejected (warned); heartbeat won't run |
| `TREASURY_WALLET_SECRET` | signer for investor payouts | distributions recorded `pending` |
| `NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET` | protocol fee recipient | protocol cut folded/pending |

Split defaults: investors 50% / builder 45% / protocol 5% (named constants).
