"use client";

import { create } from "zustand";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import type {
  VelloNode,
  VelloEdge,
  NodeKind,
  NodeStatus,
  NodeOutput,
  NodeConfig,
} from "@/components/builder/clipping-flow/types/clipping";
import { CATALOG_BY_KEY, type CatalogKey } from "@/components/builder/clipping-flow/data/node-catalog";
import { runGraph } from "@/components/builder/clipping-flow/lib/mock-runner";
import { categoryForSkill, type ClipSkillCategory } from "@/lib/builder/clipSkillsCatalog";

export type RunStatus = "idle" | "running" | "done" | "error";

/**
 * Canvas operations the builder chat can request (canvas_* agentActions).
 * Queued here because the canvas may not be mounted when the chat dispatches -
 * ClippingFlowCanvas drains the queue after it hydrates.
 */
export type ClipChatOp =
  | { op: "set_source"; sourceUrl: string }
  // Stage content-reward handoff: seed the Source node from a Supabase
  // content_reward (videos resolved by /api/clip/campaign-sources). Tags the
  // Source with contentRewardId so the cloud run sets it on the clip job
  // (Supabase auto-submit) and transcribe caches it. videos[0] fills sourceUrl;
  // the full list rides on rewardVideos for the inspector swap-picker.
  | { op: "seed_reward_source"; contentRewardId: string; title: string; videos: { url: string; name: string }[] }
  | { op: "set_clip_length"; min?: number; max?: number }
  | { op: "set_max_clips"; count: number }
  // Output aspect: sets the Aspect Crop node's ratio (adding the node if missing).
  | { op: "set_aspect"; ratio: "9:16" | "16:9" | "1:1" | "4:5" }
  | { op: "set_auto_plan"; enabled: boolean }
  | { op: "set_watermark"; enabled: boolean }
  | { op: "set_genre"; genre: string }
  | { op: "set_caption_preset"; preset: string }
  | { op: "set_editor_skill"; skillId: string; config: Record<string, unknown> }
  // Editor tab → drop a marketplace skill node (every node with that skillId) so a
  // toggle switched OFF in the Editor (e.g. Specials · Zoom Punch) can't still fire
  // from a node left over on the Clipping canvas.
  | { op: "remove_skill"; skillId: string }
  // Prompt-to-Clip: wires the operator's free-text brief into the clip.prompt
  // skill node (adding it if missing) so moment selection is actually steered
  // by the prompt (lib/server/promptSelect.ts), not just count/genre.
  | { op: "set_prompt_to_clip"; prompt: string }
  | { op: "add_node"; key: CatalogKey }
  | { op: "add_skill"; skillId: string }
  | { op: "remove_node"; title: string }
  | { op: "connect"; from: string; to: string }
  | { op: "apply_template"; templateId: string }
  | { op: "tidy" }
  | { op: "run" };

// Ephemeral module-level counter for locally-unique node IDs (mock UI only).
let nodeSeq = 100;

/**
 * Mint a node id that is GUARANTEED unique against the nodes currently in the
 * store. A plain `${prefix}-${nodeSeq++}` is NOT safe: nodeSeq resets to 100 on
 * every module load, but a saved graph hydrated via loadGraph reuses ids like
 * `skill-100`. Without this check the next added node collides with a hydrated
 * one, and `nodes.find(id)` returns the OLDER node - so selecting the new node
 * opens the wrong skill's inspector (e.g. "added Captions, shows Zoom Punch").
 * Looping past any collision makes id reuse impossible regardless of hydration.
 */
function mintId(get: () => ClippingState, prefix: string): string {
  const used = new Set(get().nodes.map((n) => n.id));
  let id = `${prefix}-${nodeSeq++}`;
  while (used.has(id)) id = `${prefix}-${nodeSeq++}`;
  return id;
}
// Tracks an in-progress node drag so we snapshot undo history once per drag,
// not once per moved pixel.
let dragging = false;

// Horizontal layer spacing - shared between Compose auto-placement and Tidy.
// Roomy enough that the taller image-on-top cards never crowd their neighbours.
const COL = 380;

type Snapshot = { nodes: VelloNode[]; edges: VelloEdge[] };
const HISTORY_LIMIT = 60;

/**
 * Compose is the default skill hub: new skills attach to it. Returns the id of
 * the existing Compose node, or MINTS one if missing - positioning it between
 * the Source and Publish, pushing it to `nodes`, and wiring Source->Compose
 * (and Compose->Publish if a Publish node exists).
 *
 * Caller is responsible for the runStatus guard + pushHistory (matching the
 * other mutators) BEFORE invoking this - the helper just mutates nodes/edges.
 * It `set`s the new Compose into state so the caller's subsequent
 * `get().nodes` / `get().edges` reads pick it up.
 *
 * Always returns a Compose id (mints unconditionally - anchored to the Source
 * if one exists, else at origin). The nullable return type lets callers keep a
 * `?? source` fallback for defensiveness even though it's never hit today.
 */
function ensureComposeId(
  get: () => ClippingState,
  set: (partial: Partial<ClippingState>) => void
): string | null {
  const existing = get().nodes.find((n) => n.data.kind === "compose");
  if (existing) return existing.id;

  const source = get().nodes.find((n) => n.data.kind === "source");
  const id = mintId(get, "compose");
  const sx = source?.position.x ?? 0;
  const sy = source?.position.y ?? 0;
  const node: VelloNode = {
    id,
    type: "compose",
    position: { x: sx + COL, y: sy },
    data: {
      kind: "compose",
      title: CATALOG_BY_KEY.compose.title,
      status: "idle",
      config: CATALOG_BY_KEY.compose.makeConfig(),
    },
  };

  const publish = get().nodes.find((n) => n.data.kind === "publish");
  const newEdges: VelloEdge[] = [];
  if (source) {
    newEdges.push({ id: `${source.id}->${id}`, source: source.id, target: id, type: "smoothstep" });
  }
  if (publish) {
    newEdges.push({ id: `${id}->${publish.id}`, source: id, target: publish.id, type: "smoothstep" });
  }

  set({
    nodes: [...get().nodes, node],
    edges: [...get().edges, ...newEdges],
  });
  return id;
}

/**
 * The marketplace skill of `category` currently wired to Compose, if any.
 * Backs the one-skill-per-category constraint: only one node per the 7
 * `CLIP_SKILL_CATEGORIES` (Captions, Hooks & Openers, …) may be present.
 * Returns undefined when there's no category (unmapped skill → no constraint)
 * or no conflicting node.
 */
function sameCategorySkill(
  get: () => ClippingState,
  category: ClipSkillCategory | undefined
): VelloNode | undefined {
  if (!category) return undefined;
  return get().nodes.find(
    (n) =>
      n.data.kind === "skill" &&
      (n.data.config as { variant?: string }).variant === "marketplace" &&
      categoryForSkill((n.data.config as { skillId?: string }).skillId ?? "") === category
  );
}

interface ClippingState {
  nodes: VelloNode[];
  edges: VelloEdge[];
  selectedId: string | null;
  previewId: string | null;
  runStatus: RunStatus;
  chaos: boolean;
  /** True while a Source node's file upload is in flight - the Run button stays
      disabled until the upload finishes (you can't run a half-uploaded source). */
  sourceUploading: boolean;
  /** Installed clipping skills available to drop on the canvas (from the Library). */
  availableSkills: { skillId: string; name: string; icon: string; instructions: string }[];
  /** Canvas ops queued by the builder chat, drained by the mounted canvas. */
  pendingChatOps: ClipChatOp[];
  /** Live pipeline progress shown in the run bar (null when not running). */
  runProgress: { pct: number; label: string } | null;
  runError: string | null;
  runJobId: string | null;
  runMode: "cloud" | "local" | null;
  runClips: { id: string; title: string; status: string; failReason?: string }[];
  /** Timestamped step log for the current/last run (shown under the run bar). */
  runLog: { ts: number; line: string }[];
  /** Set when the Publish node wants drip-posting: the preview dialog shows
      reorder controls + a "Start drip" button that queues clips in the shown
      order. null = download-only run. */
  dripContext: {
    mintAddress?: string; sessionId?: string; platform: string; caption: string; mintKey: string;
    /** Channels to post to (Publish node). EMPTY = all connected. `platform` is
     *  kept for the campaign-submit single-platform path + display. */
    platforms?: string[];
    /** Post spacing (ms) + daily cap from the persisted clipConfig (Posting tab
     *  sliders). Threaded so the manual DripBar shares computeScheduleTimes with
     *  the canvas auto-scheduler and the two paths can't drift. Optional - a drip
     *  armed before these were set falls back to DRIP_STAGGER_MS / no cap. */
    postIntervalMs?: number; maxPerDay?: number;
    /** Publish order + optional daily start time from the persisted clipConfig,
     *  threaded so DripBar matches the canvas auto-scheduler. */
    postOrder?: "best" | "newest" | "oldest" | "random";
    dailyStartHour?: number; dailyStartMinute?: number;
    /** Scheduling timezone (clipConfig.timezone) - DripBar passes this into
     *  computeScheduleTimes so its day-bucketing matches the canvas + calendar. */
    timezone?: string;
    /** Campaign Hunter: Scout's top eligible match - drip posts auto-submit to it. */
    campaign?: { campaignId: string; title: string; platforms: string[] };
  } | null;
  /** Storage key of the graph currently in the store. The canvas skips
      re-hydration when remounting for the same agent (tab switches) so a
      live run's state/lock/progress aren't clobbered. */
  hydratedKey: string | null;
  /** Transient banner shown by the canvas (toast substitute, no dependency):
      set on one-skill-per-category swap/reject; auto-cleared by the canvas. */
  skillNotice: string | null;
  /** Editor tab's "Save clip settings" writes here the moment the operator
   *  saves — BEFORE the Clipping canvas (which owns the real source node) has
   *  necessarily ever mounted to drain the queued `set_max_clips` op. The Editor
   *  tab's top "Clip (N clips)" button reads this AHEAD of the node's own
   *  config so the count updates instantly on save, not only after a visit to
   *  the Clipping tab. Cleared once the canvas actually drains the op onto the
   *  real node, so a later direct edit on the canvas is never shadowed by a
   *  stale draft. */
  draftMaxClips: number | null;
  /** Chat copilot → Clipping (editor) tab handoff. `sourceUrl` = download this
   *  video into the editor's Videos list; `upload` = open the file picker so
   *  the operator clips their own file. `nonce` makes a repeat request fire. */
  editorIntake: { sourceUrl?: string; upload?: boolean; asset?: { url: string; name: string; kind: "video" | "image" | "audio" }; nonce: number } | null;
  past: Snapshot[];
  future: Snapshot[];

  onNodesChange: (changes: NodeChange<VelloNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<VelloEdge>[]) => void;
  onConnect: (c: Connection) => void;

  setSelected: (id: string | null) => void;
  setPreview: (id: string | null) => void;
  setChaos: (v: boolean) => void;

  addNodeFromCatalog: (key: CatalogKey, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  addConnectedNode: (parentId: string, key: CatalogKey) => void;
  addConnectedSkill: (parentId: string, skill: { skillId: string; name: string }) => void;
  addSkillNodeAt: (skill: { skillId: string; name: string }, position: { x: number; y: number }, opts?: { allowSameCategory?: boolean }) => void;
  setAvailableSkills: (skills: { skillId: string; name: string; icon: string; instructions: string }[]) => void;
  queueChatOps: (ops: ClipChatOp[]) => void;
  takeChatOps: () => ClipChatOp[];
  setRunProgress: (p: { pct: number; label: string } | null) => void;
  setSourceUploading: (v: boolean) => void;
  appendRunLog: (line: string) => void;
  setDripContext: (c: ClippingState["dripContext"]) => void;
  setSkillNotice: (msg: string | null) => void;
  setDraftMaxClips: (count: number | null) => void;
  setEditorIntake: (intake: { sourceUrl?: string; upload?: boolean; asset?: { url: string; name: string; kind: "video" | "image" | "audio" } } | null) => void;
  updateNodeConfig: (id: string, patch: Partial<NodeConfig>) => void;

  setNodeStatus: (
    id: string,
    status: NodeStatus,
    extra?: { output?: NodeOutput; error?: string }
  ) => void;
  resetRun: () => void;
  startRun: () => Promise<void>;
  loadGraph: (nodes: VelloNode[], edges: VelloEdge[], key?: string) => void;
  tidyLayout: () => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
}

export const useClippingStore = create<ClippingState>((set, get) => ({
  // The canvas starts EMPTY - operators build their pipeline from the palette
  // (saved graphs hydrate over this on mount). The old pre-wired demo graph
  // seeded legacy stub nodes that shadowed the real marketplace skills.
  nodes: [],
  edges: [],
  selectedId: null,
  previewId: null,
  runStatus: "idle",
  chaos: false,
  sourceUploading: false,
  availableSkills: [],
  pendingChatOps: [],
  runProgress: null,
  runError: null,
  runJobId: null,
  runMode: null,
  runClips: [],
  runLog: [],
  dripContext: null,
  hydratedKey: null,
  skillNotice: null,
  draftMaxClips: null,
  editorIntake: null,
  past: [],
  future: [],

  // Capture the CURRENT graph as an undo point and clear the redo stack.
  pushHistory: () =>
    set((s) => ({
      past: [...s.past, { nodes: s.nodes, edges: s.edges }].slice(-HISTORY_LIMIT),
      future: [],
    })),

  onNodesChange: (changes) => {
    // Graph is locked while a pipeline runs - allow selection, block edits.
    const editable = get().runStatus !== "running"
      ? changes
      : changes.filter((c) => c.type !== "remove" && c.type !== "position");
    const startDrag = !dragging && editable.some((c) => c.type === "position" && c.dragging);
    const endDrag = editable.some((c) => c.type === "position" && c.dragging === false);
    const removedIds = new Set(
      editable.filter((c): c is Extract<NodeChange<VelloNode>, { type: "remove" }> => c.type === "remove").map((c) => c.id),
    );
    if (startDrag) { dragging = true; get().pushHistory(); }
    if (endDrag) dragging = false;
    if (removedIds.size > 0) get().pushHistory();
    const nextNodes = applyNodeChanges(editable, get().nodes);
    if (removedIds.size === 0) {
      set({ nodes: nextNodes });
      return;
    }
    // A ReactFlow node removal (Delete key / node menu) MUST also drop the wires
    // attached to it and clear any selection/preview pointing at it — otherwise the
    // canvas keeps dangling edges and the inspector keeps rendering the DELETED
    // node's config until another node is added (the "stale old skills" bug).
    // Mirrors removeNode's cleanup so both delete paths behave identically.
    const sel = get().selectedId;
    const prev = get().previewId;
    set({
      nodes: nextNodes,
      edges: get().edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target)),
      ...(sel && removedIds.has(sel) ? { selectedId: null } : {}),
      ...(prev && removedIds.has(prev) ? { previewId: null } : {}),
    });
  },
  onEdgesChange: (changes) => {
    const editable = get().runStatus !== "running"
      ? changes
      : changes.filter((c) => c.type !== "remove");
    if (editable.some((c) => c.type === "remove")) get().pushHistory();
    set({ edges: applyEdgeChanges(editable, get().edges) });
  },
  onConnect: (c) => {
    if (get().runStatus === "running") return;
    // One-skill-per-category: REJECT (don't auto-delete the user's node) when
    // manually wiring a marketplace skill whose category already has a wired
    // skill. The destructive REPLACE lives only on the additive add-skill
    // paths (where intent is unambiguous); here a soft reject is less
    // surprising than silently removing a node the user placed.
    const endpointSkill = get().nodes.find(
      (n) =>
        (n.id === c.source || n.id === c.target) &&
        n.data.kind === "skill" &&
        (n.data.config as { variant?: string }).variant === "marketplace"
    );
    if (endpointSkill) {
      const skillId = (endpointSkill.data.config as { skillId?: string }).skillId ?? "";
      const category = categoryForSkill(skillId);
      const conflict = sameCategorySkill(get, category);
      if (conflict && conflict.id !== endpointSkill.id) {
        set({ skillNotice: `Already have a ${category} skill wired - remove it first` });
        return;
      }
    }
    get().pushHistory();
    set({ edges: addEdge({ ...c, type: "smoothstep" }, get().edges) });
  },

  setSelected: (id) => set({ selectedId: id }),
  setPreview: (id) => set({ previewId: id }),
  setChaos: (v) => set({ chaos: v }),

  addNodeFromCatalog: (key, position) => {
    if (get().runStatus === "running") return;
    const item = CATALOG_BY_KEY[key];
    // Unknown / retired catalog key (e.g. the old built-in "captions" node, now
    // superseded by the Dynamic Captions marketplace skill, or a hallucinated key
    // from the chat op stream). Drop it instead of throwing.
    if (!item) return;
    const has = (sourceId: string, targetId: string) =>
      get().edges.some((e) => e.source === sourceId && e.target === targetId);
    // Compose AND Publish are singletons: the pipeline has exactly one skill hub
    // and one terminal publisher. Adding a second from the palette would mint a
    // stranded/ambiguous duplicate (which is why two Publish cards could appear),
    // so just focus the existing one instead of creating another.
    if (item.kind === "compose" || item.kind === "publish") {
      const existing = get().nodes.find((n) => n.data.kind === item.kind);
      if (existing) {
        set({ selectedId: existing.id });
        return;
      }
    }
    get().pushHistory();
    const id = mintId(get, key);
    const node: VelloNode = {
      id,
      type: item.kind,
      position,
      data: {
        kind: item.kind,
        title: item.title,
        status: "idle",
        config: item.makeConfig(),
      },
    };
    // Auto-wire the new node into the Compose hub where it makes sense, never
    // duplicating an edge that already exists.
    const newEdges: VelloEdge[] = [];
    if (item.kind === "publish") {
      // A Publish node closes the pipeline: wire any existing Compose to it.
      const compose = get().nodes.find((n) => n.data.kind === "compose");
      if (compose && !has(compose.id, id)) {
        newEdges.push({ id: `${compose.id}->${id}`, source: compose.id, target: id, type: "smoothstep" });
      }
    } else if (item.kind === "compose") {
      // A manually-added Compose hub: wire Source->Compose and, if present,
      // Compose->Publish.
      const source = get().nodes.find((n) => n.data.kind === "source");
      if (source && !has(source.id, id)) {
        newEdges.push({ id: `${source.id}->${id}`, source: source.id, target: id, type: "smoothstep" });
      }
      const publish = get().nodes.find((n) => n.data.kind === "publish");
      if (publish && !has(id, publish.id)) {
        newEdges.push({ id: `${id}->${publish.id}`, source: id, target: publish.id, type: "smoothstep" });
      }
    } else if (item.kind === "source") {
      // A Source added AFTER a Compose hub (or deleted+re-added) can leave the
      // Compose+skills unreachable from any Source - reachableFromSource then
      // silently drops every skill at run. Wire this new Source into a Compose
      // that has no incoming source edge so the hub rejoins the pipeline.
      const compose = get().nodes.find((n) => n.data.kind === "compose");
      if (compose) {
        const hasIncomingSource = get().edges.some(
          (e) =>
            e.target === compose.id &&
            get().nodes.find((n) => n.id === e.source)?.data.kind === "source"
        );
        if (!hasIncomingSource && !has(id, compose.id)) {
          newEdges.push({ id: `${id}->${compose.id}`, source: id, target: compose.id, type: "smoothstep" });
        }
      }
    } else if (item.kind === "skill") {
      // A skill runs only when reachable from a Source THROUGH the Compose hub, so
      // wire this new skill under Compose (created if missing) — same auto-attach as
      // a marketplace skill, so a palette-added Captions/Crop lands CONNECTED, not
      // free-floating. Right-side handle keeps the wire horizontal.
      const composeId = ensureComposeId(get, set);
      if (composeId && !has(composeId, id)) {
        newEdges.push({ id: `${composeId}->${id}`, source: composeId, target: id, sourceHandle: null, type: "smoothstep" });
      }
    }
    set({
      nodes: [...get().nodes, node],
      edges: newEdges.length ? [...get().edges, ...newEdges] : get().edges,
      selectedId: id,
    });
  },

  removeNode: (id) => {
    if (get().runStatus === "running") return;
    get().pushHistory();
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
    });
  },

  removeEdge: (id) => {
    if (get().runStatus === "running") return;
    get().pushHistory();
    set({ edges: get().edges.filter((e) => e.id !== id) });
  },

  // Add a node from the catalog already wired downstream of `parentId` (used by
  // the inspector's "Add skill" button).
  addConnectedNode: (parentId, key) => {
    if (get().runStatus === "running") return;
    const item = CATALOG_BY_KEY[key];
    if (!item) return; // unknown / retired catalog key - drop instead of throwing
    get().pushHistory();
    const parent = get().nodes.find((n) => n.id === parentId);
    const px = parent?.position.x ?? 0;
    const py = parent?.position.y ?? 0;
    const id = mintId(get, key);
    const node: VelloNode = {
      id,
      type: item.kind,
      position: { x: px + COL, y: py + 90 },
      data: { kind: item.kind, title: item.title, status: "idle", config: item.makeConfig() },
    };
    set({
      nodes: [...get().nodes, node],
      edges: [...get().edges, { id: `${parentId}->${id}`, source: parentId, target: id, type: "smoothstep" }],
      selectedId: id,
    });
  },

  // Add an installed marketplace clipping skill as a node (used by the
  // inspector's "Add skill" menu, driven by the Library). Wired downstream of
  // the COMPOSE hub (created if missing) - Compose is the default skill hub.
  // Falls back to the passed `parentId` only when Compose can't be minted.
  addConnectedSkill: (parentId, skill) => {
    if (get().runStatus === "running") return;
    // One node per skillId: cloud sync stores ONE config per skillId, so a second
    // same-skill node renders differently on cloud (last-wins) than on the canvas
    // (all-applied). Select the existing node instead of creating a divergent dup.
    const dup = get().nodes.find((n) => n.data.kind === "skill" && (n.data.config as { skillId?: string }).skillId === skill.skillId);
    if (dup) { set({ selectedId: dup.id }); return; }
    // One skill per category: REJECT the add (keep the existing node - never
    // silently delete the operator's work) with a clear message. Checked BEFORE
    // minting Compose / pushing history so a rejected add has zero side effects.
    const category = categoryForSkill(skill.skillId);
    const conflict = sameCategorySkill(get, category);
    if (conflict) {
      set({ selectedId: conflict.id, skillNotice: `Only one ${category} skill allowed - remove ${conflict.data.title} first` });
      return;
    }
    get().pushHistory();
    const composeId = ensureComposeId(get, set);
    const attachTo = composeId ?? parentId;
    const compose = get().nodes.find((n) => n.id === attachTo);
    const cx = compose?.position.x ?? 0;
    const cy = compose?.position.y ?? 0;
    const id = mintId(get, "skill");
    const node: VelloNode = {
      id,
      type: "skill",
      // Drop below the hub; Tidy re-fans skills above/below.
      position: { x: cx, y: cy + 240 },
      data: {
        kind: "skill",
        title: skill.name,
        status: "idle",
        config: { variant: "marketplace", skillId: skill.skillId, skillName: skill.name, ...(skill.skillId === "clip.trendingaudio" ? { autoMusic: true } : {}) } as NodeConfig,
      },
    };
    set({
      nodes: [...get().nodes, node],
      edges: [...get().edges, { id: `${attachTo}->${id}`, source: attachTo, target: id, sourceHandle: null, type: "smoothstep" }],
      selectedId: id,
    });
  },

  // Drop an installed marketplace clipping skill onto the canvas (palette drag
  // / chat add_skill). Auto-wired downstream of the COMPOSE hub (created if
  // missing): run participation is connectivity-based, so a free-floating node
  // would be silently ignored by the pipeline.
  addSkillNodeAt: (skill, position, opts) => {
    if (get().runStatus === "running") return;
    // One node per skillId (see addConnectedSkill) - select the existing node
    // instead of dropping a divergent duplicate.
    const dup = get().nodes.find((n) => n.data.kind === "skill" && (n.data.config as { skillId?: string }).skillId === skill.skillId);
    if (dup) { set({ selectedId: dup.id }); return; }
    // One skill per category: REJECT the add (keep the existing node) with a
    // clear message - checked BEFORE minting Compose / pushing history.
    // allowSameCategory: the Editor tab owns these toggles explicitly (Zoom Punch +
    // a Filter share "Overlays & Emphasis"), so its adds must never be rejected.
    const category = categoryForSkill(skill.skillId);
    const conflict = opts?.allowSameCategory ? undefined : sameCategorySkill(get, category);
    if (conflict) {
      set({ selectedId: conflict.id, skillNotice: `Only one ${category} skill allowed - remove ${conflict.data.title} first` });
      return;
    }
    get().pushHistory();
    const id = mintId(get, "skill");
    const node: VelloNode = {
      id,
      type: "skill",
      position,
      data: {
        kind: "skill",
        title: skill.name,
        status: "idle",
        config: { variant: "marketplace", skillId: skill.skillId, skillName: skill.name, ...(skill.skillId === "clip.trendingaudio" ? { autoMusic: true } : {}) } as NodeConfig,
      },
    };
    // Attach to Compose (create-if-missing). Fall back to a bare Source wire
    // only when Compose can't be minted but a Source exists.
    const composeId = ensureComposeId(get, set);
    const source = get().nodes.find((n) => n.data.kind === "source");
    const parentId = composeId ?? source?.id ?? null;
    set({
      nodes: [...get().nodes, node],
      edges: parentId
        ? [...get().edges, { id: `${parentId}->${id}`, source: parentId, target: id, sourceHandle: null, type: "smoothstep" }]
        : get().edges,
      selectedId: id,
    });
  },

  setAvailableSkills: (skills) => set({ availableSkills: skills }),

  setRunProgress: (p) => set({ runProgress: p }),
  setSourceUploading: (v) => set({ sourceUploading: v }),

  appendRunLog: (line) =>
    set((s) => ({ runLog: [...s.runLog, { ts: Date.now(), line }].slice(-200) })),

  setDripContext: (c) => set({ dripContext: c }),
  setSkillNotice: (msg) => set({ skillNotice: msg }),
  setDraftMaxClips: (count) => set({ draftMaxClips: count }),
  setEditorIntake: (intake) => set({ editorIntake: intake ? { ...intake, nonce: Date.now() } : null }),

  queueChatOps: (ops) => set((s) => ({ pendingChatOps: [...s.pendingChatOps, ...ops] })),
  takeChatOps: () => {
    const ops = get().pendingChatOps;
    if (ops.length) set({ pendingChatOps: [] });
    return ops;
  },

  updateNodeConfig: (id, patch) => {
    if (get().runStatus === "running") return;
    get().pushHistory();
    set({
      nodes: get().nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                config: { ...n.data.config, ...patch } as NodeConfig,
              },
            }
          : n
      ),
    });
  },

  setNodeStatus: (id, status, extra) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                status,
                output:
                  extra?.output ??
                  (status === "idle" || status === "running"
                    ? undefined
                    : n.data.output),
                error: extra?.error,
              },
            }
          : n
      ),
    }),

  resetRun: () =>
    set({
      runStatus: "idle",
      runProgress: null,
      runError: null,
      runJobId: null,
      runMode: null,
      runClips: [],
      runLog: [],
      dripContext: null,
      previewId: null,
      nodes: get().nodes.map((n) => ({
        ...n,
        data: { ...n.data, status: "idle", output: undefined, error: undefined },
      })),
      edges: get().edges.map((e) => ({ ...e, animated: false })),
    }),

  startRun: async () => {
    get().resetRun();
    set({ runStatus: "running" });
    const ok = await runGraph(get().nodes, get().edges, get().chaos, {
      setStatus: (id, status, extra) => get().setNodeStatus(id, status, extra),
      animateEdge: (id, on) =>
        set({
          edges: get().edges.map((e) =>
            e.id === id ? { ...e, animated: on } : e
          ),
        }),
    });
    set({ runStatus: ok ? "done" : "error" });
    if (ok) {
      const publish = get().nodes.find((n) => n.data.kind === "publish");
      if (publish) set({ previewId: publish.id });
    }
  },

  // A fresh graph load (e.g. switching agents) resets the undo history.
  loadGraph: (nodes, edges, key) => {
    // Guarantee UNIQUE node ids and singleton compose/publish. A graph saved by an
    // older build could carry two nodes sharing an id (the id-collision bug — the
    // inspector then opened the WRONG skill, e.g. adding Captions showed Zoom) or
    // two Publish cards. Keep the first occurrence, drop the rest, and remap any
    // wire that pointed at a dropped node to the survivor so nothing is orphaned.
    const remap = new Map<string, string>();
    const keptByKind: Partial<Record<string, string>> = {};
    const seenId = new Set<string>();
    const dedupedNodes: VelloNode[] = [];
    for (const n of nodes) {
      // Plain duplicate id (collision): drop it — both share the id so existing
      // wires already resolve to the survivor.
      if (seenId.has(n.id)) continue;
      if (n.data.kind === "compose" || n.data.kind === "publish") {
        const keeper = keptByKind[n.data.kind];
        if (keeper) { remap.set(n.id, keeper); continue; } // drop the duplicate
        keptByKind[n.data.kind] = n.id;
      }
      seenId.add(n.id);
      dedupedNodes.push(n);
    }
    // Drop orphaned wires: any edge whose source or target node is missing (a node
    // was deleted but its edge lingered in a stale save). Keeps the canvas free of
    // dashed lines pointing at nothing - wires are only ever shown for live nodes.
    const ids = new Set(dedupedNodes.map((n) => n.id));
    const seenEdge = new Set<string>();
    const liveEdges: VelloEdge[] = [];
    for (const e of edges) {
      const source = remap.get(e.source) ?? e.source;
      const target = remap.get(e.target) ?? e.target;
      if (!ids.has(source) || !ids.has(target) || source === target) continue;
      const id = `${source}->${target}`;
      if (seenEdge.has(id)) continue; // remap can produce a duplicate wire
      seenEdge.add(id);
      liveEdges.push({ ...e, id, source, target });
    }
    set({
      nodes: dedupedNodes,
      edges: liveEdges,
      selectedId: null,
      previewId: null,
      runStatus: "idle",
      runProgress: null,
      runLog: [],
      past: [],
      future: [],
      ...(key !== undefined ? { hydratedKey: key } : {}),
    });
  },

  // Auto-arrange the graph into clean left-to-right layers (layer = longest path
  // from a source), centering each layer vertically. Backs the canvas "Tidy" button.
  // Every node — including a Compose hub's skill children — flows strictly left to
  // right by layer (no radial fan), so the graph reads as one horizontal chain.
  tidyLayout: () => {
    if (get().runStatus === "running") return;
    get().pushHistory();
    const { nodes, edges } = get();
    const ROW = 230;
    const children: Record<string, string[]> = {};
    const indeg: Record<string, number> = {};
    nodes.forEach((n) => { children[n.id] = []; indeg[n.id] = 0; });
    edges.forEach((e) => {
      if (children[e.source] && indeg[e.target] !== undefined) {
        children[e.source].push(e.target);
        indeg[e.target] += 1;
      }
    });
    const layer: Record<string, number> = {};
    const queue = nodes.filter((n) => indeg[n.id] === 0).map((n) => n.id);
    queue.forEach((id) => { layer[id] = 0; });
    const left = { ...indeg };
    while (queue.length) {
      const id = queue.shift() as string;
      for (const c of children[id]) {
        layer[c] = Math.max(layer[c] ?? 0, (layer[id] ?? 0) + 1);
        left[c] -= 1;
        if (left[c] === 0) queue.push(c);
      }
    }
    const byLayer: Record<number, string[]> = {};
    nodes.forEach((n) => {
      const L = layer[n.id] ?? 0;
      (byLayer[L] ??= []).push(n.id);
    });
    // Place each layer left-to-right. A layer with MANY nodes (a big skill fan off
    // Compose) WRAPS into a compact GRID of up to MAX_ROWS rows instead of one very
    // tall single column — so the graph stays roughly square and Tidy's fitView lands
    // at a readable zoom (~4 cards across) rather than zooming way out. Wide layers
    // shift every LATER layer right by the extra sub-columns so nothing overlaps.
    const MAX_ROWS = 4;
    const SUB_COL = 268; // horizontal gap between wrapped sub-columns of one layer
    const pos: Record<string, { x: number; y: number }> = {};
    let extraX = 0;
    for (const L of Object.keys(byLayer).map(Number).sort((a, b) => a - b)) {
      const ids = byLayer[L];
      const baseX = L * COL + extraX;
      if (ids.length > MAX_ROWS) {
        const cols = Math.ceil(ids.length / MAX_ROWS);
        ids.forEach((id, i) => {
          const col = Math.floor(i / MAX_ROWS);
          const row = i % MAX_ROWS;
          const rowsInCol = Math.min(MAX_ROWS, ids.length - col * MAX_ROWS); // last col may be partial
          pos[id] = { x: baseX + col * SUB_COL, y: row * ROW - ((rowsInCol - 1) * ROW) / 2 };
        });
        extraX += (cols - 1) * SUB_COL;
      } else {
        ids.forEach((id, i) => {
          pos[id] = { x: baseX, y: i * ROW - ((ids.length - 1) * ROW) / 2 };
        });
      }
    }
    // LEFT-TO-RIGHT: skill children of a Compose hub stay in their OWN layer column
    // (immediately to the RIGHT of Compose), stacked vertically by the layer pass
    // above — no radial above/below fan. Each compose→skill edge is re-routed out of
    // Compose's DEFAULT right handle so the whole graph reads cleanly left-to-right.
    const kindOf: Record<string, NodeKind> = {};
    nodes.forEach((n) => { kindOf[n.id] = n.data.kind; });
    const skillEdgeIds = new Set<string>();
    edges.forEach((e) => {
      if (kindOf[e.source] === "compose" && kindOf[e.target] === "skill") skillEdgeIds.add(e.id);
    });
    set({
      nodes: nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })),
      edges: edges.map((e) =>
        skillEdgeIds.has(e.id) ? { ...e, sourceHandle: null } : e
      ),
    });
  },

  undo: () =>
    set((s) => {
      if (!s.past.length || s.runStatus === "running") return s;
      const prev = s.past[s.past.length - 1];
      return {
        nodes: prev.nodes,
        edges: prev.edges,
        past: s.past.slice(0, -1),
        future: [{ nodes: s.nodes, edges: s.edges }, ...s.future].slice(0, HISTORY_LIMIT),
        selectedId: null,
        previewId: null,
        runStatus: "idle",
      };
    }),

  redo: () =>
    set((s) => {
      if (!s.future.length || s.runStatus === "running") return s;
      const next = s.future[0];
      return {
        nodes: next.nodes,
        edges: next.edges,
        future: s.future.slice(1),
        past: [...s.past, { nodes: s.nodes, edges: s.edges }].slice(-HISTORY_LIMIT),
        selectedId: null,
        previewId: null,
        runStatus: "idle",
      };
    }),
}));
