import type { VelloNode, VelloEdge } from "@/components/builder/clipping-flow/types/clipping";
import { clipHistoryKey } from "./clipHistoryStorage";

export interface StoredGraph { nodes: VelloNode[]; edges: VelloEdge[]; }

export const graphKey = (mintKey: string) => `vello-clipgraph:${mintKey}`;

/** Pre-mint clips are namespaced by sessionId/"draft"; on mint the canvas re-keys
 *  to mintAddress, orphaning that work. Copy the graph + history buckets from the
 *  old namespace to the new one so nothing is lost. Idempotent + non-destructive:
 *  only copies when the source exists and the target is still EMPTY (never clobbers
 *  a real minted namespace), and leaves the source in place. Call this BEFORE the
 *  canvas hydrates the new key. */
export function migrateClipNamespace(fromKey: string, toKey: string): void {
  if (!fromKey || !toKey || fromKey === toKey) return;
  try {
    for (const key of [graphKey, clipHistoryKey]) {
      const src = localStorage.getItem(key(fromKey));
      if (src && !localStorage.getItem(key(toKey))) localStorage.setItem(key(toKey), src);
    }
  } catch { /* SSR / quota - ignore */ }
}

export function saveGraph(mintKey: string, graph: StoredGraph): void {
  try { localStorage.setItem(graphKey(mintKey), JSON.stringify(graph)); } catch { /* quota / SSR - ignore */ }
}

/** Strip run-scoped state (status/output/error) from loaded nodes so a graph
 *  persisted mid-run doesn't restore a forever-spinning node. Statuses are
 *  run-scoped, not graph-scoped: always come back idle. Shared by the
 *  localStorage loader AND the Convex loader (clipGraphs.getByKey).
 *
 *  Also DEDUPES node ids (keep first): a graph saved by an older build could
 *  contain two nodes sharing an id (the id-collision bug), which made the
 *  inspector open the wrong node's settings. Dropping the duplicate self-heals
 *  those graphs on load. */
export function sanitizeLoadedNodes(nodes: VelloNode[]): VelloNode[] {
  const seen = new Set<string>();
  const out: VelloNode[] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push({
      ...n,
      data: { ...n.data, status: "idle" as const, output: undefined, error: undefined },
    });
  }
  return out;
}

export function loadGraph(mintKey: string): StoredGraph | null {
  try {
    const raw = localStorage.getItem(graphKey(mintKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    const graph = parsed as StoredGraph;
    return { edges: graph.edges, nodes: sanitizeLoadedNodes(graph.nodes) };
  } catch { return null; }
}
