# AI Clipping Mode — Flow Canvas (design spec)

- **Date:** 2026-06-10
- **Branch:** `feat/clipping-flow-canvas` (off `main` @ `b3c01e6`)
- **Trello card:** "AI CLIPPING MODE" (n8n-style visuals · top menu · simple MVP · marketplace skills)
- **Status:** approved design → ready for implementation plan

## 1. Context

The boss wants an n8n-style visual canvas for AI clipping. The original card imagined a standalone Clipping menu (Home/Clipping/Marketplace/Library/History), but the **real** architecture is different and supersedes that:

- AI clipper creation lives in the **Build tab** (`/studio/build`, "AI Influencer" / "AI Clippers" sub-tabs) → opens **`/builder?type=clipping`**, a full-screen builder workspace.
- The builder (`apps/web/app/builder/page.tsx`, ~4000 lines) has a `canvasViewMode` toggle: **Studio** (`WorkflowCanvas.tsx`, cards) and **Graph** (`MindmapCanvas.tsx`, a hand-rolled SVG force-simulation knowledge map). **Neither is React Flow.**
- Clipping is a first-class `agentType="clipping"` branch. `AgentWorkspace.tsx:509` already renders the real clip pipeline UI (`ClipUrlInput` + `ClipJobProgress` + `ClipsQueue`) off live Convex queries.
- A working n8n prototype already exists in a separate repo: `C:\Project\Jobtepi\vello-web\src\components\clipping\` — React Flow v12 + zustand, polymorphic node, drag-drop palette, inspector, run bar, and a `mock-runner.ts` with real topo-sort/cycle detection. Same core stack as `apps/web` (Next 16, React 19, Tailwind v4, Base UI, zustand, framer-motion).

## 2. Goal & scope

Deliver the n8n-style clipping canvas as a **new "Flow" view inside the clipping builder**, ported from the existing prototype, **editable** (drag / connect / configure / persist).

**Scope is frontend-first. ALL backend work is ON HOLD** (per explicit instruction) until the frontend is approved:

| In scope (first slice — frontend only) | ON HOLD (backend — do NOT build yet) |
|---|---|
| New `Flow` view + 3rd toggle in the builder, gated to clipping agents | New Convex `clipGraphs` table + save/load mutations |
| Port the React Flow canvas, palette, inspector, run bar | Compile graph → `ClipConfig` + persist to `agent.clipConfig` |
| Node kinds: Source / Compose / Skill / Publish | Run → real `clip_source` enqueue (`clipJobs`) |
| Local state (zustand) + **localStorage** persistence per agent | Live node status from `clipJobs`/`clips` reactive queries |
| Mock run (ported `mock-runner.ts`) for the animation | Multi-source parallel jobs, real output previews |
| Re-skin to the builder theme | Any Convex schema / API route changes |

**Non-goals:** changing the existing Studio/Graph views; touching the influencer or trader builders; any Convex/API/backend change; new env vars.

## 3. Architecture

### 3.1 Placement
- Extend the `canvasViewMode` union in `app/builder/page.tsx` with `"flow"`.
- Add a **"Flow"** toggle button beside Studio/Graph (page.tsx ~lines 4165–4179) and matching command-palette entries (~4056–4057). Render the button **only when `agentType === "clipping"`**.
- When `canvasViewMode === "flow"` (and clipping), render `<ClippingFlowCanvas/>` in the builder's main area (reuse the `agentType==="clipping"` gate pattern at `AgentWorkspace.tsx:509`). Studio and Graph remain untouched and default.

### 3.2 Ported components (new folder `apps/web/components/builder/clipping-flow/`)
From `C:\Project\Jobtepi\vello-web\src\`:
- `components/clipping/canvas/{flow-canvas,clip-node,node-types,node-visual,default-graph}.tsx/ts`
- `components/clipping/palette/node-palette.tsx`
- `components/clipping/inspector/inspector-panel.tsx`
- `components/clipping/run/{run-bar,output-preview}.tsx`
- `components/clipping/clipping-studio.tsx` → renamed `ClippingFlowCanvas.tsx` (the assembled view: palette + canvas + inspector + run bar)
- `store/clipping-store.ts`, `types/clipping.ts`, `data/node-catalog.ts`, `lib/mock-runner.ts`

### 3.3 Node model
Ported verbatim from the prototype. Node kinds (`node-types.ts`): `source`, `compose`, `skill`, `publish`; all render through one polymorphic `ClipNode` that adapts to `data.kind`. `VelloNode.data = { kind, title, status, config, output?, error? }`. Default graph: Source → Compose → {Captions, B-roll, Crop} → Publish (the card's "marketplace skills" are the skill nodes).

### 3.4 Frontend state & persistence
- State: ported zustand `useClippingStore` (nodes/edges/selection/run status + `onNodesChange`/`onConnect`/`addNodeFromCatalog`/`updateNodeConfig`/`startRun`).
- **Persistence (frontend-only for now):** add zustand `persist` middleware keyed by the agent's `mintAddress` (or session id) → **localStorage**. This gives per-agent save/restore with zero backend.
- **DEFERRED (backend, ON HOLD):** replace localStorage with a Convex `clipGraphs` table `{ mintAddress, nodes, edges, updatedAt }` + `saveGraph`/`getGraph`. Spec'd here only so the frontend store shape stays forward-compatible.

### 3.5 Execution model — DEFERRED (backend, ON HOLD)
Documented now so the frontend is built to fit it; **not implemented in the first slice** (the ported `mock-runner.ts` drives the run animation instead).

When unheld, "Run" will **compile** the graph rather than re-architect the backend:
- Source node(s) → `sourceUrl`(s); Compose + Skill + Publish node configs → a `ClipConfig` (see `lib/builder/clipConfig.ts` / `DEFAULT_CLIP_CONFIG`), also written to `agent.clipConfig`.
- Call the existing `clip_source` enqueue (`app/api/agents/run-task/route.ts:1063` → `convex/clipJobs.ts:enqueue`); the untouched `clipJobs.process` pipeline runs (Download → Transcribe → Select moments → Cut + edit ops → Auto-post → `clips`).
- Node statuses come from live `clipJobs.status` + `clips` (`listJobsByMint`/`listClipsByMint`), mapped via `lib/builder/clipPhase.ts` `STATUS_INDEX`. `OutputPreview` reads real `clips` rows.

## 4. Node semantics (decision)
- **Skill nodes (Captions / Crop / B-roll) = options + skills compiled into ONE clip job**, not separate backend passes — this matches how `clipJobs.process` works today (a single job driven by `ClipConfig` + skill-driven edit ops via `clipEditPlanner`).
- **Multiple Source nodes = multiple parallel clip jobs** (the backend already dedups + parallelizes by `sourceUrl`).
- True per-node multi-pass execution is a possible later evolution, out of scope.

## 5. Port mechanics
- **Deps to add to `apps/web/package.json`:** `@xyflow/react@^12.11.0`, `sonner@^2` (toasts used by the prototype). zustand/framer-motion/lucide/base-ui already present. Install with the Windows workaround: `npm install --ignore-scripts`.
- **Imports:** prototype uses `@/*` = its `src` root; rewrite to `@/components/builder/clipping-flow/*` (and `@/...` for shared utils that already exist in `apps/web`, e.g. `@/lib/utils` `cn`). Dedup any UI primitives that already exist in `apps/web/components/ui`.
- **Theme:** re-skin the canvas/nodes to the builder's existing look (it renders inside the builder shell). Confirm light/cream builder theme vs the prototype's dark violet — restyle node-visual tokens to match.
- **Mount:** `ClippingFlowCanvas` is self-contained; it only needs the agent's `mintAddress` as a prop for (later) persistence keying.

## 6. Build phases
1. **Frontend port (this slice):** add deps; copy components into `components/builder/clipping-flow/`; wire the `"flow"` `canvasViewMode` + Flow toggle (clipping-gated); render `ClippingFlowCanvas`; localStorage persistence; mock run works; re-skin. **No backend.**
2. **ON HOLD — compile + run:** compile graph → `ClipConfig` + persist `agent.clipConfig`; Run → real `clip_source` enqueue; node status from live `clipJobs`/`clips`.
3. **ON HOLD — depth:** Convex `clipGraphs` persistence (replacing localStorage); multi-source parallel jobs; real `OutputPreview` from `clips`; palette skill catalog tied to the agent's skill files.

## 7. Testing
- Phase 1 is UI: `npm run dev:https` → Build → AI Clippers → builder → toggle **Flow** → verify canvas renders, palette adds nodes, edges connect, inspector edits config, mock Run animates, edits survive reload (localStorage). Vitest unit tests for the graph-compile helper are deferred with the backend.
- Verify Studio/Graph views and non-clipping agents are unaffected (Flow button hidden).

## 8. Open questions
- **Builder theme:** the prototype is dark-violet; the live builder screenshots look cream/neobrutalist. Confirm which theme the Flow canvas should adopt (will match the builder shell). — *resolve during phase 1 styling.*
- Backend specifics (clipGraphs schema shape, exact status→node mapping) to be finalized when backend work is unheld.

## 9. Key file references
- Live target: `apps/web/app/builder/page.tsx` (~1020 viewMode, ~4056–4057 commands, ~4165–4179 toggle), `apps/web/components/builder/AgentWorkspace.tsx:509,685-696`
- Existing clipping UI: `components/builder/{ClipUrlInput,ClipJobProgress,ClipsQueue,VideoDirectorTab}.tsx`
- Backend (HELD): `convex/clipJobs.ts`, `lib/builder/clipConfig.ts`, `lib/builder/clipPhase.ts`, `app/api/agents/run-task/route.ts:1063`
- Prototype source: `C:\Project\Jobtepi\vello-web\src\components\clipping\`, `…\src\store\clipping-store.ts`, `…\src\lib\mock-runner.ts`, `…\src\types\clipping.ts`, `…\src\data\node-catalog.ts`
