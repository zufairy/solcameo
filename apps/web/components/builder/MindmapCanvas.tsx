"use client";

import React, {
  useEffect, useRef, useState, useCallback,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ZoomIn, ZoomOut, RotateCcw, Plus, Search, X, Brain,
  FileText, Sparkles, Wrench, Target, Zap, Tag,
  Upload, ChevronRight, Trash2, Edit3, Check, BookOpen,
} from "lucide-react";
import type { IntelligentNode } from "@/lib/builder/intelligentNode";
import type { SkillDef } from "@/lib/builder/agentSkills";
import { DEFAULT_SKILLS as DEFAULT_SKILL_DEFS } from "@/lib/builder/agentSkills";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimNode {
  id: string;
  label: string;
  category: NodeCategory;
  description?: string;
  tags?: string[];
  content?: string;         // markdown body
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  fixed?: boolean;
  ring: 0 | 1 | 2 | 3 | 4; // 0=center, 1=skills, 2=knowledge, 3=campaign, 4=tools
  isSkill?: boolean;
  isTool?: boolean;
  isKnowledge?: boolean;
  sourceExternal?: boolean;
  createdAt?: number;
}

interface SimEdge {
  source: string;
  target: string;
  strength: number; // 0..1, affects stroke opacity + spring
}

type NodeCategory =
  | "core" | "skill" | "knowledge" | "tool"
  | "foundation" | "development" | "marketing"
  | "operations" | "growth" | "milestone" | "initial";

/** User-authored knowledge node saved to localStorage */
interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category: NodeCategory;
  links: string[];       // ids of other nodes this links to
  createdAt: number;
  updatedAt: number;
}

export interface AgentMemoryNode {
  _id: string;
  kind: string;        // "lesson" | "performance" | "preference" | "relationship" | "warning" | "strategy"
  summary: string;
  importance: number;
  mintAddress?: string;
}

interface MindmapCanvasProps {
  nodes: IntelligentNode[];
  tools?: Array<{ id: string; label: string; description: string; connected: boolean }>;
  /** Per-agent skill definitions — unique to each agent's niche + archetype */
  skillDefs?: SkillDef[];
  /** Session ID for DB persistence */
  sessionId?: string;
  /** DB-persisted knowledge entries (merged with localStorage on mount) */
  dbEntries?: KnowledgeEntry[];
  /** Episodic memories from agentMemory table — shown as ring-5 nodes */
  memories?: AgentMemoryNode[];
  /** Called when user saves a new knowledge entry */
  onKnowledgeSave?: (entry: KnowledgeEntry) => void;
  /** Called when user deletes a knowledge entry (pass localId) */
  onKnowledgeDelete?: (localId: string) => void;
  /** Called when user confirms "Delete All" — wipe every knowledge + memory row for this agent */
  onDeleteAll?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "vello_second_brain_v2";
const CENTER_ID   = "vello-core";
const SETTLE_V    = 0.35;
const RENDER_SKIP = 2;

// Hardcoded fallback — overridden by skillDefs prop when agent has unique skills
const FALLBACK_SKILL_DEFS: SkillDef[] = DEFAULT_SKILL_DEFS;

const CAT_COLOR: Record<string, string> = {
  core:         "#10b981",
  skill:        "#a78bfa",
  knowledge:    "#60a5fa",
  tool:         "#f59e0b",
  foundation:   "#86A8FF",
  development:  "#7FD3C6",
  marketing:    "#FF8BA0",
  operations:   "#9AD8FF",
  growth:       "#FFB968",
  milestone:    "#ffffff",
  initial:      "#10b981",
  // Memory kinds
  lesson:       "#34d399",
  performance:  "#fbbf24",
  preference:   "#c084fc",
  relationship: "#38bdf8",
  warning:      "#f87171",
  strategy:     "#fb923c",
  default:      "#6b7280",
};

const CAT_ICON: Record<string, React.ElementType> = {
  core:      Brain,
  skill:     Sparkles,
  knowledge: BookOpen,
  tool:      Wrench,
  marketing: Target,
  milestone: Zap,
  growth:    Zap,
  default:   FileText,
};

function nodeColor(cat: string) { return CAT_COLOR[cat] ?? CAT_COLOR.default; }
function nodeIcon(cat: string)  { return CAT_ICON[cat] ?? CAT_ICON.default; }

// ─── Persistence ──────────────────────────────────────────────────────────────

// The local "second brain" cache MUST be scoped to the current agent (its
// sessionId). A single global key leaked EVERY agent's nodes into every agent's
// graph ("shows all the agents, too much"). No scope → no bucket (return []),
// mirroring recallMemories' "no identity → nothing" rule, so the graph can never
// fall back to a shared cross-agent store.
function brainKey(scope?: string): string | null {
  const s = (scope ?? "").trim();
  return s ? `${STORAGE_KEY}:${s}` : null;
}

function loadBrain(scope?: string): KnowledgeEntry[] {
  const key = brainKey(scope);
  if (!key || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as KnowledgeEntry[];
  } catch { return []; }
}

function saveBrain(entries: KnowledgeEntry[], scope?: string) {
  const key = brainKey(scope);
  if (!key || typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(entries)); } catch { /* quota */ }
}

// ─── Simulation seed ──────────────────────────────────────────────────────────

function seedNodes(
  knowledge: KnowledgeEntry[],
  external: IntelligentNode[],
  tools: MindmapCanvasProps["tools"],
  cx: number,
  cy: number,
  skillDefs: SkillDef[] = FALLBACK_SKILL_DEFS,
  memories: AgentMemoryNode[] = [],
): SimNode[] {
  const out: SimNode[] = [];

  // Ring 0 — center
  out.push({
    id: CENTER_ID, label: "Vello AI", category: "core",
    description: "Your AI Marketing Engineer copilot",
    tags: ["core"],
    x: cx, y: cy, vx: 0, vy: 0, radius: 30, mass: 10, fixed: true, ring: 0,
  });

  // Ring 1 — skills (deterministic circle at r=170)
  skillDefs.forEach((s, i) => {
    const angle = (i / skillDefs.length) * Math.PI * 2 - Math.PI / 2;
    out.push({
      id: s.id, label: s.label, category: "skill",
      description: s.desc, tags: s.tags,
      x: cx + Math.cos(angle) * 170, y: cy + Math.sin(angle) * 170,
      vx: 0, vy: 0, radius: 20, mass: 3, ring: 1, isSkill: true,
    });
  });

  // Ring 2 — user knowledge nodes
  knowledge.forEach((k, i) => {
    const angle = (i / Math.max(knowledge.length, 1)) * Math.PI * 2;
    const r = 270 + (i % 4) * 22;
    out.push({
      id: k.id, label: k.title, category: k.category,
      description: k.content.slice(0, 120),
      content: k.content, tags: k.tags,
      x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r,
      vx: 0, vy: 0, radius: 17, mass: 2, ring: 2, isKnowledge: true,
      createdAt: k.createdAt,
    });
  });

  // Ring 3 — external builder nodes
  external.forEach((n, i) => {
    if (out.some((o) => o.id === n.id)) return;
    const angle = (i / Math.max(external.length, 1)) * Math.PI * 2 + Math.PI / 7;
    const r = 230 + (i % 3) * 25;
    out.push({
      id: n.id, label: n.label,
      category: n.category as NodeCategory,
      description: typeof n.description === "string" ? n.description : undefined,
      x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r,
      vx: 0, vy: 0,
      radius: n.category === "initial" ? 22 : 15,
      mass: 2, ring: 3, sourceExternal: true,
    });
  });

  // Ring 4 — tools
  (tools ?? []).forEach((t, i) => {
    if (out.some((o) => o.id === t.id)) return;
    const angle = (i / Math.max((tools ?? []).length, 1)) * Math.PI * 2 + Math.PI / 4;
    out.push({
      id: t.id, label: t.label, category: "tool",
      description: t.description,
      x: cx + Math.cos(angle) * 340, y: cy + Math.sin(angle) * 340,
      vx: 0, vy: 0, radius: 16, mass: 2, ring: 4, isTool: true,
    });
  });

  // Ring 5 — episodic memories (sorted by importance desc)
  const sortedMems = [...memories].sort((a, b) => b.importance - a.importance).slice(0, 20);
  sortedMems.forEach((m, i) => {
    const memId = `mem_${m._id}`;
    if (out.some((o) => o.id === memId)) return;
    const angle = (i / Math.max(sortedMems.length, 1)) * Math.PI * 2 + Math.PI / 6;
    // Radius scales with importance: high-importance memories orbit closer
    const orbitR = 390 + ((100 - m.importance) / 100) * 80;
    const nodeR = Math.max(10, Math.min(18, 10 + m.importance / 14));
    // A standing order is stored as a machine-readable canonical line
    // ("[DIRECTIVE] speech=silent; format=commercial"). Show it as the RULE the
    // operator gave, not as raw key=value — this ring is the brain the operator reads.
    const directive = describeDirectiveSummary(m.summary);
    out.push({
      id: memId,
      label: directive ? "Standing order" : m.kind.charAt(0).toUpperCase() + m.kind.slice(1),
      category: m.kind as NodeCategory,
      description: directive ?? m.summary.replace(/^\[\w+ \d+\] /, "").slice(0, 140),
      tags: [directive ? "directive" : m.kind, `imp:${m.importance}`],
      x: cx + Math.cos(angle) * orbitR,
      y: cy + Math.sin(angle) * orbitR,
      vx: 0, vy: 0, radius: nodeR, mass: 1.5, ring: 4,
    });
  });

  return out;
}

/**
 * Render a canonical directive memory as plain English. Returns null for an
 * ordinary memory, so the caller falls back to its own formatting.
 * Mirrors lib/server/agentDirectives.ts's encoding (kept local — this is a client
 * component and the server module is not bundled for the browser).
 */
function describeDirectiveSummary(summary: string): string | null {
  const s = (summary ?? "").trim();
  if (!s.toUpperCase().startsWith("[DIRECTIVE]")) return null;
  const SPEECH: Record<string, string> = {
    silent: "no speaking in videos",
    voiceover: "voice off-camera only (no talking head)",
    on_camera: "speaks on camera",
  };
  const parts: string[] = [];
  for (const chunk of s.slice("[DIRECTIVE]".length).split(";")) {
    const [k, ...rest] = chunk.split("=");
    const key = k.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (!key || !value) continue;
    if (key === "speech") parts.push(SPEECH[value] ?? value);
    else if (key === "format") parts.push(`every video is a ${value}`);
    else if (key === "style") parts.push(`style: ${value}`);
    else if (key === "language") parts.push(`${value} only`);
    else if (key === "must") parts.push(`always ${value.split("|").join(", ")}`);
    else if (key === "avoid") parts.push(`never ${value.split("|").join(", ")}`);
  }
  return parts.length ? parts.join(" · ").slice(0, 160) : null;
}

function seedEdges(
  knowledge: KnowledgeEntry[],
  external: IntelligentNode[],
  tools: MindmapCanvasProps["tools"],
  skillDefs: SkillDef[] = FALLBACK_SKILL_DEFS,
  memories: AgentMemoryNode[] = [],
): SimEdge[] {
  const edges: SimEdge[] = [];

  // Center → skills
  skillDefs.forEach((s) => edges.push({ source: CENTER_ID, target: s.id, strength: 1 }));

  // Skills → knowledge (by overlapping tags)
  knowledge.forEach((k, i) => {
    const skillIdx = i % skillDefs.length;
    edges.push({ source: skillDefs[skillIdx].id, target: k.id, strength: 0.7 });
    // Also link knowledge that share tags
    k.links.forEach((lid) => {
      if (lid !== k.id) edges.push({ source: k.id, target: lid, strength: 0.5 });
    });
  });

  // Skills → external campaign nodes
  external.forEach((n, i) => {
    edges.push({ source: skillDefs[i % skillDefs.length].id, target: n.id, strength: 0.6 });
    (n.connectsTo ?? []).forEach((tid) => edges.push({ source: n.id, target: tid, strength: 0.8 }));
  });

  // Skills → tools
  (tools ?? []).forEach((t, i) => {
    edges.push({ source: skillDefs[i % skillDefs.length].id, target: t.id, strength: 0.5 });
  });

  // Memories → center (weak pull) + knowledge (semantic proximity by kind)
  const sortedMems = [...memories].sort((a, b) => b.importance - a.importance).slice(0, 20);
  sortedMems.forEach((m) => {
    const memId = `mem_${m._id}`;
    // High-importance memories connect directly to center
    if (m.importance >= 70) {
      edges.push({ source: CENTER_ID, target: memId, strength: 0.3 });
    }
    // Connect warnings/strategy to a skill node for visibility
    if (m.kind === "warning" || m.kind === "strategy") {
      edges.push({ source: skillDefs[0]?.id ?? CENTER_ID, target: memId, strength: 0.4 });
    }
    // Connect lessons/performance to knowledge nodes
    if ((m.kind === "lesson" || m.kind === "performance") && knowledge.length > 0) {
      edges.push({ source: knowledge[0].id, target: memId, strength: 0.25 });
    }
  });

  return edges;
}

// ─── Force simulation step ────────────────────────────────────────────────────

function simulateStep(
  ns: SimNode[],
  es: SimEdge[],
  cx: number,
  cy: number,
): number {
  const byId = new Map<string, SimNode>();
  ns.forEach((n) => byId.set(n.id, n));

  const edgeMap = new Map<string, SimEdge>();
  es.forEach((e) => edgeMap.set(`${e.source}:${e.target}`, e));

  // Preferred ring radii
  const ringRadius: Record<number, number> = { 0: 0, 1: 170, 2: 270, 3: 230, 4: 340 };
  // Spring lengths per ring pair
  function springLen(a: SimNode, b: SimNode): number {
    if (a.ring === 0 || b.ring === 0) return ringRadius[Math.max(a.ring, b.ring)];
    return Math.abs(ringRadius[a.ring] - ringRadius[b.ring]) + 90;
  }
  function springK(strength: number) { return 0.028 * strength; }

  // Repulsion
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i], b = ns[j];
      if (a.fixed && b.fixed) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy + 0.01;
      const dist  = Math.sqrt(dist2);
      // Stronger repulsion when nodes overlap their radii
      const minDist = a.radius + b.radius + 18;
      const repulsion = dist < minDist
        ? 8000 / (dist2 + 1)
        : 4200 / dist2;
      const fx = (dx / dist) * repulsion;
      const fy = (dy / dist) * repulsion;
      if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
      if (!b.fixed) { b.vx += fx; b.vy += fy; }
    }
  }

  // Spring edges
  es.forEach(({ source, target, strength }) => {
    const a = byId.get(source), b = byId.get(target);
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const sl = springLen(a, b);
    const force = (dist - sl) * springK(strength);
    const fx = (dx / dist) * force, fy = (dy / dist) * force;
    if (!a.fixed) { a.vx += fx; a.vy += fy; }
    if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
  });

  // Gentle gravity toward center
  ns.forEach((n) => {
    if (n.fixed) return;
    const pull = 0.003 + (n.ring === 1 ? 0.004 : 0);
    n.vx += (cx - n.x) * pull;
    n.vy += (cy - n.y) * pull;
  });

  // Integrate + damp
  const damp = 0.86;
  let maxV = 0;
  ns.forEach((n) => {
    if (n.fixed) return;
    n.vx *= damp; n.vy *= damp;
    n.x += n.vx; n.y += n.vy;
    const v = Math.abs(n.vx) + Math.abs(n.vy);
    if (v > maxV) maxV = v;
  });

  return maxV;
}

// ─── Tag pill ─────────────────────────────────────────────────────────────────

function TagPill({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white/[0.07] border border-white/[0.10] text-[9.5px] text-white/50">
      <Tag className="w-2 h-2" />{tag}
    </span>
  );
}

// ─── Node detail panel ────────────────────────────────────────────────────────

function NodePanel({
  node,
  entries,
  onClose,
  onDelete,
  onUpdate,
}: {
  node: SimNode | null;
  entries: KnowledgeEntry[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<KnowledgeEntry>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", content: "", tags: "" });

  useEffect(() => {
    if (!node) return;
    const entry = entries.find((e) => e.id === node.id);
    setDraft({
      title: entry?.title ?? node.label,
      content: entry?.content ?? node.description ?? "",
      tags: (entry?.tags ?? node.tags ?? []).join(", "),
    });
    setEditing(false);
  }, [node?.id]);

  if (!node) return null;
  const Icon = nodeIcon(node.category);
  const color = nodeColor(node.category);
  const isOwned = node.isKnowledge;

  function save() {
    if (!node) return;
    onUpdate(node.id, {
      title: draft.title.trim(),
      content: draft.content,
      tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
      updatedAt: Date.now(),
    });
    setEditing(false);
  }

  return (
    <motion.div
      key={node.id}
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 20, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="absolute right-3 top-3 bottom-3 w-72 z-20 flex flex-col rounded-xl border border-white/[0.10] bg-[#111]/90 backdrop-blur-xl overflow-hidden shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 p-3.5 border-b border-white/[0.07] shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: `${color}22`, border: `1px solid ${color}44` }}>
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              className="w-full bg-transparent text-[13px] font-semibold text-white outline-none border-b border-white/20 pb-0.5"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              autoFocus
            />
          ) : (
            <p className="text-[13px] font-semibold text-white leading-snug truncate">{node.label}</p>
          )}
          <span className="text-[10px] uppercase tracking-widest mt-0.5 inline-block"
            style={{ color: `${color}99` }}>
            {node.category}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isOwned && !editing && (
            <button onClick={() => setEditing(true)}
              className="w-6 h-6 rounded flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors">
              <Edit3 className="w-3 h-3" />
            </button>
          )}
          {editing && (
            <button onClick={save}
              className="w-6 h-6 rounded flex items-center justify-center text-emerald-400 hover:bg-emerald-400/10 transition-colors">
              <Check className="w-3 h-3" />
            </button>
          )}
          {isOwned && (
            <button onClick={() => onDelete(node.id)}
              className="w-6 h-6 rounded flex items-center justify-center text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          <button onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors">
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 scrollbar-thin scrollbar-thumb-white/10">
        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {editing ? (
            <input
              className="w-full text-[11px] bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-white/70 outline-none focus:border-white/20"
              value={draft.tags}
              onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
              placeholder="tag1, tag2, tag3"
            />
          ) : (
            (node.tags ?? []).map((t) => <TagPill key={t} tag={t} />)
          )}
        </div>

        {/* Content */}
        <div>
          <p className="text-[10px] text-white/30 uppercase tracking-widest mb-1.5">Content</p>
          {editing ? (
            <textarea
              className="w-full h-40 text-[11.5px] bg-white/[0.04] border border-white/10 rounded px-2.5 py-2 text-white/80 outline-none focus:border-white/20 resize-none leading-relaxed font-mono"
              value={draft.content}
              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
              placeholder="Write markdown content…"
            />
          ) : (
            <p className="text-[11.5px] text-white/65 leading-relaxed whitespace-pre-wrap break-words">
              {node.content || node.description || "No content yet."}
            </p>
          )}
        </div>

        {/* Connection hint */}
        {!editing && node.isSkill && (
          <div className="rounded-lg bg-violet-500/[0.08] border border-violet-500/20 p-2.5">
            <p className="text-[10.5px] text-violet-300/70 leading-relaxed">{node.description}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/[0.07] px-3.5 py-2 flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[10px] text-white/25">
          {node.createdAt ? new Date(node.createdAt).toLocaleDateString() : "System node"}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Add Knowledge panel ──────────────────────────────────────────────────────

const KNOWLEDGE_CATEGORIES: NodeCategory[] = [
  "knowledge", "skill", "marketing", "growth", "operations", "development",
];

function AddKnowledgePanel({
  onSave,
  onClose,
}: {
  onSave: (entry: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">) => void;
  onClose: () => void;
}) {
  const [title, setTitle]       = useState("");
  const [content, setContent]   = useState("");
  const [tags, setTags]         = useState("");
  const [category, setCategory] = useState<NodeCategory>("knowledge");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const firstLine = text.split("\n")[0].replace(/^#+ /, "").trim();
      if (!title) setTitle(firstLine || file.name.replace(/\.md$/, ""));
      setContent(text);
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".md") || file.type === "text/plain" || file.type === "text/markdown")) {
      handleFile(file);
    }
  }

  function submit() {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      content,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      category,
      links: [],
    });
    setTitle(""); setContent(""); setTags(""); setCategory("knowledge");
  }

  return (
    <motion.div
      initial={{ x: 20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 20, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="absolute right-3 top-3 bottom-3 w-72 z-20 flex flex-col rounded-xl border border-emerald-400/20 bg-[#111]/90 backdrop-blur-xl overflow-hidden shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center gap-2 p-3.5 border-b border-white/[0.07] shrink-0">
        <div className="w-7 h-7 rounded-lg bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center shrink-0">
          <Brain className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-white">Add to Second Brain</p>
          <p className="text-[10px] text-white/35">Drop a .md file or write below</p>
        </div>
        <button onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors">
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* File drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`relative h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-all ${
            dragging ? "border-emerald-400/60 bg-emerald-400/10" : "border-white/[0.10] hover:border-white/20 hover:bg-white/[0.02]"
          }`}
        >
          <Upload className="w-4 h-4 text-white/30" />
          <span className="text-[10px] text-white/35">Drop .md file or click</span>
          <input ref={fileRef} type="file" accept=".md,.txt" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        </div>

        {/* Title */}
        <div>
          <label className="text-[10px] text-white/35 uppercase tracking-widest block mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Knowledge node title…"
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder-white/25 outline-none focus:border-emerald-400/40 transition-colors"
          />
        </div>

        {/* Category */}
        <div>
          <label className="text-[10px] text-white/35 uppercase tracking-widest block mb-1">Category</label>
          <div className="flex flex-wrap gap-1">
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                  category === c
                    ? "border-transparent text-zinc-950 font-semibold"
                    : "border-white/10 text-white/40 hover:text-white/60"
                }`}
                style={category === c ? { background: nodeColor(c) } : {}}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="text-[10px] text-white/35 uppercase tracking-widest block mb-1">Tags</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="strategy, influencer, seo…"
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[11.5px] text-white placeholder-white/25 outline-none focus:border-emerald-400/40 transition-colors"
          />
        </div>

        {/* Content */}
        <div>
          <label className="text-[10px] text-white/35 uppercase tracking-widest block mb-1">Content (Markdown)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={"# Title\n\nWrite your knowledge here…\n\n- bullet one\n- bullet two"}
            rows={7}
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white/80 font-mono placeholder-white/20 outline-none focus:border-emerald-400/40 resize-none leading-relaxed transition-colors"
          />
        </div>
      </div>

      {/* Save */}
      <div className="shrink-0 border-t border-white/[0.07] p-3.5">
        <button
          onClick={submit}
          disabled={!title.trim()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 hover:border-emerald-400/50 text-emerald-300 text-[12px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Brain className="w-3.5 h-3.5" />
          Add to Second Brain
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MindmapCanvas({
  nodes: externalNodes,
  tools = [],
  skillDefs: skillDefsProp,
  sessionId,
  dbEntries,
  memories = [],
  onKnowledgeSave,
  onKnowledgeDelete,
  onDeleteAll,
}: MindmapCanvasProps) {
  const skillDefs = skillDefsProp ?? FALLBACK_SKILL_DEFS;
  const containerRef  = useRef<HTMLDivElement>(null);
  const animRef       = useRef<number>(0);
  const nodesRef      = useRef<SimNode[]>([]);
  const edgesRef      = useRef<SimEdge[]>([]);
  const dimsRef       = useRef({ w: 800, h: 600 });
  const settledRef    = useRef(false);
  const tickRef       = useRef(0);
  const seededRef     = useRef(false);
  const skillDefsRef  = useRef<SkillDef[]>(skillDefs);

  const [dims, setDims]           = useState({ w: 800, h: 600 });
  const [renderTick, setRenderTick] = useState(0);
  const [zoom, setZoom]           = useState(1);
  const [pan, setPan]             = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart                  = useRef({ x: 0, y: 0 });
  const dragRef                   = useRef<{ id: string; ox: number; oy: number } | null>(null);

  const [hoveredId, setHoveredId]   = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [search, setSearch]         = useState("");
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const confirmDeleteAllTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDeleteAll = useCallback(() => {
    if (!confirmDeleteAll) {
      setConfirmDeleteAll(true);
      if (confirmDeleteAllTimer.current) clearTimeout(confirmDeleteAllTimer.current);
      confirmDeleteAllTimer.current = setTimeout(() => setConfirmDeleteAll(false), 3000);
      return;
    }
    if (confirmDeleteAllTimer.current) clearTimeout(confirmDeleteAllTimer.current);
    setConfirmDeleteAll(false);
    // Optimistic local clear so the graph goes blank instantly instead of
    // waiting on the Convex round-trip; also wipes the scoped localStorage
    // cache so a stale local-only entry can't resurrect after the DB rows die.
    setKnowledgeEntries([]);
    saveBrain([], sessionId);
    setSelectedId(null);
    onDeleteAll?.();
  }, [confirmDeleteAll, sessionId, onDeleteAll]);

  useEffect(() => () => { if (confirmDeleteAllTimer.current) clearTimeout(confirmDeleteAllTimer.current); }, []);

  // Re-seed when skillDefs change (agent questionnaire completes → unique skills assigned)
  useEffect(() => {
    const prev = skillDefsRef.current;
    if (prev === skillDefs || prev.map((s) => s.id).join(",") === skillDefs.map((s) => s.id).join(",")) return;
    skillDefsRef.current = skillDefs;
    seededRef.current = false;
    settledRef.current = false;
  }, [skillDefs]);

  // Load this agent's knowledge from its SCOPED localStorage bucket, merge with
  // its DB entries. Re-runs when the agent (sessionId) changes so switching agents
  // reloads the correct graph instead of showing the previous one's nodes.
  useEffect(() => {
    // One-time cleanup: drop the legacy UN-scoped global bucket that pooled every
    // agent's nodes together (the source of this bug). Scoped keys replace it; the
    // real knowledge is DB-backed (dbEntries) and repopulates per agent.
    try { if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    const local = loadBrain(sessionId);
    if (!dbEntries?.length) {
      setKnowledgeEntries(local);
      return;
    }
    // Merge: DB entries take precedence by localId; local-only entries kept
    const dbLocalIds = new Set(dbEntries.map((e) => e.id));
    const localOnly = local.filter((e) => !dbLocalIds.has(e.id));
    const merged = [...dbEntries, ...localOnly];
    setKnowledgeEntries(merged);
    saveBrain(merged, sessionId); // sync localStorage to reflect DB state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Persist on change (to this agent's scoped bucket only).
  useEffect(() => {
    saveBrain(knowledgeEntries, sessionId);
  }, [knowledgeEntries, sessionId]);

  // ResizeObserver
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      dimsRef.current = { w: r.width, h: r.height };
      setDims({ w: r.width, h: r.height });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Seed / merge nodes
  useEffect(() => {
    const { w, h } = dimsRef.current;
    const cx = w / 2, cy = h / 2;

    if (!seededRef.current) {
      nodesRef.current = seedNodes(knowledgeEntries, externalNodes, tools, cx, cy, skillDefs, memories);
      edgesRef.current = seedEdges(knowledgeEntries, externalNodes, tools, skillDefs, memories);
      seededRef.current = true;
      settledRef.current = false;
      return;
    }

    // Merge new external nodes
    const currentIds = new Set(nodesRef.current.map((n) => n.id));
    let changed = false;
    externalNodes.forEach((n, i) => {
      if (currentIds.has(n.id)) return;
      const angle = (i / Math.max(externalNodes.length, 1)) * Math.PI * 2 + Math.PI / 7;
      const r = 230 + (i % 3) * 25;
      nodesRef.current.push({
        id: n.id, label: n.label, category: n.category as NodeCategory,
        description: typeof n.description === "string" ? n.description : undefined,
        x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r,
        vx: 0, vy: 0, radius: 15, mass: 2, ring: 3, sourceExternal: true,
      });
      edgesRef.current.push({
        source: skillDefs[i % skillDefs.length].id,
        target: n.id,
        strength: 0.6,
      });
      changed = true;
    });

    // Merge new knowledge entries
    knowledgeEntries.forEach((k, i) => {
      if (currentIds.has(k.id)) return;
      const angle = (i / Math.max(knowledgeEntries.length, 1)) * Math.PI * 2;
      const r = 270 + (i % 4) * 22;
      nodesRef.current.push({
        id: k.id, label: k.title, category: k.category,
        description: k.content.slice(0, 120), content: k.content, tags: k.tags,
        x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r,
        vx: 0, vy: 0, radius: 17, mass: 2, ring: 2, isKnowledge: true,
        createdAt: k.createdAt,
      });
      edgesRef.current.push({
        source: skillDefs[i % skillDefs.length].id,
        target: k.id,
        strength: 0.7,
      });
      changed = true;
    });

    if (changed) {
      settledRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalNodes, knowledgeEntries]);

  // Re-seed when dims become available
  useEffect(() => {
    if (seededRef.current) return;
    const { w, h } = dimsRef.current;
    if (w < 100) return;
    nodesRef.current = seedNodes(knowledgeEntries, externalNodes, tools, w / 2, h / 2, skillDefs, memories);
    edgesRef.current = seedEdges(knowledgeEntries, externalNodes, tools, skillDefs, memories);
    seededRef.current = true;
    settledRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims]);

  // Simulation loop
  useEffect(() => {
    let running = true;

    function tick() {
      if (!running) return;

      if (!settledRef.current && nodesRef.current.length > 0) {
        const { w, h } = dimsRef.current;
        const maxV = simulateStep(nodesRef.current, edgesRef.current, w / 2, h / 2);

        if (maxV < SETTLE_V) {
          settledRef.current = true;
          setRenderTick((t) => t + 1);
        } else {
          tickRef.current += 1;
          if (tickRef.current % RENDER_SKIP === 0) setRenderTick((t) => t + 1);
        }
      }

      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [dims]);

  // Pan events
  const onSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as SVGElement).closest("[data-node]")) return;
    setSelectedId(null);
    setShowAdd(false);
    setIsPanning(true);
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }, [pan]);

  useEffect(() => {
    if (!isPanning) return;
    const mv = (e: MouseEvent) => setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
    const up = () => setIsPanning(false);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [isPanning]);

  // Drag node
  const onNodeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const n = nodesRef.current.find((x) => x.id === id);
    if (!n || n.fixed) return;
    dragRef.current = { id, ox: e.clientX - n.x * zoom - pan.x, oy: e.clientY - n.y * zoom - pan.y };
  }, [zoom, pan]);

  useEffect(() => {
    const mv = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { id, ox, oy } = dragRef.current;
      nodesRef.current = nodesRef.current.map((n) =>
        n.id === id ? { ...n, x: (e.clientX - pan.x - ox) / zoom, y: (e.clientY - pan.y - oy) / zoom, vx: 0, vy: 0 } : n
      );
      settledRef.current = false;
      setRenderTick((t) => t + 1);
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [zoom, pan]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.25, Math.min(z * (e.deltaY > 0 ? 0.92 : 1.09), 3.5)));
  }, []);

  // Knowledge CRUD
  function addKnowledge(data: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">) {
    const entry: KnowledgeEntry = {
      ...data, id: `kb-${Date.now()}`,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    setKnowledgeEntries((prev) => [...prev, entry]);
    onKnowledgeSave?.(entry);
    setShowAdd(false);
    settledRef.current = false;
  }

  function deleteKnowledge(id: string) {
    setKnowledgeEntries((prev) => prev.filter((e) => e.id !== id));
    nodesRef.current = nodesRef.current.filter((n) => n.id !== id);
    edgesRef.current = edgesRef.current.filter((e) => e.source !== id && e.target !== id);
    if (selectedId === id) setSelectedId(null);
    settledRef.current = false;
    setRenderTick((t) => t + 1);
    onKnowledgeDelete?.(id);
  }

  function updateKnowledge(id: string, patch: Partial<KnowledgeEntry>) {
    setKnowledgeEntries((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e));
    nodesRef.current = nodesRef.current.map((n) =>
      n.id === id ? { ...n, label: patch.title ?? n.label, content: patch.content ?? n.content, tags: patch.tags ?? n.tags } : n
    );
    setRenderTick((t) => t + 1);
  }

  // Filtered node ids for search
  const searchLower = search.toLowerCase().trim();
  const filteredIds = searchLower
    ? new Set(nodesRef.current.filter((n) =>
        n.label.toLowerCase().includes(searchLower) ||
        (n.description ?? "").toLowerCase().includes(searchLower) ||
        (n.tags ?? []).some((t) => t.toLowerCase().includes(searchLower))
      ).map((n) => n.id))
    : null;

  const ns = nodesRef.current;
  const es = edgesRef.current;
  const byId = new Map(ns.map((n) => [n.id, n]));

  const hovNode = hoveredId ? ns.find((n) => n.id === hoveredId) ?? null : null;
  const selNode = selectedId ? ns.find((n) => n.id === selectedId) ?? null : null;
  const connectedIds = hoveredId
    ? new Set(es.filter((e) => e.source === hoveredId || e.target === hoveredId).flatMap((e) => [e.source, e.target]))
    : null;

  // Stats
  const kbCount   = ns.filter((n) => n.isKnowledge).length;
  const skillCount = ns.filter((n) => n.isSkill).length;
  const toolCount  = ns.filter((n) => n.isTool).length;
  const extCount   = ns.filter((n) => n.sourceExternal).length;

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0a0a0a] overflow-hidden select-none">

      {/* ── Background grid ── */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        <defs>
          <pattern id="bg-dot" width={40 * zoom} height={40 * zoom} patternUnits="userSpaceOnUse"
            x={pan.x % (40 * zoom)} y={pan.y % (40 * zoom)}>
            <circle cx={40 * zoom} cy={40 * zoom} r="0.6" fill="rgba(255,255,255,0.035)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg-dot)" />
      </svg>

      {/* ── Toolbar ── */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
        {/* Search */}
        <div className={`flex items-center gap-1.5 rounded-lg border bg-black/60 backdrop-blur px-2.5 py-1.5 transition-all ${
          search ? "border-emerald-400/30 w-52" : "border-white/[0.10] w-36 hover:border-white/20"
        }`}>
          <Search className="w-3 h-3 text-white/40 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brain…"
            className="flex-1 min-w-0 bg-transparent text-[11.5px] text-white/80 placeholder-white/25 outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-white/30 hover:text-white/60">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>

        {/* Add knowledge */}
        <button
          onClick={() => { setShowAdd((s) => !s); setSelectedId(null); }}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-all ${
            showAdd
              ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300"
              : "border-white/[0.10] bg-black/60 text-white/60 hover:text-white hover:border-white/20"
          }`}
        >
          <Plus className="w-3 h-3" />
          <span className="hidden sm:inline">Add Knowledge</span>
        </button>

        {/* Delete All, wipes every knowledge + memory node for this agent. Two-click
            confirm (click again within 3s) instead of a native confirm() dialog, to
            match the rest of this panel's custom chrome. */}
        {(knowledgeEntries.length > 0 || memories.length > 0) && (
          <button
            onClick={handleDeleteAll}
            title="Delete all brain content, knowledge + memory, for this agent only"
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-all ${
              confirmDeleteAll
                ? "border-red-400/50 bg-red-400/20 text-red-300"
                : "border-white/[0.10] bg-black/60 text-white/50 hover:text-red-300 hover:border-red-400/30"
            }`}
          >
            <Trash2 className="w-3 h-3" />
            <span className="hidden sm:inline">{confirmDeleteAll ? "Confirm delete all?" : "Delete All"}</span>
          </button>
        )}
      </div>

      {/* ── Zoom controls ── */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5"
        style={{ right: (selNode || showAdd) ? "304px" : "12px", transition: "right 0.18s ease" }}>
        {[
          { Icon: ZoomIn,    fn: () => setZoom((z) => Math.min(z * 1.2, 3.5)) },
          { Icon: ZoomOut,   fn: () => setZoom((z) => Math.max(z * 0.8, 0.25)) },
          { Icon: RotateCcw, fn: () => { setZoom(1); setPan({ x: 0, y: 0 }); } },
        ].map(({ Icon, fn }, i) => (
          <button key={i} type="button" onClick={fn}
            className="w-7 h-7 rounded-lg bg-black/60 border border-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors backdrop-blur">
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>

      {/* ── Stats bar ── */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 rounded-lg border border-white/[0.07] bg-black/50 backdrop-blur px-3 py-1.5">
        {[
          { icon: Brain,    color: "#10b981", label: "Core",      n: 1 },
          { icon: Sparkles, color: "#a78bfa", label: "Skills",    n: skillCount },
          { icon: BookOpen, color: "#60a5fa", label: "Knowledge", n: kbCount },
          { icon: Zap,      color: "#FFB968", label: "Builder",   n: extCount },
          { icon: Wrench,   color: "#f59e0b", label: "Tools",     n: toolCount },
        ].map(({ icon: Icon, color, label, n }) => (
          <div key={label} className="flex items-center gap-1">
            <Icon className="w-2.5 h-2.5" style={{ color }} />
            <span className="text-[9.5px] text-white/40">{n} {label}</span>
          </div>
        ))}
        <div className="w-px h-3 bg-white/10" />
        <span className="text-[9.5px] text-white/25">{es.length} links</span>
      </div>

      {/* ── Graph SVG ── */}
      <svg
        className={`w-full h-full ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
        onMouseDown={onSvgMouseDown}
        onWheel={onWheel}
        aria-hidden
      >
        <defs>
          <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </radialGradient>
          {/* Edge gradient markers for each category */}
          {Object.entries(CAT_COLOR).map(([cat, color]) => (
            <marker key={cat} id={`arr-${cat}`} markerWidth="5" markerHeight="5"
              refX="4" refY="2.5" orient="auto">
              <path d="M0,0 L5,2.5 L0,5 Z" fill={color} opacity="0.4" />
            </marker>
          ))}
        </defs>

        {/* Center glow */}
        {(() => {
          const c = byId.get(CENTER_ID);
          if (!c) return null;
          const tx = c.x * zoom + pan.x, ty = c.y * zoom + pan.y;
          return <circle cx={tx} cy={ty} r={100 * zoom} fill="url(#core-glow)" />;
        })()}

        {/* Cluster halos, soft rings hinting at rings 1,2,3 */}
        {[
          { r: 170, color: "#a78bfa", opacity: 0.04 },
          { r: 270, color: "#60a5fa", opacity: 0.03 },
          { r: 340, color: "#f59e0b", opacity: 0.025 },
        ].map(({ r, color, opacity }) => {
          const c = byId.get(CENTER_ID);
          if (!c) return null;
          const cx = c.x * zoom + pan.x, cy = c.y * zoom + pan.y;
          return (
            <circle key={r} cx={cx} cy={cy} r={r * zoom}
              fill="none" stroke={color} strokeWidth={1 * zoom} opacity={opacity * zoom + 0.02} strokeDasharray="4 8" />
          );
        })}

        {/* Edges */}
        <g>
          {es.map((e, i) => {
            const a = byId.get(e.source), b = byId.get(e.target);
            if (!a || !b) return null;
            const ax = a.x * zoom + pan.x, ay = a.y * zoom + pan.y;
            const bx = b.x * zoom + pan.x, by2 = b.y * zoom + pan.y;
            const isHi = connectedIds && connectedIds.has(e.source) && connectedIds.has(e.target);
            const isDim = searchLower
              ? !filteredIds?.has(e.source) && !filteredIds?.has(e.target)
              : connectedIds && !isHi;
            const color = nodeColor(a.category);
            const mid = { x: (ax + bx) / 2, y: (ay + by2) / 2 };
            // Slight curve: move midpoint perpendicular
            const perp = { x: -(by2 - ay) * 0.15, y: (bx - ax) * 0.15 };
            return (
              <path
                key={i}
                d={`M${ax},${ay} Q${mid.x + perp.x},${mid.y + perp.y} ${bx},${by2}`}
                fill="none"
                stroke={isHi ? color : "rgba(255,255,255,0.055)"}
                strokeWidth={isHi ? 1.8 * zoom : 0.7}
                opacity={isDim ? 0.12 : e.strength * (isHi ? 1 : 0.65)}
                style={{ transition: "opacity 0.12s, stroke 0.12s" }}
                markerEnd={isHi ? `url(#arr-${a.category})` : undefined}
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {ns.map((n) => {
            const tx = n.x * zoom + pan.x, ty = n.y * zoom + pan.y;
            const r = n.radius * zoom;
            const color = nodeColor(n.category);
            const isHov = hoveredId === n.id;
            const isSel = selectedId === n.id;
            const isDim = searchLower
              ? !filteredIds?.has(n.id)
              : connectedIds && !connectedIds.has(n.id) && hoveredId !== n.id;

            return (
              <g
                key={n.id}
                transform={`translate(${tx},${ty})`}
                data-node={n.id}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId(null)}
                onMouseDown={(e) => onNodeMouseDown(e, n.id)}
                onClick={() => { setSelectedId(n.id); setShowAdd(false); }}
                style={{
                  cursor: n.fixed ? "pointer" : "grab",
                  opacity: isDim ? 0.15 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {/* Selection ring */}
                {isSel && <circle r={r + 7} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} strokeDasharray="3 4" />}

                {/* Hover glow */}
                {(isHov || isSel) && <circle r={r + 9} fill={color} opacity={0.1} />}

                {/* Outer shell */}
                <circle r={r} fill={color} opacity={n.ring === 0 ? 0.35 : 0.18}
                  stroke={color} strokeWidth={isSel ? 2 : isHov ? 1.5 : 0.8}
                  strokeOpacity={isSel ? 0.9 : isHov ? 0.7 : 0.45} />

                {/* Inner core dot */}
                <circle r={Math.max(2.5, r * 0.28)} fill={color} opacity={0.9} />

                {/* Knowledge badge */}
                {n.isKnowledge && (
                  <circle r={4 * zoom} cx={r * 0.72} cy={-r * 0.72}
                    fill="#60a5fa" opacity={0.9} />
                )}

                {/* Label */}
                <text
                  textAnchor="middle"
                  dy={r + Math.max(9, 11 * zoom)}
                  fontSize={Math.max(7.5, 9.5 * zoom)}
                  fill={color}
                  opacity={isHov || isSel ? 1 : 0.65}
                  style={{ userSelect: "none", pointerEvents: "none", fontFamily: "var(--font-geist-sans, system-ui)" }}
                >
                  {n.label.length > 16 ? n.label.slice(0, 14) + "…" : n.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── Hover tooltip ── */}
      <AnimatePresence>
        {hovNode && !selNode && !showAdd && (
          <motion.div
            key={hovNode.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute top-12 left-3 z-10 max-w-[200px] rounded-xl border border-white/[0.10] bg-black/85 px-3 py-2.5 backdrop-blur"
          >
            <p className="text-[11px] font-semibold" style={{ color: nodeColor(hovNode.category) }}>
              {hovNode.label}
            </p>
            {hovNode.description && (
              <p className="mt-0.5 text-[10px] leading-relaxed text-white/55 line-clamp-3">
                {hovNode.description}
              </p>
            )}
            {(hovNode.tags ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(hovNode.tags ?? []).slice(0, 4).map((t) => <TagPill key={t} tag={t} />)}
              </div>
            )}
            <div className="mt-1.5 flex items-center gap-1 text-[9px] text-white/25">
              <ChevronRight className="w-2.5 h-2.5" />
              Click to open
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Side panels ── */}
      <AnimatePresence>
        {selNode && !showAdd && (
          <NodePanel
            key={selNode.id}
            node={selNode}
            entries={knowledgeEntries}
            onClose={() => setSelectedId(null)}
            onDelete={deleteKnowledge}
            onUpdate={updateKnowledge}
          />
        )}
        {showAdd && (
          <AddKnowledgePanel
            key="add-panel"
            onSave={addKnowledge}
            onClose={() => setShowAdd(false)}
          />
        )}
      </AnimatePresence>

      {/* Hidden tick consumer */}
      <span className="sr-only" aria-hidden>{renderTick}</span>
    </div>
  );
}
