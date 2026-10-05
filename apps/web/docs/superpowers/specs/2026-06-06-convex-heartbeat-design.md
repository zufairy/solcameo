# Always-on Convex-native Heartbeat — Design

**Date:** 2026-06-06
**Status:** Approved (ready for implementation plan)

## Problem

Three issues with the agent heartbeat system:

1. **`/agents` badge is misleading.** The `NextHeartbeat` countdown renders on
   every agent card and falls back to a default 15-minute interval, so agents
   that never enabled their heartbeat still display a live countdown. It reads
   as fake/static data.
2. **Two disagreeing schedule clocks.** The `/agents` page and the Convex cron
   use a wall-clock slot (`nextHeartbeatFireAt`), but the builder's
   `HeartbeatCard` uses a mount/last-fired-relative clock
   (`getNextHeartbeatAt(cron, lastFiredAt)`). Their countdowns disagree, and a
   builder-initiated fire never advances the server slot, so it can double-fire
   with the cron.
3. **Firing depends on the Next app being reachable.** The cron fires by
   `fetch(NEXT_PUBLIC_APP_URL/api/agents/autonomy-loop)`. Convex runs in the
   cloud and cannot reach `localhost:3000`, so on local dev nothing fires unless
   a page is open. The heartbeat should run "the whole time, even if no page is
   open."

## Hard constraint

**ffmpeg cannot run inside Convex.** Multi-clip stitching (`/api/video/concat`),
overlay-burn (`/api/video/overlay-burn`), and social posting (upload-post)
require the Node/Next server. Therefore full video *execution* always needs the
Next app reachable — automatic in production, and served by the dev server on
localhost. What we make Convex-native is **heartbeat firing + task planning +
task creation**, which is the part that must run 24/7.

## Goals

- Heartbeat **firing, planning, and task creation run 100% in Convex**, 24/7,
  with no dependency on the Next app being reachable. Tasks fill the queue even
  if Next is down.
- A **single wall-clock schedule** shared by cron, `/agents`, and the builder.
- **No double-fire** when both the cron and a client page are firing (atomic
  compare-and-advance).
- `/agents` shows the heartbeat badge **only** for agents that enabled it, with
  real `heartbeatNextFireAt` data.

## Non-goals

- Porting `/api/agents/run-task`'s create_video setup into Convex (the executor
  stays in Next).
- LLM/Kie-based planning inside Convex. Planning is **rule-based only**, reusing
  the existing `agentAutonomy.generateTasksForAgent` mutation. No `KIE_API_KEY`
  is required in the Convex deployment.

## Architecture

```
Convex cron (every 1m, internal.crons.heartbeat)
  └─ for each enabled agent whose slot is due:
       claimHeartbeat(mint, now)                ← atomic compare-and-advance
        └─ if claimed === true:
             ctx.runAction(internal.agentAutonomy.fireHeartbeatForAgent, {mint})
               ├─ 1. PLAN + INSERT  → generateTasksForAgent(mint)   (rule-based, Convex)
               └─ 2. EXECUTE        → scheduler.runAfter(0, dispatchPendingTasks)
                                        → POST appUrl/api/agents/run-task per task
                                          (prod: reachable; localhost: dev server)
```

Planning + task creation are Convex-native and always run. Only render execution
POSTs to Next.

## Components

### Part A — `/agents` badge (display correctness)

File: `app/agents/page.tsx`, `HireCard` (badge call site ~L769–772).

Gate the badge: render `NextHeartbeat` **only** when
`agent.heartbeatEnabled === true && resolveIntervalMs(agent.heartbeatCron) > 0`.
Otherwise render nothing (hide entirely — decided).

No data changes needed: `influencers.listAll` already returns
`heartbeatEnabled`, `heartbeatCron`, and `heartbeatNextFireAt`, and
`NextHeartbeat` already reads the real `heartbeatNextFireAt`.

### Part B — one schedule clock

File: `components/builder/HeartbeatCard.tsx`.

Replace `getNextHeartbeatAt(cron, lastFiredAt)` usage in `useHeartbeatScheduler`
and `useCountdown` with the shared wall-clock function
`nextHeartbeatFireAt(now, intervalMs, mintAddress)` from
`lib/builder/heartbeatSchedule.ts`, reading the persisted `heartbeatNextFireAt`
when present (same source the `/agents` page uses). Builder and marketplace then
show the identical countdown and survive reloads without a mount anchor.

The builder's auto-fire must claim the slot via `claimHeartbeat` (Part C) before
running, so a builder fire advances the server slot and the cron won't repeat it.

### Part C — Convex firing engine

Files: `convex/influencers.ts`, `convex/agentAutonomy.ts`, `convex/crons.ts`.

**`claimHeartbeat` mutation** (new, in `influencers.ts`). Atomic
compare-and-advance — the Convex mutation runs in a transaction:
- args: `{ mintAddress, now }`
- reads the agent; computes `intervalMs = resolveIntervalMs(heartbeatCron)`.
- if disabled / manual (`intervalMs === 0`) → `{ claimed: false }`.
- if `heartbeatNextFireAt === undefined` → seed
  `nextHeartbeatFireAt(now, intervalMs, mint)` and return
  `{ claimed: false }` (don't fire on first sight — matches current "init, don't
  stampede" behaviour).
- if `now >= heartbeatNextFireAt` → patch
  `heartbeatLastFiredAt = now`,
  `heartbeatNextFireAt = nextHeartbeatFireAt(now, intervalMs, mint)`, and return
  `{ claimed: true }`.
- else → `{ claimed: false }`.

Because the read+patch happen in one transaction, exactly one concurrent caller
(cron OR client) wins the claim. Replaces the current read-then-
`markHeartbeatFired` two-step. `markHeartbeatFired` may be kept for the manual
"fire now" path or removed once unused.

**`fireHeartbeatForAgent` internalAction** (new, in `agentAutonomy.ts`):
- args: `{ mintAddress }`
- calls `generateTasksForAgent({ mintAddress })` (existing rule-based mutation) →
  returns `{ count }`.
- if `count > 0`, schedules execution: `ctx.scheduler.runAfter(0,
  internal.agentAutonomy.dispatchPendingTasks, { mintAddress })`.
- returns `{ generated: count }`.

**`dispatchPendingTasks` internalAction** (new, in `agentAutonomy.ts`):
- reads pending tasks for the mint (`listPendingForMint` exists).
- for each, `fetch(${appUrl}/api/agents/run-task)` with the internal secret
  header (best-effort; failures are logged, not fatal — the task stays pending
  and retries next tick). `appUrl = NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"`.

**`crons.ts:heartbeat` rewrite**:
- still iterates `getHeartbeatAgents`.
- for each enabled agent, call `ctx.runMutation(api.influencers.claimHeartbeat,
  { mintAddress, now })`.
- if `claimed`, `ctx.runAction(internal.agentAutonomy.fireHeartbeatForAgent,
  { mintAddress })`.
- the manual `needsInit`/`due` partition and the old `fetch(.../autonomy-loop)`
  are removed; `claimHeartbeat` absorbs the init + due + advance logic.

### Part D — client fallback firing (localhost convenience)

File: `app/builder/page.tsx`, `fireHeartbeatNow` (~L1812).

The builder's auto-fire (and the existing manual "fire now") first call
`claimHeartbeat`. On `{ claimed: true }`, proceed with the existing
`fetch(/api/agents/autonomy-loop)` call (served by the local dev server, so it
works on localhost without a tunnel). On `{ claimed: false }`, skip — the cron or
another tab already fired this slot. The CAS guarantees no double-fire.

## Environment (Convex deployment)

- `NEXT_PUBLIC_APP_URL` — execution target for `dispatchPendingTasks`. Falls back
  to `http://localhost:3000`.
- `INTERNAL_CRON_SECRET` — forwarded to `/api/agents/run-task` so unattended
  execution passes the auth gate. Must match the Next env value.
- `KIE_API_KEY` — **not** required in Convex (planning is rule-based).

## Testing

- **Unit:** `claimHeartbeat` — two concurrent claims on the same due slot yield
  exactly one `claimed: true`; disabled/manual agents never claim; an
  unseeded agent seeds its slot and returns `claimed: false`.
- **Existing:** `lib/builder/heartbeatSchedule.test.ts` already covers
  `nextHeartbeatFireAt` parity (client/server agreement).
- **Integration (manual):** a cron tick with one due agent creates ≥1 pending
  task and dispatches it; the `/agents` badge is hidden for
  `heartbeatEnabled: false` and shows a live countdown for enabled agents that
  matches the builder.

## Risks

- **Execution still needs Next.** On localhost with the dev server down and no
  page open, tasks are created but not executed until the server is back. This
  is acceptable and expected — the queue is durable and retries each tick.
- **Rule-based planning is less expressive** than the LLM planner it replaces in
  the cron path. The richer `/api/agents/autonomy-loop` planner remains available
  for the user-initiated "fire now" path if desired.
