"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
} from "@xyflow/react";
import { Wand2, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClippingStore } from "@/components/builder/clipping-flow/store/clipping-store";
import { TemplatePicker } from "@/components/builder/clipping-flow/palette/template-picker";
import type { ClipTemplate } from "@/components/builder/clipping-flow/data/templates";
import { nodeTypes } from "./node-types";
import type { CatalogKey } from "@/components/builder/clipping-flow/data/node-catalog";
import type { VelloNode } from "@/components/builder/clipping-flow/types/clipping";

/**
 * Minimap fill colors keyed by node kind. Mirror canvas/node-visual.ts +
 * clipping-flow.css if a kind is added/renamed.
 */
const minimapColor = (n: VelloNode) => {
  switch (n.data?.kind) {
    case "source":
      return "#84cc16";
    case "compose":
      return "#a78bfa";
    case "skill":
      return "#fbbf24";
    case "publish":
      return "#38bdf8";
    default:
      return "#8884a0";
  }
};

function Canvas({ onApplyTemplate }: { onApplyTemplate?: (t: ClipTemplate) => void }) {
  const nodes = useClippingStore((s) => s.nodes);
  const edges = useClippingStore((s) => s.edges);
  const selectedId = useClippingStore((s) => s.selectedId);
  const onNodesChange = useClippingStore((s) => s.onNodesChange);
  const onEdgesChange = useClippingStore((s) => s.onEdgesChange);
  const onConnect = useClippingStore((s) => s.onConnect);
  const setSelected = useClippingStore((s) => s.setSelected);
  const addNodeFromCatalog = useClippingStore((s) => s.addNodeFromCatalog);
  const addSkillNodeAt = useClippingStore((s) => s.addSkillNodeAt);
  const tidyLayout = useClippingStore((s) => s.tidyLayout);
  const undo = useClippingStore((s) => s.undo);
  const redo = useClippingStore((s) => s.redo);
  const canUndo = useClippingStore((s) => s.past.length > 0);
  const canRedo = useClippingStore((s) => s.future.length > 0);
  // Canvas is read-only while a pipeline runs (the store also guards mutators).
  const running = useClippingStore((s) => s.runStatus === "running");
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Highlight edges touching the selected node so you can see what connects to
  // what when you click a node. While a pipeline runs, ALL edges animate
  // (react-flow's marching-dashes) so the graph visibly "flows".
  const styledEdges = useMemo(
    () => {
      // Guarantee no orphan wire ever renders: an edge only draws when BOTH of its
      // endpoint nodes still exist. This makes a deleted node's connectors vanish
      // immediately even if a stale edge somehow lingered in the store.
      const liveIds = new Set(nodes.map((n) => n.id));
      return edges
        .filter((e) => liveIds.has(e.source) && liveIds.has(e.target))
        .map((e) => {
        const isSelected = selectedId && (e.source === selectedId || e.target === selectedId);
        return {
          ...e,
          // Smooth curved wires (bezier) instead of the stepped/right-angle
          // "smoothstep" that read as zig-zags. Force it here so saved graphs that
          // stored the old type also render as smooth curves.
          type: "default",
          // n8n-style flowing edges: animate while the pipeline runs AND when the
          // edge touches the selected node, so wiring visibly "comes alive" on click.
          animated: running || Boolean(isSelected) || e.animated,
          ...(isSelected
            ? { style: { ...(e.style ?? {}), stroke: "#7c3aed", strokeWidth: 2.5 }, zIndex: 1 }
            : {}),
        };
      });
    },
    [edges, nodes, selectedId, running]
  );

  const onTidy = useCallback(() => {
    tidyLayout();
    // Fit after the grid re-layout, but cap the zoom so cards stay readable (a small
    // graph won't blow up past ~1x, and the compact grid layout keeps a big graph
    // from zooming out to a tiny, unreadable size — roughly up to 4 cards across).
    window.setTimeout(() => fitView({ padding: 0.12, maxZoom: 1, minZoom: 0.55, duration: 350 }), 60);
  }, [tidyLayout, fitView]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (useClippingStore.getState().runStatus === "running") return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // Installed marketplace skill dragged from the palette's "Your skills"
      // section - lands as a free-floating skill node to wire up manually.
      const skillRaw = event.dataTransfer.getData("application/vello-skill");
      if (skillRaw) {
        try {
          const skill = JSON.parse(skillRaw) as { skillId?: string; name?: string };
          if (skill?.skillId && skill?.name) {
            addSkillNodeAt({ skillId: skill.skillId, name: skill.name }, position);
            return;
          }
        } catch {
          /* fall through to the catalog payload */
        }
      }
      const key = event.dataTransfer.getData("application/vello-node") as CatalogKey;
      if (!key) return;
      addNodeFromCatalog(key, position);
    },
    [screenToFlowPosition, addNodeFromCatalog, addSkillNodeAt]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const types = useMemo(() => nodeTypes, []);

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo. Ignored while typing
  // in a field so it doesn't hijack native text undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useClippingStore.getState().runStatus === "running") return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={styledEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_, node) => setSelected(node.id)}
      onPaneClick={() => setSelected(null)}
      onDrop={onDrop}
      onDragOver={onDragOver}
      nodeTypes={types}
      defaultEdgeOptions={{ type: "default" }}
      connectionRadius={28}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.3}
      nodesDraggable={!running}
      nodesConnectable={!running}
      deleteKeyCode={running ? [] : ["Backspace", "Delete"]}
      proOptions={{ hideAttribution: true }}
    >
      <Panel position="top-left">
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => undo()} disabled={!canUndo || running} title="Undo (Ctrl+Z)">
            <Undo2 className="size-3.5" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => redo()} disabled={!canRedo || running} title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="size-3.5" />
          </Button>
          <Button variant="secondary" size="sm" onClick={onTidy} disabled={running} title="Auto-arrange the graph">
            <Wand2 className="size-3.5" />
            Tidy
          </Button>
          {onApplyTemplate && <TemplatePicker variant="menu" onApply={onApplyTemplate} disabled={running} />}
        </div>
      </Panel>
      <Background
        variant={BackgroundVariant.Dots}
        gap={18}
        size={2.4}
        color="rgba(28,28,31,0.42)"
      />

      <Controls showInteractive={false} position="bottom-left" />
      {/* Compact minimap, tucked bottom-left just right of the zoom controls. */}
      <MiniMap
        position="bottom-left"
        className="clip-minimap"
        pannable
        zoomable
        nodeColor={minimapColor}
        nodeStrokeWidth={3}
        maskColor="rgba(236,229,214,0.55)"
      />
    </ReactFlow>
  );
}

export function FlowCanvas({ onApplyTemplate }: { onApplyTemplate?: (t: ClipTemplate) => void }) {
  return (
    <ReactFlowProvider>
      <Canvas onApplyTemplate={onApplyTemplate} />
    </ReactFlowProvider>
  );
}
