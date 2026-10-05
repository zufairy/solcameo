/** Rewrites an engine-neutral format prompt into the target engine's dialect.
 *  Research-backed rules (see spec "Engine Prompt Adapters"):
 *  - Veo rewards separate sentences per component, `X says: …` dialogue, and
 *    an explicit (no subtitles) — caption burn is OUR overlay pass, not the model.
 *  - Seedance rewards `Shot N:` labels with `Cut to:` transitions, <200 words.
 *  - Grok rewards one natural-language director-style paragraph, 50-200 words. */

export interface AdaptArgs {
  engineId: string;
  prompt: string;
  beats?: string[];
  dialogue?: { speaker: string; line: string }[];
}

const isVeo = (id: string) => /veo/i.test(id);
const isSeedance = (id: string) => /seedance/i.test(id);
const isGrok = (id: string) => /grok/i.test(id);

export function adaptPromptForEngine({ engineId, prompt, beats, dialogue }: AdaptArgs): string {
  if (isVeo(engineId)) {
    const parts = [prompt.trim()];
    for (const d of dialogue ?? []) parts.push(`${d.speaker} says: ${d.line}`);
    for (const b of beats ?? []) parts.push(b.trim().replace(/\.?$/, "."));
    parts.push("(no subtitles)");
    return parts.join(" ");
  }
  if (isSeedance(engineId)) {
    const shotLines = (beats ?? []).map((b, i) =>
      `${i === 0 ? "" : "Cut to: "}Shot ${i + 1}: ${b.trim()}`,
    );
    const body = [prompt.trim(), ...shotLines].join(" ");
    // Hard-trim to <200 words (Seedance degrades past that).
    const words = body.split(/\s+/);
    return words.length < 200 ? body : words.slice(0, 195).join(" ");
  }
  if (isGrok(engineId)) {
    // One flowing paragraph: fold beats into "then"-linked prose.
    const flow = (beats ?? []).join(", then ");
    return flow ? `${prompt.trim()} The scene unfolds: ${flow}.` : prompt.trim();
  }
  return prompt;
}
