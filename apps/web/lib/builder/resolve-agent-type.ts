import type { AgentType } from "./agentTypes";

type PersistedAgentTypeInput = {
  agentType?: string | null;
  clipConfig?: unknown;
  niche?: string | null;
};

/** Resolve saved agents, including clipping records created before agentType existed. */
export function resolvePersistedAgentType({
  agentType,
  clipConfig,
  niche,
}: PersistedAgentTypeInput): AgentType {
  const rawType = agentType?.toLowerCase();
  if (rawType === "worker" || rawType === "trader" || rawType === "influencer") {
    return rawType;
  }
  if (rawType === "clipping" || rawType === "clipper" || clipConfig != null) return "clipping";
  if (niche === "finance") return "trader";
  return "influencer";
}
