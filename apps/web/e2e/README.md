# Vello Web — Playwright E2E + Visual Snapshots

UI end-to-end tests for the clipping workspace. **No pipeline runs in the
default suite → zero API spend.** Two auth-free surfaces are the entire auth
strategy — no Privy/SIWS scripting, no committed secrets.

## Install

```bash
cd apps/web
npm install            # @playwright/test is a devDependency
npx playwright install # one-time: download the Chromium browser binary
```

## Run

```bash
npm run e2e                                   # functional E2E (chromium project)
npm run e2e -- --project=snapshot             # visual-snapshot baselines
npm run e2e -- --update-snapshots --project=snapshot   # (re)generate baselines
npm run e2e -- --list                         # list/parse-check all specs
```

`npm run e2e` runs the **chromium** (functional) and **snapshot** (visual)
projects. The **vision** project (Layer 3) is opt-in/paid and its specs
`test.skip()` unless `RUN_VISION=1` — see below.

### Point at local vs deployed

`baseURL` defaults to `http://localhost:3000`. Override with an env var:

```bash
E2E_BASE_URL=https://staging.velloagents.com npm run e2e
```

> ⚠️ Tier B specs (`/dev/clipper`) **404 in production by design**
> (`NODE_ENV === "production"` is inlined at build time). They only pass against
> a `next dev` server. Pointing `E2E_BASE_URL` at prod will fail every Tier B
> spec — that is expected.

## AUTH tiers (why there is no storageState)

Real auth is a Privy embedded wallet + SIWS — non-trivial to script and needs
live secrets. We never weaken prod security; two auth-free surfaces already
exist and cover every flow:

| Tier | Surface | What it is | Specs |
|---|---|---|---|
| **A — pre-mint** | `/builder?type=clipping` | No auth, no mint. The draft canvas. | `clipping-canvas.spec.ts` |
| **B — post-mint** | `/dev/clipper` | No auth, mint bypassed, **mocked Convex** (deterministic canned data, all writes no-op), **404 in prod**. | `posting.spec.ts`, `generations.spec.ts`, `skill-wiring.spec.ts` |

### Optional escape hatch — real authenticated Convex (out of scope here)

Only if a future flow must assert a real prod mutation persisted:

1. `echo "e2e/.auth/" >> .gitignore` (the auth state is **never committed**).
2. Add a `setup` project that opens a headed browser; log in via Privy once;
   `await context.storageState({ path: "e2e/.auth/user.json" })`.
3. Add an authed project with `storageState: "e2e/.auth/user.json"` depending on
   `setup`.

Tiers A + B cover all current flows without it — document only, don't build.

## Visual snapshots — generate + human-approve baselines

Baselines are **pixel contracts**: generate once, eyeball the PNGs, commit.

```bash
npm run e2e -- --project=snapshot --update-snapshots
# review apps/web/e2e/__screenshots__/snapshot/** before committing
git add apps/web/e2e/__screenshots__
```

- Screenshots are **element-scoped** (not full-page) to reduce flake.
- Dynamic regions (`<video>`, `<img>`, `.tabular-nums` time/balance/timezone)
  are **masked**.
- Global defaults (`playwright.config.ts`): `animations:"disabled"`,
  `caret:"hide"`, `maxDiffPixelRatio:0.01` (tolerates font-AA noise).

### CI note (OS-specific baselines)

Screenshots are OS-dependent (font rendering differs Windows vs Linux). The
`snapshotPathTemplate` folds the **project name** into the path so sets don't
collide. **Recommendation:** generate the committed baselines in CI's Linux
container (`--update-snapshots` once, commit), and treat Windows-local runs as
update-only (regenerate locally, don't fail on cross-OS diffs). Don't mix a
Windows baseline into a Linux CI gate.

## Layer 3 — AI-vision on a rendered clip (opt-in, paid)

`e2e/layer3/` asserts the *content* of a real output MP4 (captions present,
gameplay background, caption/speech sync). **Never** part of `npm run e2e`:

```bash
RUN_VISION=1 npm run e2e -- --project=vision \
  VISION_GOLDEN_MP4=/abs/path/to/golden.mp4   # deterministic, CI-safe variant
# or, manual live variant:
RUN_VISION=1 VISION_CLIP_URL=https://… npm run e2e -- --project=vision
```

Needs `KIE_API_KEY` (boss-only) and the bundled `ffmpeg-static` binary. The KIE
call itself is a clearly-marked TODO in `layer3/lib/visionVerdict.ts` (one place
to wire). Full design: `apps/web/docs/e2e-clip-vision/DESIGN.md`.

## Flagged `data-testid` needs (separate follow-up — components untouched here)

Every spec uses role/text/label or stable React-Flow library classes. These
spots would be **more robust with a test-id** but components are read-only in
this change — add them in a separate PR:

| Need | Element | Suggested attr |
|---|---|---|
| Deterministic "today" calendar cell + ordering | the day cell whose badge is `bg-lime-500` (`PostingCalendar.tsx`) | `data-testid="calendar-cell" data-today data-daykey` |
| Preview vs real chip + exact ordering | `EntryCard` (`PostingCalendar.tsx`) | `data-testid="calendar-entry" data-preview data-at` |
| Scope the Compose node | compose `.react-flow__node` (`clip-node.tsx`) | `data-testid="node-compose"` / `data-kind` |
| Scope the Generations summary pane | generations container (`AgentWorkspace.tsx`) | `data-testid="generations-pane"` |
| Skill node category (swap assertions) | skill node wrapper | `data-skill-category` |

Until then, `posting.spec.ts`'s calendar test reads the lime-badge class +
cell index, and `skill-wiring.spec.ts` asserts the swap via node-text presence.
