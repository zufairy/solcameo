# Second Brain consolidation + task-card UX + Duolingo cards — Design

Date: 2026-06-01
App: `apps/vello`
Branch context: `feat/web3-settlement-layer`

## Problem

Three issues in the agent builder (`/builder`):

1. **Second Brain clutter.** Knowledge is saved to the graph on essentially every
   chat turn. The Q&A fallback save (`app/builder/page.tsx:~1378`) uses
   `localId: qa-${sessionId}-${Date.now()}`, so the `saveEntry` upsert never
   matches and a **new node is created per message**. The transcription route
   (`app/api/transcribe-video/route.ts:~110`) passes **no `localId`**, so each
   call duplicates. There is no relevance filter, so chit-chat becomes nodes.

2. **Task cards** linger then fade; the user wants completed tasks to play a
   smooth, slow **slide-up-and-remove** animation.

3. **Card styling.** There is a complete `.duo-btn` 3D-flat ("Duolingo") system in
   `app/globals.css` but **no `.duo-card`**. Main builder cards use a flat
   `PaperCard`. The user wants the 3D-flat card treatment.

## Decisions (confirmed)

- Memory engine: **deterministic consolidation** (no per-save LLM calls).
- Relevance gate: **durable knowledge only** — skip greetings/acknowledgements/commands.
- Duolingo card scope: **Task + Mission + Heartbeat cards**.

---

## Part 1 — Second Brain: relevance gate + deterministic consolidation

### Data model (unchanged)

`agentKnowledge` table + `saveEntry` mutation already upsert by
`(sessionId, localId)`. We exploit this: **stable `localId`s → updates, not inserts.**

### Canonical per-session nodes

| Node | `localId` | category | Content |
|---|---|---|---|
| References & Inspiration | `refs-${sessionId}` | `knowledge` | one deduped bullet per reference URL / video / transcript |
| Conversation Notes | `notes-${sessionId}` | `knowledge` | deduped bullets of durable facts/preferences from chat |
| Visual Identity | `visual-identity-${sessionId}` | `knowledge` | character bible (already stable — unchanged) |
| Persona core / Skills | existing stable ids | `core` / `skill` | unchanged |

### New module: `lib/builder/secondBrain.ts`

Pure, unit-testable helpers (no React, no network):

- `classifyChatTurn(userText: string): { kind: "reference" | "note" | "skip"; text: string; url?: string }`
  - `skip` when the message is a short acknowledgement/command. Heuristic:
    trimmed length < 40 **and** matches
    `/^(ok(ay)?|thanks?|thank you|cool|nice|great|sure|yes|no|yep|nope|go|do it|generate.*|create.*|make.*|continue|next)\b/i`,
    or the message is empty/whitespace.
  - `reference` when it contains an http(s) URL → returns the first URL.
  - `note` when it is durable: length ≥ 40, OR contains a durable keyword
    (`niche|audience|avoid|never|always|prefer|tone|style|brand|target|language|budget|goal|rule`).
  - otherwise `skip`.
- `mergeBullet(existingContent: string, bullet: string): { content: string; changed: boolean }`
  - Appends `- ${bullet}` under the body only if no existing line normalizes
    (lowercase, trim, strip punctuation) to the same text. `changed=false` when
    it was a duplicate (caller can skip the write).
- `referenceBullet(url: string, note?: string): string` and
  `normalizeForDedup(s: string): string` helpers.

### New client helper (in `page.tsx`, near the existing `saveKnowledge` hook)

`upsertBrainNode(opts: { localId; title; category; tags; bullet })`:
1. Find the current node in the in-memory `dbEntries`
   (`useQuery(api.agentKnowledge.listBySession)`) by `localId`.
2. `mergeBullet(existing?.content ?? header, bullet)`. If `!changed`, return (no write).
3. Call `saveKnowledge({ sessionId, localId, title, category, tags, links: [], content })`.
   The mutation upserts by `localId`.

A stable header line is used when creating the node, e.g.
`# References & Inspiration\n` then bullets.

### Wiring changes

- Replace the per-turn Q&A insert (`page.tsx:~1378`): run `classifyChatTurn`;
  - `skip` → do nothing;
  - `note` → `upsertBrainNode({ localId: "notes-"+sid, title: "Conversation Notes", category: "knowledge", tags: ["conversation","notes",niche], bullet })`;
  - `reference` → `upsertBrainNode({ localId: "refs-"+sid, ... , bullet: referenceBullet(url) })`.
- Video-URL save (`page.tsx:~1374`) → route into the same `refs-${sid}` node
  (dedupe by URL via `mergeBullet`), instead of a separate node per URL.
- Transcription route (`transcribe-video/route.ts:~110`) → pass a stable
  `localId` of `refs-${sessionId}` and merge the transcript summary as a bullet
  (or `transcript-${sessionId}-${urlHash}` if we keep transcripts as their own
  node — chosen: fold the short summary into `refs-`, keep full transcript out of
  the graph to avoid bloat).
- `auto_persona` / skills saves: unchanged (already stable).

### Result

The graph shows a small, stable set of growing category nodes. Chit-chat is
skipped. Re-stating the same fact does not create a duplicate bullet.

### Tests

Unit tests for `secondBrain.ts` (Vitest, already configured):
`classifyChatTurn` (skip/reference/note cases), `mergeBullet` (append + dedupe).

---

## Part 2 — Task cards: smooth slide-up-and-remove

In `components/builder/AgentWorkspace.tsx` (`LiveTaskStrip` and/or
`TaskCardRunnable`):

- Keep the existing brief "done" celebrate state on `succeeded` (~1.2s).
- Then remove the task from the rendered list so `AnimatePresence` runs the exit.
- Exit transition (slow + smooth):
  - `exit={{ opacity: 0, y: -16, height: 0, marginTop: 0, marginBottom: 0 }}`
  - `transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}`
  - `layout` on the card so neighbors glide up.
- `failed` tasks keep current behavior (they should remain visible for the user).

A small local timer (`setTimeout`) marks a succeeded task as "dismissed" after the
celebrate window; dismissed ids are filtered out of the list, triggering the exit.

---

## Part 3 — `.duo-card` 3D-flat Duolingo style

Add to `app/globals.css` next to `.duo-btn`:

```css
.duo-card {
  background: #ffffff;
  border: 2px solid #e6e4dd;
  border-radius: 20px;
  box-shadow: 0 4px 0 0 #e0ddd3, inset 0 -1px 0 rgba(0,0,0,0.02);
}
.duo-card-dark {
  background: #0c0f14;
  border: 2px solid rgba(255,255,255,0.08);
  box-shadow: 0 4px 0 0 rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.03);
}
.duo-card-interactive { transition: transform 70ms ease-out, box-shadow 70ms ease-out; cursor: pointer; }
.duo-card-interactive:active { transform: translateY(2px); box-shadow: 0 2px 0 0 #e0ddd3; }
.duo-card-dark.duo-card-interactive:active { box-shadow: 0 2px 0 0 rgba(0,0,0,0.5); }
```

Apply `.duo-card` to the wrapper of:
- Task cards (`TaskCardRunnable`, `LiveTaskCard`) — add `.duo-card-interactive`.
- Mission card (`MissionCard.tsx`).
- Heartbeat card (`HeartbeatCard.tsx`, `paper` variant → `.duo-card`,
  `dark` variant → `.duo-card duo-card-dark`).

Spacing: cards need a touch more bottom margin so the 4px offset shadow isn't clipped.

---

## Out of scope / YAGNI

- No LLM-based memory (mem0) — explicitly deferred.
- No server-side cron compaction pass.
- No restyle of non-targeted cards (mint, skills, generations, chat).
- Full video transcripts stay out of the graph (only short summaries as bullets).

## Files touched

- `lib/builder/secondBrain.ts` (new) + `test/` unit test (new)
- `app/builder/page.tsx` (wiring: gate + upsertBrainNode)
- `app/api/transcribe-video/route.ts` (stable localId)
- `components/builder/AgentWorkspace.tsx` (task exit animation + duo-card)
- `components/builder/MissionCard.tsx`, `components/builder/HeartbeatCard.tsx` (duo-card)
- `app/globals.css` (`.duo-card`)
