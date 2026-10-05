# AI Clipping Mode — Flow Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable n8n-style "Flow" canvas as a third view in the clipping agent builder (`/builder?type=clipping`), ported from the `vello-web` prototype, running on local state + mock execution.

**Architecture:** Copy the prototype's React Flow canvas (canvas/palette/inspector/run + zustand store/types/catalog/mock-runner) into `apps/web/components/builder/clipping-flow/`, rewrite its `@/` imports, mount it as a new `canvasViewMode === "flow"` branch in `app/builder/page.tsx` gated to `agentType === "clipping"`, persist each agent's graph to localStorage, and re-skin to the builder's cream/neobrutalist theme.

**Tech Stack:** Next 16 (webpack), React 19, `@xyflow/react` v12 (NEW), zustand, Base UI, Tailwind v4, vitest. **Backend is OUT OF SCOPE / HELD** — no Convex, no API, no `clipConfig`/enqueue/status wiring. Mock run only.

**Branch:** `feat/clipping-flow-canvas` (off `main` @ `b3c01e6`). NEVER commit to `main`.

---

## File Structure

New folder `apps/web/components/builder/clipping-flow/` (mirrors the prototype layout under one root):

```
clipping-flow/
  ClippingFlowCanvas.tsx        ← from prototype clipping-studio.tsx (renamed); top-level layout + persistence wiring
  clipping-flow.css             ← NEW: theme re-skin (node accents + cream canvas)
  canvas/flow-canvas.tsx
  canvas/clip-node.tsx
  canvas/node-types.ts
  canvas/node-visual.ts
  canvas/default-graph.ts
  palette/node-palette.tsx
  inspector/inspector-panel.tsx
  run/run-bar.tsx
  run/output-preview.tsx
  store/clipping-store.ts
  types/clipping.ts
  data/node-catalog.ts
  lib/mock-runner.ts
  lib/clipGraphStorage.ts       ← NEW: localStorage save/load helper (unit-tested)
  lib/clipGraphStorage.test.ts  ← NEW
```

Modified: `apps/web/components/ui/switch.tsx` (NEW — port), `apps/web/app/builder/page.tsx` (6 edits), `apps/web/package.json` (+1 dep).

### Import-rewrite rule (apply to EVERY ported file)
Rewrite these prototype prefixes → new root. Leave `@/lib/utils` and `@/components/ui/*` **unchanged** (they already exist in apps/web).

| Prototype import | Rewrite to |
|---|---|
| `@/store/clipping-store` | `@/components/builder/clipping-flow/store/clipping-store` |
| `@/types/clipping` | `@/components/builder/clipping-flow/types/clipping` |
| `@/data/node-catalog` | `@/components/builder/clipping-flow/data/node-catalog` |
| `@/lib/mock-runner` | `@/components/builder/clipping-flow/lib/mock-runner` |
| `@/components/clipping/canvas/*` | `@/components/builder/clipping-flow/canvas/*` |
| `@/components/clipping/palette/*` | `@/components/builder/clipping-flow/palette/*` |
| `@/components/clipping/inspector/*` | `@/components/builder/clipping-flow/inspector/*` |
| `@/components/clipping/run/*` | `@/components/builder/clipping-flow/run/*` |
| `@/lib/utils`, `@/components/ui/*` | **unchanged** |

---

## Task 0: Add the React Flow dependency

**Files:** Modify `apps/web/package.json`

- [ ] **Step 1: Install the dep (Windows workaround — see CODEBASE-CONTEXT.md)**

Run from repo root:
```powershell
npm install @xyflow/react@^12.11.0 --workspace apps/web --ignore-scripts
```
Expected: `package.json` gains `"@xyflow/react": "^12.11.0"`; no postinstall failure.

- [ ] **Step 2: Verify it resolves**

Run: `node -e "require.resolve('@xyflow/react', { paths: ['C:/Project/Vello/apps/web/node_modules'] }) && console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**
```powershell
git add apps/web/package.json package-lock.json
git commit -m "build: add @xyflow/react for the clipping flow canvas"
```

---

## Task 1: Port the missing `switch` UI primitive

The prototype's inspector + run-bar import `@/components/ui/switch`, which does NOT exist in apps/web (the other 14 UI primitives do — reuse them).

**Files:** Create `apps/web/components/ui/switch.tsx`

- [ ] **Step 1: Confirm it's actually missing**

Run: `Test-Path C:\Project\Vello\apps\web\components\ui\switch.tsx`
Expected: `False`. (If `True`, skip this task entirely.)

- [ ] **Step 2: Copy the prototype file verbatim**

Copy `C:\Project\Jobtepi\vello-web\src\components\ui\switch.tsx` → `C:\Project\Vello\apps\web\components\ui\switch.tsx`. It imports `@base-ui/react/switch` (same lib, already in apps/web) and `@/lib/utils` (exists). No import rewrites needed.

- [ ] **Step 3: Typecheck**

Run: `cd C:/Project/Vello/apps/web; npx tsc --noEmit`
Expected: no new errors referencing `switch.tsx`.

- [ ] **Step 4: Commit**
```powershell
git add apps/web/components/ui/switch.tsx
git commit -m "feat(ui): port Switch primitive for clipping flow canvas"
```

---

## Task 2: Port the foundational data/types (no UI deps)

**Files:** Create `apps/web/components/builder/clipping-flow/{types/clipping.ts, data/node-catalog.ts, canvas/node-visual.ts, canvas/default-graph.ts}`

- [ ] **Step 1: Copy the four files** from `C:\Project\Jobtepi\vello-web\src\` to the matching dest paths:
  - `types/clipping.ts` → `clipping-flow/types/clipping.ts`
  - `data/node-catalog.ts` → `clipping-flow/data/node-catalog.ts`
  - `components/clipping/canvas/node-visual.ts` → `clipping-flow/canvas/node-visual.ts`
  - `components/clipping/canvas/default-graph.ts` → `clipping-flow/canvas/default-graph.ts`

- [ ] **Step 2: Apply the import-rewrite rule** to each (see table above). E.g. in `default-graph.ts`: `@/types/clipping` → `@/components/builder/clipping-flow/types/clipping`, `@/data/node-catalog` → `@/components/builder/clipping-flow/data/node-catalog`. `node-visual.ts`: `@/types/clipping` → rewritten.

- [ ] **Step 3: Typecheck**

Run: `cd C:/Project/Vello/apps/web; npx tsc --noEmit`
Expected: no errors in these four files (they only depend on each other + `@xyflow/react` types + lucide).

- [ ] **Step 4: Commit**
```powershell
git add apps/web/components/builder/clipping-flow
git commit -m "feat(clipping-flow): port node types, catalog, visuals, default graph"
```

---

## Task 3: Port the canvas + store + mock-runner

**Files:** Create `clipping-flow/canvas/{clip-node.tsx, node-types.ts, flow-canvas.tsx}`, `clipping-flow/store/clipping-store.ts`, `clipping-flow/lib/mock-runner.ts`

- [ ] **Step 1: Copy the five files** to matching dest paths under `clipping-flow/`.

- [ ] **Step 2: Apply the import-rewrite rule** to each. Verify `clip-node.tsx` keeps `@/lib/utils` unchanged; `flow-canvas.tsx` rewrites `@/store/...`, `@/data/...`, `@/types/...`, `@/components/clipping/canvas/node-types`; `clipping-store.ts` rewrites `@/types/...`, `@/components/clipping/canvas/default-graph`, `@/data/...`, `@/lib/mock-runner`.

- [ ] **Step 3: Ensure the React Flow stylesheet is imported.** Confirm `flow-canvas.tsx` has `import "@xyflow/react/dist/style.css";` at the top; if absent, add it.

- [ ] **Step 4: Typecheck**

Run: `cd C:/Project/Vello/apps/web; npx tsc --noEmit`
Expected: no errors in the ported canvas/store files.

- [ ] **Step 5: Commit**
```powershell
git add apps/web/components/builder/clipping-flow
git commit -m "feat(clipping-flow): port React Flow canvas, store, mock runner"
```

---

## Task 4: Port palette, inspector, run, and the studio wrapper (→ ClippingFlowCanvas)

**Files:** Create `clipping-flow/palette/node-palette.tsx`, `clipping-flow/inspector/inspector-panel.tsx`, `clipping-flow/run/{run-bar.tsx, output-preview.tsx}`, `clipping-flow/ClippingFlowCanvas.tsx`

- [ ] **Step 1: Copy palette/inspector/run files** to matching dest paths; apply the import-rewrite rule. These import `@/components/ui/*` (scroll-area, input, textarea, label, switch, slider, button, badge, dialog) — leave those unchanged (all now exist after Task 1).

- [ ] **Step 2: Copy `clipping-studio.tsx` → `clipping-flow/ClippingFlowCanvas.tsx`.** Rename the exported function `ClippingStudio` → `ClippingFlowCanvas`. Apply the import-rewrite rule to its 5 internal imports. Add a `mintKey: string` prop to the signature (used by Task 6 persistence):

```tsx
export function ClippingFlowCanvas({ mintKey }: { mintKey: string }) {
  // ...existing ClippingStudio body (palette | canvas+runbar | inspector + dialog)...
}
```
(Persistence wiring is added in Task 6.)

- [ ] **Step 3: Typecheck**

Run: `cd C:/Project/Vello/apps/web; npx tsc --noEmit`
Expected: no errors; `ClippingFlowCanvas` exported from `@/components/builder/clipping-flow/ClippingFlowCanvas`.

- [ ] **Step 4: Commit**
```powershell
git add apps/web/components/builder/clipping-flow
git commit -m "feat(clipping-flow): port palette, inspector, run bar, output preview + ClippingFlowCanvas wrapper"
```

---

## Task 5: Add the "flow" view mode + Flow toggle (clipping-gated)

**Files:** Modify `apps/web/app/builder/page.tsx`

- [ ] **Step 1: Extend the canvasViewMode union (L1020).** Replace:
```tsx
const [canvasViewMode, setCanvasViewMode] = useState<"workflow" | "mindmap">("workflow");
```
with:
```tsx
const [canvasViewMode, setCanvasViewMode] = useState<"workflow" | "mindmap" | "flow">("workflow");
```

- [ ] **Step 2: Add an `isClipping` const next to the agentType derivation (after L985).** Add:
```tsx
const isClipping = agentType === "clipping";
```

- [ ] **Step 3: Add the Flow toggle button (in the toggle block L4161-4181), clipping-only.** Immediately after the existing "Graph" `<button>…</button>` and before the closing `</div>` of the toggle group, insert:
```tsx
            {isClipping && (
              <button
                type="button"
                onClick={() => setCanvasViewMode("flow")}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] transition-colors ${canvasViewMode === "flow" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"}`}
                title="Flow (n8n clipping canvas)"
              >
                <Workflow className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Flow</span>
              </button>
            )}
```
(`Workflow` icon is already imported — reused from the Studio button.)

- [ ] **Step 4: Add the command-palette entry (in `spotlightActions`, L4055-4059), clipping-only.** Change the array to conditionally include the flow action:
```tsx
  const spotlightActions: SpotAction[] = useMemo(() => [
    { id: "view-studio", label: "Studio view", group: "View", icon: Workflow, run: () => setCanvasViewMode("workflow") },
    { id: "view-graph", label: "Graph view", group: "View", icon: GitBranch, run: () => setCanvasViewMode("mindmap") },
    ...(isClipping ? [{ id: "view-flow", label: "Flow view", group: "View", icon: Workflow, run: () => setCanvasViewMode("flow") } as SpotAction] : []),
    { id: "tool-mcp", label: "AI Tools & MCP", group: "Tools", icon: Plus, run: () => setIsMcpPanelOpen(true) },
  ], [isClipping]);
```
(Note: the dependency array changes from `[]` to `[isClipping]`.)

- [ ] **Step 5: Typecheck**

Run: `cd C:/Project/Vello/apps/web; npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**
```powershell
git add apps/web/app/builder/page.tsx
git commit -m "feat(builder): add clipping-gated Flow view mode + toggle"
```

---

## Task 6: Render ClippingFlowCanvas + localStorage persistence

**Files:** Create `clipping-flow/lib/clipGraphStorage.ts` + `clipGraphStorage.test.ts`; modify `clipping-flow/store/clipping-store.ts`, `clipping-flow/ClippingFlowCanvas.tsx`, `apps/web/app/builder/page.tsx`

- [ ] **Step 1: Write the failing storage test.** Create `clipping-flow/lib/clipGraphStorage.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { saveGraph, loadGraph, graphKey } from "./clipGraphStorage";

describe("clipGraphStorage", () => {
  beforeEach(() => localStorage.clear());

  it("namespaces the key by mint", () => {
    expect(graphKey("abc")).toBe("vello-clipgraph:abc");
  });

  it("returns null when nothing saved", () => {
    expect(loadGraph("abc")).toBeNull();
  });

  it("round-trips nodes and edges", () => {
    const graph = { nodes: [{ id: "n1" }] as any, edges: [{ id: "e1" }] as any };
    saveGraph("abc", graph);
    expect(loadGraph("abc")).toEqual(graph);
  });

  it("isolates graphs per mint", () => {
    saveGraph("a", { nodes: [{ id: "x" }] as any, edges: [] });
    expect(loadGraph("b")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — verify it fails.**

Run: `cd C:/Project/Vello/apps/web; npx vitest run components/builder/clipping-flow/lib/clipGraphStorage.test.ts`
Expected: FAIL (`Cannot find module './clipGraphStorage'`).

- [ ] **Step 3: Implement `clipGraphStorage.ts`:**
```ts
import type { VelloNode, VelloEdge } from "@/components/builder/clipping-flow/types/clipping";

export interface StoredGraph { nodes: VelloNode[]; edges: VelloEdge[]; }

export const graphKey = (mintKey: string) => `vello-clipgraph:${mintKey}`;

export function saveGraph(mintKey: string, graph: StoredGraph): void {
  try { localStorage.setItem(graphKey(mintKey), JSON.stringify(graph)); } catch { /* quota / SSR — ignore */ }
}

export function loadGraph(mintKey: string): StoredGraph | null {
  try {
    const raw = localStorage.getItem(graphKey(mintKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return parsed as StoredGraph;
  } catch { return null; }
}
```

- [ ] **Step 4: Run the test — verify it passes.**

Run: `cd C:/Project/Vello/apps/web; npx vitest run components/builder/clipping-flow/lib/clipGraphStorage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add a `loadGraph` action to the store.** In `clipping-flow/store/clipping-store.ts`, add to the `ClippingState` interface: `loadGraph: (nodes: VelloNode[], edges: VelloEdge[]) => void;` and to the implementation:
```ts
  loadGraph: (nodes, edges) =>
    set({ nodes, edges, selectedId: null, previewId: null, runStatus: "idle" }),
```

- [ ] **Step 6: Wire persistence into `ClippingFlowCanvas.tsx`.** Add imports and two effects inside the component (before the return):
```tsx
import { useEffect, useRef } from "react";
import { useClippingStore } from "@/components/builder/clipping-flow/store/clipping-store";
import { saveGraph, loadGraph } from "@/components/builder/clipping-flow/lib/clipGraphStorage";
// ...
  const nodes = useClippingStore((s) => s.nodes);
  const edges = useClippingStore((s) => s.edges);
  const loadGraphAction = useClippingStore((s) => s.loadGraph);
  const hydrated = useRef(false);

  // Load this agent's saved graph once on mount / when the agent changes.
  useEffect(() => {
    hydrated.current = false;
    const saved = loadGraph(mintKey);
    if (saved) loadGraphAction(saved.nodes, saved.edges);
    hydrated.current = true;
  }, [mintKey, loadGraphAction]);

  // Persist edits (debounced) once hydrated.
  useEffect(() => {
    if (!hydrated.current) return;
    const t = setTimeout(() => saveGraph(mintKey, { nodes, edges }), 400);
    return () => clearTimeout(t);
  }, [mintKey, nodes, edges]);
```

- [ ] **Step 7: Render the canvas in the builder.** In `app/builder/page.tsx`, find the render switch (L4613-4787) `{canvasViewMode === "workflow" ? (<AgentWorkspace …/>) : (<MindmapCanvas …/>)}` and wrap it so flow takes precedence for clipping. Add `ClippingFlowCanvas` import at the top (`import { ClippingFlowCanvas } from "@/components/builder/clipping-flow/ClippingFlowCanvas";`), define the key just above the switch:
```tsx
const flowMintKey = agentBlueprint?.mintAddress || resumeMintAddress || sessionIdRef.current || "draft";
```
and change the switch to:
```tsx
{canvasViewMode === "flow" && isClipping ? (
  <ClippingFlowCanvas mintKey={flowMintKey} />
) : canvasViewMode === "workflow" ? (
  <AgentWorkspace /* …existing props unchanged… */ />
) : (
  <MindmapCanvas /* …existing props unchanged… */ />
)}
```

- [ ] **Step 8: Typecheck + test.**

Run: `cd C:/Project/Vello/apps/web; npx tsc --noEmit; npx vitest run components/builder/clipping-flow`
Expected: no type errors; storage tests pass.

- [ ] **Step 9: Commit**
```powershell
git add apps/web/components/builder/clipping-flow apps/web/app/builder/page.tsx
git commit -m "feat(clipping-flow): render Flow canvas in builder + localStorage persistence per agent"
```

---

## Task 7: Re-skin to the builder's cream/neobrutalist theme

The prototype is dark-violet; the builder shell is cream/neobrutalist (`.nb-body` beige `#ece5d6`, `.nb-card` cream `#fffdf7` + 2px `#1c1c1f` border + 4px offset shadow). Restyle the canvas to match.

**Files:** Create `clipping-flow/clipping-flow.css`; modify `clipping-flow/ClippingFlowCanvas.tsx`

- [ ] **Step 1: Create `clipping-flow/clipping-flow.css`** scoping node-accent CSS vars + the React Flow surface to the builder palette:
```css
.clipping-flow-root {
  /* node accent vars consumed by node-visual.ts / clip-node.tsx */
  --node-source: #4d7c0f;   /* lime-700 */
  --node-compose: #7c3aed;  /* violet-600 */
  --node-skill: #1c1c1f;    /* ink */
  --node-publish: #0ea5e9;  /* sky-500 */
  background: #ece5d6;      /* nb-body beige */
  height: 100%;
}
.clipping-flow-root .react-flow__background { background: #ece5d6; }
.clipping-flow-root .react-flow__node { color: #1c1c1f; }
.clipping-flow-root .react-flow__controls,
.clipping-flow-root .react-flow__minimap { border: 2px solid #1c1c1f; border-radius: 8px; overflow: hidden; }
.clipping-flow-root .react-flow__edge-path { stroke: #1c1c1f; stroke-width: 1.5; }
```
(If the prototype uses different var names than `--node-source/compose/skill/publish`, match the names actually read in `node-visual.ts` — confirm by reading it.)

- [ ] **Step 2: Apply the scope class + import the CSS in `ClippingFlowCanvas.tsx`.** Add `import "@/components/builder/clipping-flow/clipping-flow.css";` and wrap the top-level layout element with `className="clipping-flow-root ..."` (merge with the existing root className via `cn`).

- [ ] **Step 3: Manual visual check.**

Run: `npm run dev:https --workspace apps/web` → open https://localhost:3000 → Build → AI Clippers → submit a prompt → in the builder, click the **Flow** toggle. Expected: canvas renders on the cream background, nodes show colored accents, readable on light theme (no dark-on-dark).

- [ ] **Step 4: Commit**
```powershell
git add apps/web/components/builder/clipping-flow
git commit -m "style(clipping-flow): re-skin canvas to builder cream/neobrutalist theme"
```

---

## Task 8: End-to-end manual verification + isolation check

**Files:** none (verification only)

- [ ] **Step 1: Full manual pass.** With `npm run dev:https` running, in a clipping builder:
  - Toggle **Flow** → canvas shows the default graph (Source → Compose → {Captions, B-roll, Crop} → Publish).
  - Drag a node from the **palette** onto the canvas → it appears.
  - Drag-connect two nodes → an edge is created.
  - Select a node → the **inspector** shows its config; edit a field → it updates.
  - Click **Run** → nodes animate through statuses (mock-runner); **OutputPreview** opens on the publish node.
  - Reload the page → the edited graph is restored (localStorage).

- [ ] **Step 2: Isolation check (no regressions).**
  - In the same clipping builder, toggle **Studio** and **Graph** → both still render as before.
  - Open an **influencer** builder (`/builder?type=influencer`) → the **Flow** toggle is **absent**; Studio/Graph work normally.

- [ ] **Step 3: Typecheck + full test run.**

Run: `cd C:/Project/Vello/apps/web; npx tsc --noEmit; npx vitest run components/builder/clipping-flow`
Expected: clean.

- [ ] **Step 4: Final commit (if any fixes were needed during verification).**
```powershell
git add -A apps/web/components/builder/clipping-flow apps/web/app/builder/page.tsx
git commit -m "fix(clipping-flow): verification follow-ups"
```

---

## Out of scope (HELD — do NOT implement)
- Convex `clipGraphs` table / save-load mutations (localStorage stands in for now).
- Compiling the graph → `ClipConfig` / writing `agent.clipConfig`.
- Real `clip_source` enqueue, `clipJobs`/`clips` reactive status, real `OutputPreview` data.
- Any Convex schema, API route, or other backend change.
- Merging to `main` (await user sign-off).

## Self-review (run against the spec)
- **Spec coverage:** §3.1 placement → Task 5/6; §3.2 ported components → Tasks 1–4; §3.3 node model → Task 2 (ported verbatim); §3.4 frontend persistence → Task 6; §3.5 + §4 execution → mock only (backend HELD, Task scope note); §5 port mechanics (deps, import rewrites, theme) → Task 0, rewrite table, Task 7; §6 phase 1 → all tasks; §7 testing → Tasks 6 (unit) + 8 (manual). No spec requirement left without a task.
- **Placeholder scan:** none — every code/command step has concrete content; ported files use copy + the explicit rewrite table.
- **Type consistency:** `ClippingFlowCanvas({ mintKey })` defined in Task 4 and consumed in Task 6 Step 7; `loadGraph` store action defined in Task 6 Step 5 and used in Step 6; `StoredGraph`/`graphKey`/`saveGraph`/`loadGraph` consistent across Task 6.
- **Correction vs spec:** dropped `sonner` (no ported component imports it — verified); spec §5 listed it speculatively.
