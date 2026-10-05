# Fully-automated backend heartbeat (Convex-cron driven, self-healing)

## Problem
When a heartbeat fires, "nothing happens" on the live backend. The Convex cron
runs 24/7 (no browser needed) and creates pending tasks, but execution is a
Convex→Next HTTP call (`run-task`) that only happens at the *moment an agent's
slot is claimed*. If that single call fails (missing Convex env / transient
network), the task is stranded as `pending` until the agent's NEXT claim — up to
an hour+ later for hourly agents. The browser `HeartbeatDispatcher` was a
workaround but requires someone on the site, which defeats full automation.

## Goal
Agents do their work fully automatically, server-side, with nobody on the site.

## Design
Timer: existing Convex cron `heartbeat`, every 1 minute (serverless, 24/7).

Each tick runs two decoupled phases:

1. **Schedule** (existing): for each `heartbeatEnabled` agent with
   `now >= heartbeatNextFireAt`, atomically `claimHeartbeat` (advance the slot,
   no double-fire) → `fireHeartbeatForAgent` → `generateTasksForAgent` writes
   *pending* tasks, and immediately dispatches that agent's new tasks.

2. **Dispatch — global + self-healing** (NEW): after the claim loop, the cron
   runs `dispatchAllPending`: query `listPendingAll` (oldest N across ALL agents,
   capped per tick) and POST each to `${NEXT_PUBLIC_APP_URL}/api/agents/run-task`
   with `X-Internal-Secret` + the `taskId`. This retries ANY stranded pending
   task every minute, so a transient dispatch failure self-corrects within 60s.

## Why it's safe / robust
- **No double-run:** `run-task` calls `agentTasks.claimPending` which atomically
  flips pending→running; the loser of the race no-ops. So the immediate per-agent
  dispatch and the global dispatch can overlap harmlessly.
- **Self-healing:** failed dispatch → task stays pending → retried next tick.
- **Stuck "running":** `failStaleTasks` reaper auto-fails wedged tasks so they
  don't block forever.
- **Execution stays in Next** (where `run-task` + the KIE/ffmpeg pipeline live);
  Convex only schedules + pokes.
- The browser `HeartbeatDispatcher` becomes a harmless redundant fallback.

## Config (required on the live backend)
- Convex env `NEXT_PUBLIC_APP_URL = https://www.mach.city`
- Convex env `INTERNAL_CRON_SECRET = <same value as the Next host env>`
  (run-task accepts the cron call only if this matches).

## Files
- `convex/crons.ts`: add `dispatchAllPending` internalAction; call it at the end
  of the `heartbeat` handler. Cap `MAX_DISPATCH_PER_TICK` (25) to bound load.
- Reuses `agentTasks.listPendingAll` (already hardened to never throw) and
  `agentTasks.claimPending` (atomic). No schema changes.

## Out of scope
- Porting `run-task` into Convex (KIE/ffmpeg are Next-only).
- External cron / per-host scheduler (chose Convex cron).
