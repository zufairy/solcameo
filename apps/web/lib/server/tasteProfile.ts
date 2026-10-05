// Taste profile — an LLM-maintained prose summary of what the operator wants.
// No ML infra: events in, one rewrite call, prose out. Injected into ideation
// (lib/server/ideation.ts) so the agent's pitches drift toward what the
// operator actually approves, edits, and gets views with.
import { callClaudeJSON } from "./kie-claude";

export interface TasteEvent { kind: string; detail: string; weight: number; }

export function buildTasteUpdatePrompt(args: { oldProse: string; events: TasteEvent[] }): { system: string; user: string } {
  const system = `You maintain a short "operator taste" profile for an autonomous video agent: a compact prose summary of what content its operator likes and dislikes, learned from their actions. Rewrite the profile to fold in the new events. Keep it under 120 words, concrete, and directly usable as guidance for idea generation ("loves X, avoids Y, prefers Z"). Reply with ONLY JSON: { "prose": "..." }.`;
  const user = `CURRENT PROFILE:\n${args.oldProse || "(none yet)"}\n\nNEW EVENTS (higher weight = stronger signal; kinds: idea_up/idea_down = explicit rating, idea_made_now = strong positive, idea_edited = learn the delta toward the edit, video_high_views = audience loved it, video_deleted = operator hated it, idea_expired = mild disinterest):\n${args.events.slice(0, 20).map((e) => `- [${e.kind}, weight ${e.weight}] ${e.detail.slice(0, 200)}`).join("\n")}\n\nRewrite the profile.`;
  return { system, user };
}

export async function updateTasteProfile(args: { oldProse: string; events: TasteEvent[]; apiKey?: string }): Promise<string | null> {
  if (!args.events.length) return null;
  try {
    const { system, user } = buildTasteUpdatePrompt(args);
    const raw = await callClaudeJSON<{ prose?: string }>({ system, user, maxTokens: 400, apiKey: args.apiKey });
    const prose = String(raw?.prose ?? "").trim();
    return prose ? prose.slice(0, 1200) : null;
  } catch (e) {
    console.warn("[tasteProfile] update failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
