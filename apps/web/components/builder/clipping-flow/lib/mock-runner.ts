import type {
  VelloNode,
  VelloEdge,
  NodeStatus,
  NodeOutput,
} from "@/components/builder/clipping-flow/types/clipping";
import { makeMockOutput } from "@/components/builder/clipping-flow/data/mock-outputs";

/** Callbacks supplied to runGraph for status updates and edge animation. */
export interface RunCallbacks {
  setStatus: (
    id: string,
    status: NodeStatus,
    extra?: { output?: NodeOutput; error?: string }
  ) => void;
  animateEdge: (id: string, on: boolean) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function latencyFor(node: VelloNode): number {
  switch (node.data.kind) {
    case "source":
      return 850 + Math.random() * 350;
    case "compose":
      return 250; // fast passthrough - transparent hub
    case "skill":
      return 650 + Math.random() * 450;
    case "publish":
      return 1100 + Math.random() * 400;
    default:
      return 800;
  }
}

// Kahn topological sort; returns null when a cycle is present.
function topoSort(nodes: VelloNode[], edges: VelloEdge[]): VelloNode[] | null {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => {
    indeg.set(n.id, 0);
    adj.set(n.id, []);
  });
  edges.forEach((e) => {
    if (!indeg.has(e.source) || !indeg.has(e.target)) return;
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  });
  const queue = nodes
    .filter((n) => (indeg.get(n.id) ?? 0) === 0)
    .map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const t of adj.get(id) ?? []) {
      indeg.set(t, (indeg.get(t) ?? 0) - 1);
      if ((indeg.get(t) ?? 0) === 0) queue.push(t);
    }
  }
  if (order.length !== nodes.length) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return order.map((id) => byId.get(id)!);
}

/**
 * Walks the graph in topological order, animating each node through
 * idle -> running -> done|error with fake latency. A failed node halts
 * its downstream branch (those nodes stay idle). Returns true if all done.
 */
export async function runGraph(
  nodes: VelloNode[],
  edges: VelloEdge[],
  chaos: boolean,
  cb: RunCallbacks
): Promise<boolean> {
  const ordered = topoSort(nodes, edges);
  if (!ordered) {
    nodes.forEach((n) =>
      cb.setStatus(n.id, "error", { error: "Cycle detected in pipeline" })
    );
    return false;
  }

  const incoming = new Map<string, string[]>();
  nodes.forEach((n) => incoming.set(n.id, []));
  edges.forEach((e) => incoming.get(e.target)?.push(e.source));

  const failed = new Set<string>();
  let chaosFired = false;

  for (const node of ordered) {
    const parents = incoming.get(node.id) ?? [];
    if (parents.some((p) => failed.has(p))) {
      failed.add(node.id); // downstream of a failure stays idle
      continue;
    }

    cb.setStatus(node.id, "running");
    const out = edges.filter((e) => e.source === node.id);
    out.forEach((e) => cb.animateEdge(e.id, true));

    await sleep(latencyFor(node));

    out.forEach((e) => cb.animateEdge(e.id, false));

    const willFail =
      chaos &&
      !chaosFired &&
      node.data.kind === "skill" &&
      Math.random() < 0.6;

    if (willFail) {
      chaosFired = true;
      failed.add(node.id);
      cb.setStatus(node.id, "error", {
        error: "Skill timed out (chaos mode)",
      });
      continue;
    }

    cb.setStatus(node.id, "done", { output: makeMockOutput(node.data) });
  }

  return failed.size === 0;
}
