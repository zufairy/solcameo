import type { NodeTypes } from "@xyflow/react";
import { ClipNode } from "./clip-node";

// All node kinds render through one component that adapts to data.kind.
export const nodeTypes: NodeTypes = {
  source: ClipNode,
  compose: ClipNode,
  skill: ClipNode,
  publish: ClipNode,
};
