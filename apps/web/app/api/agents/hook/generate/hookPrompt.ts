/**
 * Pure helpers for /api/agents/hook/generate — kept OUT of route.ts because a
 * Next.js route module may only export HTTP handlers + route config (the
 * build's generated type check rejects any other export). Unit-tested in
 * ./route.test.ts.
 */
const HOOK_MAX_CHARS = 90;
// (wrapDrawtext caps at 2 lines; ~8 words is the sweet spot for a plain hook —
// relaxed to ~12 when the brief asks for something longer/emoji-heavy, see below).

export function tidyHook(raw: string): string {
  // Take the first non-empty line, strip surrounding quotes / trailing punctuation
  // spam / list markers the model sometimes adds.
  let s = (raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "").trim();
  s = s.replace(/^["'“”*\-\d.)\s]+/, "").replace(/["'“”]+$/, "").trim();
  if (s.length > HOOK_MAX_CHARS) {
    const cut = s.slice(0, HOOK_MAX_CHARS);
    const sp = cut.lastIndexOf(" ");
    s = (sp > 0 ? cut.slice(0, sp) : cut).trim();
  }
  return s;
}

export interface HookPromptArgs {
  prompt: string;
  topic?: string;
  niche?: string;
  content?: string;
  language?: string;
}

/**
 * Builds the system + user prompt. Pure (no I/O) — unit-testable.
 *
 * The operator's OWN brief is authoritative: it can ask for emoji, a specific
 * language, casual slang, ALL CAPS, whatever — none of the house defaults
 * below are hard rules, they're just what fills in when the brief doesn't
 * say. The old version hardcoded "no emojis" as an absolute rule, which
 * silently ignored a brief that explicitly asked for emoji — the exact bug
 * this fixes. `language` (the dedicated dropdown) sets the default language;
 * the prompt can still override it inline ("write it in French").
 */
export function buildHookPrompt(args: HookPromptArgs): { system: string; user: string } {
  const prompt = args.prompt.trim().slice(0, 500);
  const topic = (args.topic ?? "").trim().slice(0, 200);
  const niche = (args.niche ?? "").trim().slice(0, 120);
  const content = (args.content ?? "").trim().replace(/\s+/g, " ").slice(0, 1800);
  const language = (args.language ?? "").trim().slice(0, 60);

  const system = [
    "You write ONE short, scroll-stopping hook line for a vertical short-form video (TikTok/Reels).",
    "The OPERATOR'S BRIEF below is the instruction you must follow — it OVERRIDES every default in this system prompt whenever the two conflict.",
    "That includes: language, tone/casualness, emoji use, capitalization, slang, punctuation style — if the brief asks for it, do it, even if a default below says otherwise.",
    "DEFAULTS (used only where the brief is silent on that point): 3-8 words, punchy and specific, no hashtags, no emoji, no surrounding quotes, no trailing period, in English.",
    "The line must MATCH the video's actual content (given below as 'Video content') — never a generic hook unrelated to what's actually in the video.",
    "Reply with ONLY the hook line — nothing else, no explanation, no alternates.",
  ].join(" ");

  const user =
    `Hook brief (authoritative — follow it exactly): ${prompt}` +
    (language ? `\nDefault language (the brief above can override this): ${language}` : "") +
    (content ? `\nVideo content (what this specific clip is actually about — the hook must match it): ${content}` : "") +
    (topic ? `\nVideo topic: ${topic}` : "") +
    (niche ? `\nCreator niche: ${niche}` : "") +
    `\n\nWrite the single best hook line now.`;

  return { system, user };
}
