# Always-on Convex-native Heartbeat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent heartbeat fire, plan, and create tasks entirely inside Convex (24/7, no Next dependency), share one wall-clock schedule across cron/builder/`/agents`, prevent double-fire with an atomic claim, and hide the `/agents` countdown badge for agents that haven't enabled their heartbeat.

**Architecture:** A pure `evaluateHeartbeatClaim` helper holds the compare-and-advance logic (unit-tested). A new `claimHeartbeat` Convex mutation applies it atomically. The cron calls `claimHeartbeat` then a new `fireHeartbeatForAgent` action that runs the existing rule-based `generateTasksForAgent` and dispatches pending tasks to `/api/agents/run-task`. The builder reuses the same wall-clock math and claims before firing. The `/agents` badge is gated on `heartbeatEnabled`.

**Tech Stack:** Convex (mutations, internalActions, scheduler, cron), Next.js 14 / React, Vitest, TypeScript.

---

## File Structure

- `lib/builder/heartbeatSchedule.ts` — add pure `evaluateHeartbeatClaim` (CAS decision).
- `lib/builder/heartbeatSchedule.test.ts` — add tests for `evaluateHeartbeatClaim`.
- `convex/influencers.ts` — add `claimHeartbeat` mutation.
- `convex/agentAutonomy.ts` — add `fireHeartbeatForAgent` + `dispatchPendingTasks` internalActions.
- `convex/crons.ts` — rewrite `heartbeat` action to claim → fire via Convex (drop the HTTP fetch + manual partition).
- `app/agents/page.tsx` — gate the `NextHeartbeat` badge on `heartbeatEnabled`.
- `components/builder/HeartbeatCard.tsx` — switch scheduler/countdown to the shared wall-clock slot.
- `app/builder/page.tsx` — `fireHeartbeatNow` claims the slot before firing.

---

## Task 1: Pure compare-and-advance helper

**Files:**
- Modify: `lib/builder/heartbeatSchedule.ts`
- Test: `lib/builder/heartbeatSchedule.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/builder/heartbeatSchedule.test.ts`:

```ts
import {
  hashString,
  heartbeatPhase,
  nextHeartbeatFireAt,
  resolveIntervalMs,
  videosPerDayToCron,
  evaluateHeartbeatClaim,
} from "./heartbeatSchedule";

describe("evaluateHeartbeatClaim", () => {
  const NOW = 1_000_000_000_000;

  it("does not claim a disabled/manual agent (intervalMs 0)", () => {
    const r = evaluateHeartbeatClaim({ now: NOW, intervalMs: 0, mintAddress: MINT_A, storedNextFireAt: undefined });
    expect(r.claimed).toBe(false);
    expect(r.nextFireAt).toBeUndefined();
  });

  it("seeds (does not fire) an agent with no stored slot", () => {
    const r = evaluateHeartbeatClaim({ now: NOW, intervalMs: M15, mintAddress: MINT_A, storedNextFireAt: undefined });
    expect(r.claimed).toBe(false);
    expect(r.nextFireAt).toBe(nextHeartbeatFireAt(NOW, M15, MINT_A));
  });

  it("claims and advances when the slot is due", () => {
    const due = NOW - 1;
    const r = evaluateHeartbeatClaim({ now: NOW, intervalMs: M15, mintAddress: MINT_A, storedNextFireAt: due });
    expect(r.claimed).toBe(true);
    expect(r.nextFireAt).toBe(nextHeartbeatFireAt(NOW, M15, MINT_A));
    expect(r.nextFireAt!).toBeGreaterThan(NOW);
  });

  it("does not claim before the slot arrives", () => {
    const future = NOW + 60_000;
    const r = evaluateHeartbeatClaim({ now: NOW, intervalMs: M15, mintAddress: MINT_A, storedNextFireAt: future });
    expect(r.claimed).toBe(false);
    expect(r.nextFireAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/builder/heartbeatSchedule.test.ts`
Expected: FAIL — `evaluateHeartbeatClaim is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/builder/heartbeatSchedule.ts`:

```ts
/**
 * Result of deciding whether a caller may fire an agent's heartbeat right now.
 * `claimed` true means THIS caller won the slot and should run the autonomy loop.
 * `nextFireAt` is the slot to persist (the advanced slot on a claim, or the
 * seeded slot when an agent is first seen). Undefined means "leave the stored
 * value unchanged".
 */
export interface HeartbeatClaim {
  claimed: boolean;
  nextFireAt?: number;
}

/**
 * Pure compare-and-advance decision shared by the Convex `claimHeartbeat`
 * mutation and any client that wants to fire. Deterministic given its inputs so
 * cron and client agree exactly.
 *
 *  • intervalMs <= 0 (manual/disabled) → never claims.
 *  • no stored slot → seed the next slot, do NOT fire (avoids a first-sight
 *    stampede; the agent fires on its own staggered clock from here).
 *  • now >= stored slot → claim and advance to the next future slot.
 *  • otherwise → not yet due.
 */
export function evaluateHeartbeatClaim(args: {
  now: number;
  intervalMs: number;
  mintAddress: string;
  storedNextFireAt: number | undefined;
}): HeartbeatClaim {
  const { now, intervalMs, mintAddress, storedNextFireAt } = args;
  if (intervalMs <= 0) return { claimed: false };
  if (storedNextFireAt === undefined) {
    return { claimed: false, nextFireAt: nextHeartbeatFireAt(now, intervalMs, mintAddress) };
  }
  if (now >= storedNextFireAt) {
    return { claimed: true, nextFireAt: nextHeartbeatFireAt(now, intervalMs, mintAddress) };
  }
  return { claimed: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/builder/heartbeatSchedule.test.ts`
Expected: PASS (all evaluateHeartbeatClaim cases green; existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add lib/builder/heartbeatSchedule.ts lib/builder/heartbeatSchedule.test.ts
git commit -m "feat(vello): pure evaluateHeartbeatClaim compare-and-advance helper"
```

---

## Task 2: `claimHeartbeat` Convex mutation

**Files:**
- Modify: `convex/influencers.ts`

- [ ] **Step 1: Add the mutation**

Add near `markHeartbeatFired` in `convex/influencers.ts`. Ensure the file imports
the helpers (top of file): `import { resolveIntervalMs, evaluateHeartbeatClaim } from "../lib/builder/heartbeatSchedule";` (merge with the existing `nextHeartbeatFireAt` import — they share the module).

```ts
/**
 * Atomic compare-and-advance claim. Returns { claimed: true } to exactly one
 * concurrent caller (cron or an open client page) when the agent's wall-clock
 * slot is due, advancing the slot in the same transaction so nobody re-fires it.
 * Seeds a slot for never-seen agents without firing. Public so the builder can
 * call it as a localhost firing fallback.
 */
export const claimHeartbeat = mutation({
  args: { mintAddress: v.string(), now: v.number() },
  handler: async (ctx, { mintAddress, now }) => {
    const influencer = await ctx.db
      .query("influencers")
      .withIndex("by_mint", (q) => q.eq("mintAddress", mintAddress))
      .first();
    if (!influencer) return { claimed: false };
    if (!influencer.heartbeatEnabled) return { claimed: false };

    const intervalMs = resolveIntervalMs(influencer.heartbeatCron);
    const decision = evaluateHeartbeatClaim({
      now,
      intervalMs,
      mintAddress,
      storedNextFireAt: influencer.heartbeatNextFireAt,
    });

    if (decision.nextFireAt !== undefined) {
      await ctx.db.patch(influencer._id, {
        heartbeatNextFireAt: decision.nextFireAt,
        ...(decision.claimed ? { heartbeatLastFiredAt: now } : {}),
      });
    }
    return { claimed: decision.claimed };
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "convex/influencers" | head`
Expected: no output (no errors in the file).

- [ ] **Step 3: Verify Convex codegen accepts it**

Run: `npx convex codegen 2>&1 | tail -5`
Expected: completes without a schema/validator error (or prints generated api). If `convex` is not logged in locally, skip and rely on tsc.

- [ ] **Step 4: Commit**

```bash
git add convex/influencers.ts
git commit -m "feat(vello): atomic claimHeartbeat mutation (compare-and-advance)"
```

---

## Task 3: Convex firing + dispatch actions

**Files:**
- Modify: `convex/agentAutonomy.ts`

- [ ] **Step 1: Add the actions**

At the top of `convex/agentAutonomy.ts`, ensure these imports exist (merge with
existing ones): `import { mutation, query, internalAction } from "./_generated/server";`
and `import { internal, api } from "./_generated/api";` and `import { v } from "convex/values";`.

Append:

```ts
/**
 * Convex-native heartbeat fire. Runs the rule-based planner (generateTasksForAgent)
 * to create pending tasks, then schedules dispatch to the Next executor. No Kie /
 * LLM call here — planning is deterministic and runs 24/7 in the Convex cloud.
 */
export const fireHeartbeatForAgent = internalAction({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }): Promise<{ generated: number }> => {
    let generated = 0;
    try {
      const res = await ctx.runMutation(api.agentAutonomy.generateTasksForAgent, { mintAddress });
      generated = res?.count ?? 0;
    } catch (e) {
      console.warn("[fireHeartbeatForAgent] planning failed:", e instanceof Error ? e.message : e);
    }
    if (generated > 0) {
      await ctx.scheduler.runAfter(0, internal.agentAutonomy.dispatchPendingTasks, { mintAddress });
    }
    return { generated };
  },
});

/**
 * Best-effort execution: POST each pending task to the Next run-task executor
 * (which owns ffmpeg / posting). Failures are non-fatal — the task stays pending
 * and is retried on the next heartbeat. Reaches the dev server on localhost and
 * the deployed domain in production.
 */
export const dispatchPendingTasks = internalAction({
  args: { mintAddress: v.string() },
  handler: async (ctx, { mintAddress }): Promise<{ dispatched: number }> => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const secret = process.env.INTERNAL_CRON_SECRET;
    const pending = await ctx.runQuery(api.agentAutonomy.listPendingForMint, { mintAddress });
    const tasks = Array.isArray(pending) ? pending : [];
    await Promise.allSettled(
      tasks.map((t: { _id: string }) =>
        fetch(`${appUrl}/api/agents/run-task`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(secret ? { "X-Internal-Secret": secret } : {}),
          },
          body: JSON.stringify({ mintAddress, taskId: t._id, triggeredBy: "cron_heartbeat" }),
        }).catch(() => null),
      ),
    );
    return { dispatched: tasks.length };
  },
});
```

- [ ] **Step 2: Confirm `listPendingForMint` returns `_id`**

Run: `grep -n "listPendingForMint" convex/agentAutonomy.ts`
Expected: the existing query (≈ line 229) returns the agentTasks docs (each has `_id`). If it `.map`s to a narrower shape, widen it to include `_id`.

- [ ] **Step 3: Confirm run-task accepts `taskId`**

Run: `grep -n "taskId" app/api/agents/run-task/route.ts | head`
Expected: run-task reads a `taskId` (executes that pending task in place). If it
does NOT accept `taskId`, change the dispatch body to
`{ mintAddress, triggeredBy: "cron_heartbeat" }` and let run-task pull the next
pending task itself (whichever the route already supports — verify before wiring).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "convex/agentAutonomy" | head`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add convex/agentAutonomy.ts
git commit -m "feat(vello): convex fireHeartbeatForAgent + dispatchPendingTasks actions"
```

---

## Task 4: Rewire the cron to fire via Convex

**Files:**
- Modify: `convex/crons.ts`

- [ ] **Step 1: Replace the heartbeat handler body**

In `convex/crons.ts`, replace the `heartbeat` internalAction handler (the
partition + `fetch(.../autonomy-loop)` block) with a claim→fire loop. Keep
`getHeartbeatAgents`. New handler:

```ts
export const heartbeat = internalAction({
  args: {},
  handler: async (ctx): Promise<{ fired: number; totalAgents: number }> => {
    const agents: AgentHeartbeat[] = await ctx.runQuery(internal.crons.getHeartbeatAgents, {});
    const now = Date.now();
    let fired = 0;
    await Promise.allSettled(
      agents.map(async (a) => {
        if (!a.heartbeatEnabled) return;
        const claim = await ctx.runMutation(api.influencers.claimHeartbeat, {
          mintAddress: a.mintAddress,
          now,
        });
        if (!claim?.claimed) return;
        fired += 1;
        await ctx.runAction(internal.agentAutonomy.fireHeartbeatForAgent, {
          mintAddress: a.mintAddress,
        });
      }),
    );
    return { fired, totalAgents: agents.length };
  },
});
```

Remove the now-unused imports if they cause lint errors (`resolveIntervalMs`,
`nextHeartbeatFireAt`) — keep them only if still referenced elsewhere in the file
(they are not, after this change). Leave `getHeartbeatAgents`, `settleDueTabs`,
and the `crons.interval(...)` registrations untouched.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "convex/crons" | head`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add convex/crons.ts
git commit -m "feat(vello): cron fires heartbeat via convex claim+action (no HTTP)"
```

---

## Task 5: Gate the `/agents` heartbeat badge

**Files:**
- Modify: `app/agents/page.tsx`

- [ ] **Step 1: Wrap the badge in an enabled check**

In `HireCard` (≈ lines 769–772), replace the unconditional badge:

```tsx
          {/* Heartbeat countdown — only for agents that enabled it */}
          {agent.heartbeatEnabled && resolveIntervalMs(agent.heartbeatCron) > 0 && (
            <span className="absolute bottom-1.5 left-1.5 z-30 inline-flex items-center rounded-md bg-black/55 px-1.5 py-0.5 ring-1 ring-white/10 backdrop-blur-sm">
              <NextHeartbeat agent={agent} />
            </span>
          )}
```

`resolveIntervalMs` is already imported at the top of the file (line 6).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "app/agents/page" | head`
Expected: no output.

- [ ] **Step 3: Manual verify**

Run: `npm run dev` and open `http://localhost:3000/agents`.
Expected: only agents with their heartbeat turned on show the pink countdown
pill; heartbeat-off agents show no pill. The countdown for an enabled agent
matches that agent's builder countdown.

- [ ] **Step 4: Commit**

```bash
git add app/agents/page.tsx
git commit -m "fix(vello): show heartbeat badge only for heartbeat-enabled agents"
```

---

## Task 6: Builder shares the wall-clock slot

**Files:**
- Modify: `components/builder/HeartbeatCard.tsx`

- [ ] **Step 1: Import the shared math**

At the top of `components/builder/HeartbeatCard.tsx`, add:

```ts
import { resolveIntervalMs, nextHeartbeatFireAt } from "@/lib/builder/heartbeatSchedule";
```

Add `mintAddress` + `nextFireAt` to `HeartbeatCardProps`:

```ts
interface HeartbeatCardProps {
  blueprint: AgentBlueprint;
  onHeartbeatChange: (next: NonNullable<AgentBlueprint["heartbeat"]>) => void;
  onTick: () => void | Promise<void>;
  variant?: "paper" | "dark";
  bare?: boolean;
  title?: string;
  /** On-chain mint — anchors the wall-clock fire slot (shared with /agents + cron). */
  mintAddress?: string;
  /** Persisted server slot; when present it's the single source of truth. */
  nextFireAt?: number;
}
```

- [ ] **Step 2: Compute the slot from shared math**

In the `HeartbeatCard` component body, derive the next fire instant from the
wall-clock math instead of `getNextHeartbeatAt`. Replace the line:

```ts
  const nextFireAt = heartbeat.enabled ? getNextHeartbeatAt(heartbeat.cron, heartbeat.lastFiredAt) : null;
```

with:

```ts
  const intervalMs = resolveIntervalMs(heartbeat.cron);
  const slotKey = props.mintAddress ?? blueprint.mintAddress ?? blueprint.persona?.name ?? "agent";
  const wallClockNext =
    intervalMs > 0
      ? (props.nextFireAt && props.nextFireAt > Date.now()
          ? props.nextFireAt
          : nextHeartbeatFireAt(Date.now(), intervalMs, slotKey))
      : null;
  const nextFireAt = heartbeat.enabled ? wallClockNext : null;
```

(If the component destructures props, read `props.mintAddress`/`props.nextFireAt`
accordingly — match the file's existing prop access style. The function
signature already takes a single `props`-style object via the named params at
`export default function HeartbeatCard({ ... })`; add `mintAddress` and
`nextFireAt` to that destructure and reference them without the `props.` prefix.)

- [ ] **Step 3: Align the auto-fire scheduler to the same slot**

In `useHeartbeatScheduler`, change the due check to the wall-clock slot. Replace
the `tryFire` slot computation:

```ts
      const next = getNextHeartbeatAt(cron, lastFiredAt);
      if (next === null) return;
      if (Date.now() < next) return;
```

with a passed-in `nextAt` argument. Update the hook signature to accept the
computed `wallClockNext` and use it:

```ts
function useHeartbeatScheduler(
  enabled: boolean,
  cron: HeartbeatCron,
  nextAt: number | null,
  onTick: () => void | Promise<void>,
  onTickComplete: (firedAt: number) => void,
) {
  const tickingRef = useRef(false);
  useEffect(() => {
    if (!enabled || cron === "manual" || nextAt === null) return;
    const tryFire = async () => {
      if (tickingRef.current) return;
      if (Date.now() < nextAt) return;
      tickingRef.current = true;
      const firedAt = Date.now();
      try {
        await onTick();
        onTickComplete(firedAt);
      } finally {
        tickingRef.current = false;
      }
    };
    void tryFire();
    const id = setInterval(() => { void tryFire(); }, 30_000);
    return () => clearInterval(id);
  }, [enabled, cron, nextAt, onTick, onTickComplete]);
}
```

Update the call site of `useHeartbeatScheduler(...)` to pass `wallClockNext`
instead of `heartbeat.lastFiredAt`. Update `useCountdown(nextFireAt)` — it already
takes the computed `nextFireAt`, which is now wall-clock. Remove the
`getNextHeartbeatAt` import if it is no longer referenced.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "HeartbeatCard" | head`
Expected: no output.

- [ ] **Step 5: Pass the new props from the workspace**

In `components/builder/AgentWorkspace.tsx` where `<HeartbeatCard ... />` is
rendered (≈ line 958), add `mintAddress={props.blueprint.mintAddress}` and
`nextFireAt={props.blueprint.heartbeatNextFireAt}` if available on the blueprint;
otherwise pass `mintAddress` only. Verify the prop exists:

Run: `grep -n "heartbeatNextFireAt" lib/builder/agentTypes.ts`
Expected: if present, pass it; if not, pass only `mintAddress` (the card falls
back to pure math, which still matches `/agents`).

- [ ] **Step 6: Commit**

```bash
git add components/builder/HeartbeatCard.tsx components/builder/AgentWorkspace.tsx
git commit -m "feat(vello): builder heartbeat shares wall-clock slot with cron + /agents"
```

---

## Task 7: Builder claims before firing

**Files:**
- Modify: `app/builder/page.tsx`

- [ ] **Step 1: Add the claim mutation hook**

Near the other `useMutation` calls in `BuilderPageInner` (e.g. by
`saveAgentConfigEarly`), add:

```ts
  const claimHeartbeat = useMutation(api.influencers.claimHeartbeat);
```

- [ ] **Step 2: Claim inside the auto-fire path**

`fireHeartbeatNow` is used both for the manual button and the scheduler. Add an
optional `auto` flag so only the *automatic* path is gated by the claim (manual
"fire now" should always run). Change the signature and add the guard at the top
of the function body (after resolving `mint`):

```ts
  const fireHeartbeatNow = useCallback(async (auto = false) => {
    const bp = agentBlueprintRef.current;
    const mint = bp?.mintAddress;
    if (!mint) {
      setMessages((prev) => [...prev, { id: `${Date.now()}-hb-nomint`, text: "Mint the agent first — the heartbeat runs under the agent's on-chain identity.", sender: "ai" as const, timestamp: new Date() }]);
      return;
    }
    if (auto) {
      // Only fire if THIS client wins the shared slot — the cron or another tab
      // may have already claimed it. CAS prevents a double autonomy-loop.
      try {
        const claim = await claimHeartbeat({ mintAddress: mint, now: Date.now() });
        if (!claim?.claimed) return;
      } catch { return; }
    }
    // ...existing body unchanged (fetch /api/agents/autonomy-loop, etc.)
  }, [claimHeartbeat]);
```

Keep the rest of the existing body. Add `claimHeartbeat` to the dependency array.

- [ ] **Step 3: Pass `auto` from the scheduler, not the button**

The card's auto-scheduler calls `onTick` (wired to `onFireHeartbeat` →
`fireHeartbeatNow`). The manual button also calls `onTick`. To distinguish them
without a larger refactor, wire the workspace's `onFireHeartbeat` to
`() => fireHeartbeatNow(true)` (auto-gated) and leave the manual "Execute/fire
now" button calling the un-gated path. Find the prop wiring at
`app/builder/page.tsx:4389` (`onFireHeartbeat={fireHeartbeatNow}`) and change to:

```tsx
              onFireHeartbeat={() => fireHeartbeatNow(true)}
```

The manual fire-now inside `HeartbeatCard` (its `fireNow`) calls the same
`onTick`, so it is also auto-gated. That is acceptable: a manual click when the
slot is not yet due will no-op silently, which is confusing. To preserve manual
firing, instead pass BOTH behaviours: keep `onFireHeartbeat={fireHeartbeatNow}`
(manual, un-gated) and add the claim inside `useHeartbeatScheduler` is not
possible (it's in the card). Simpler: gate at the action by time, not by flag —
see Step 4.

- [ ] **Step 4: Use a time-gate instead of a flag (final approach)**

Discard the `auto` flag. Instead, always attempt a claim, but treat a manual
click as "force": pass `force` through. Final `fireHeartbeatNow`:

```ts
  const fireHeartbeatNow = useCallback(async (opts?: { auto?: boolean }) => {
    const bp = agentBlueprintRef.current;
    const mint = bp?.mintAddress;
    if (!mint) {
      setMessages((prev) => [...prev, { id: `${Date.now()}-hb-nomint`, text: "Mint the agent first — the heartbeat runs under the agent's on-chain identity.", sender: "ai" as const, timestamp: new Date() }]);
      return;
    }
    if (opts?.auto) {
      try {
        const claim = await claimHeartbeat({ mintAddress: mint, now: Date.now() });
        if (!claim?.claimed) return;
      } catch { return; }
    }
    setMessages((prev) => [...prev, { id: `${Date.now()}-hb-fire`, text: `⚡ Heartbeat fired — ${bp?.persona?.name ?? "your agent"} is reading its persona + memory, creating tasks, and running them. Watch the **Tasks** panel for live updates.`, sender: "ai" as const, timestamp: new Date() }]);
    // ...rest of existing body unchanged...
  }, [claimHeartbeat]);
```

Wire the workspace auto path to `onFireHeartbeat={() => fireHeartbeatNow({ auto: true })}`
and ensure the manual button in `HeartbeatCard` (`fireNow`) is reachable via a
different prop OR accept that `HeartbeatCard.fireNow` → `onTick` → auto-gated.
Decision (documented): the manual button calls the same `onTick`; since the
manual button is only shown when `heartbeat.enabled`, and a user clicking it
expects work, pass `force` to `generateTasksForAgent` through the autonomy-loop.
Keep manual un-gated by leaving the in-card `fireNow` mapped to a NON-auto call:
set `onFireHeartbeat={fireHeartbeatNow}` (manual default, no auto) and have the
scheduler call a separate `onAutoTick`. Since `HeartbeatCard` already separates
`useHeartbeatScheduler`'s `onTick` from the button's `fireNow` (both currently
`onTick`), add an `onAutoTick?` prop to `HeartbeatCard` used ONLY by the
scheduler, defaulting to `onTick`. Then:
  - `app/builder/page.tsx`: `onFireHeartbeat={fireHeartbeatNow}` (manual) and add
    `onAutoFireHeartbeat={() => fireHeartbeatNow({ auto: true })}`.
  - `AgentWorkspace.tsx`: forward `onAutoFireHeartbeat` to `HeartbeatCard` as
    `onAutoTick`.
  - `HeartbeatCard.tsx`: `useHeartbeatScheduler(..., onAutoTick ?? onTick, ...)`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "builder/page|AgentWorkspace|HeartbeatCard" | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/builder/page.tsx components/builder/AgentWorkspace.tsx components/builder/HeartbeatCard.tsx
git commit -m "feat(vello): builder auto-fire claims shared slot; manual fire stays un-gated"
```

---

## Task 8: Full typecheck + test sweep

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run lib/builder/heartbeatSchedule.test.ts`
Expected: PASS.

- [ ] **Step 2: Full typecheck of touched files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "convex/crons|convex/influencers|convex/agentAutonomy|app/agents/page|app/builder/page|HeartbeatCard|AgentWorkspace" | head`
Expected: no output.

- [ ] **Step 3: Commit any stragglers**

```bash
git add -A && git commit -m "chore(vello): heartbeat convex-native firing — final sweep" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** Part A → Task 5; Part B → Task 6; Part C → Tasks 1–4; Part D
  → Task 7. Env requirements are runtime config, not code (documented in spec).
- **Rule-based planning only:** Task 3 calls `generateTasksForAgent`; no Kie key
  used in Convex. ✓
- **No double-fire:** single `claimHeartbeat` CAS used by cron (Task 4) and
  client (Task 7). ✓
- **Open risk to verify during execution:** run-task's `taskId` contract
  (Task 3, Step 3) and whether `heartbeatNextFireAt` lives on the blueprint
  (Task 6, Step 5) — both have documented fallbacks if the assumption is wrong.
