export interface BrainKnowledge { title: string; content: string; tags?: string[] }
export interface BrainMemory { kind: string; summary: string; importance: number }
export interface BrainSkill { name: string; instructions: string }

export interface AgentBrain {
  knowledge: BrainKnowledge[];
  memories: BrainMemory[];
  skills: BrainSkill[];
}

/**
 * Assemble the agent's "brain" for creative generation: knowledge ranked by
 * relevance to the topic (then kept compact), recent memories, and ALL installed
 * skills (catalog + custom). Pure — callers fetch the raw data.
 */
export function buildAgentBrain(args: {
  topic: string;
  knowledge: BrainKnowledge[];
  memories: BrainMemory[];
  skills: BrainSkill[];
}): AgentBrain {
  const words = args.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const score = (k: BrainKnowledge) => {
    const blob = `${k.title} ${k.content} ${(k.tags ?? []).join(" ")}`.toLowerCase();
    return words.reduce((n, w) => (blob.includes(w) ? n + 1 : n), 0);
  };
  const knowledge = [...args.knowledge]
    .map((k) => ({ k, s: score(k) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 6)
    .map(({ k }) => k);

  const memories = [...args.memories]
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 6);

  const skills = args.skills.filter((s) => s.name && s.instructions).slice(0, 8);

  return { knowledge, memories, skills };
}

/** Render the brain into a compact prompt block for the director + script. */
export function brainToPromptBlock(brain: AgentBrain): string {
  const k = brain.knowledge.map((x) => `- ${x.title}: ${x.content.slice(0, 200).replace(/\s+/g, " ").trim()}`).join("\n");
  const m = brain.memories.map((x) => `- [${x.kind}] ${x.summary}`).join("\n");
  const s = brain.skills.map((x) => `- ${x.name}: ${x.instructions.slice(0, 240).replace(/\s+/g, " ").trim()}`).join("\n");
  return [
    k ? `KNOWLEDGE BASE (cite these — don't invent):\n${k}` : "",
    s ? `ACTIVE SKILLS (operating style — obey these):\n${s}` : "",
    m ? `MEMORIES (lessons/preferences):\n${m}` : "",
  ].filter(Boolean).join("\n\n");
}
