/**
 * Second Brain — deterministic relevance gate + consolidation helpers.
 *
 * The agent builder used to write a knowledge node on every chat turn (with a
 * `Date.now()` localId, so the upsert never matched → a new node per message).
 * These pure helpers let the builder instead:
 *   1. decide whether a chat turn carries durable knowledge worth keeping, and
 *   2. merge that knowledge as a deduped bullet into a small set of canonical
 *      per-session category nodes (References, Conversation Notes, …).
 *
 * Everything here is pure and synchronous so it can be unit-tested in isolation
 * and reused on both client and server.
 */

export type ChatTurnKind = "reference" | "note" | "skip";

export interface ChatTurnClassification {
  kind: ChatTurnKind;
  /** Trimmed source text. */
  text: string;
  /** First URL found, when kind === "reference". */
  url?: string;
}

// Short acknowledgements / control phrases that should never become knowledge.
const ACK_PATTERN =
  /^(ok(ay)?|thanks?|thank you|cool|nice|great|sure|yes|no|yep|nope|yeah|got it|go|do it|done|continue|next|proceed)\b/i;

// A QUESTION is a request for info, never a durable note. Detect by trailing "?"
// or a leading interrogative word.
const QUESTION_START =
  /^(how|what|what's|whats|why|when|where|who|who's|whos|which|whose|can|could|would|should|do|does|did|is|are|am|was|were|will|shall|may|might|have|has|had)\b/i;

// A COMMAND/ACTION request ("post …", "make a video …", "find me a job") tells
// the agent to DO something — it is not knowledge to remember.
const COMMAND_START =
  /^(post|share|tweet|publish|upload|make|create|generate|gen|draft|write|build|do|run|execute|fire|start|launch|find|search|join|apply|check|open|show|give|go|delete|remove|cancel|stop|pause|resume|set|change|update|add|connect|mint|fund|swap|trade|buy|sell|schedule|reply|comment|dm|send|help|let'?s|please|try|use|turn)\b/i;

// Signals of a DURABLE fact / preference / rule worth keeping for the future.
const DURABLE_KEYWORD =
  /\b(niche|audience|avoid|prefer|preferr?ed|tone|style|aesthetic|vibe|brand|target|language|budget|goal|pillar|format|catchphrase|backstory|belief|value|mission|persona|voice|archetype|handle|name is|based in|grew up|founded|specializ|focus(es|ed)? on|always (?:post|use|do|avoid)|never (?:post|use|do|mention)|i (?:prefer|like|love|hate|avoid|always|never|am|'m)\b|my (?:niche|audience|brand|goal|style|voice|name|tone|story|handle))\b/i;

const URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/i;

/**
 * Decide what (if anything) a user chat turn should contribute to the brain.
 *
 * Only durable, future-useful knowledge is kept: a reference link, or a genuine
 * fact / preference / rule about the persona or strategy. Questions, action
 * requests ("post this", "make a video"), and acknowledgements are dropped — we
 * never want the graph cluttered with conversational chatter.
 */
export function classifyChatTurn(raw: string): ChatTurnClassification {
  const text = (raw ?? "").trim();
  if (!text) return { kind: "skip", text: "" };

  const urlMatch = text.match(URL_PATTERN);
  if (urlMatch) {
    return { kind: "reference", text, url: urlMatch[0] };
  }

  // Questions → not knowledge.
  if (text.endsWith("?") || QUESTION_START.test(text)) return { kind: "skip", text };
  // Action / command requests → not knowledge.
  if (COMMAND_START.test(text)) return { kind: "skip", text };
  // Acknowledgements / filler → not knowledge.
  if (ACK_PATTERN.test(text)) return { kind: "skip", text };

  // Keep ONLY genuine durable facts / preferences / rules. No length-based
  // fallback — a long sentence isn't automatically worth saving.
  if (DURABLE_KEYWORD.test(text)) return { kind: "note", text };

  return { kind: "skip", text };
}

/** Normalize a line for dedup: lowercase, collapse whitespace, strip edge punctuation. */
export function normalizeForDedup(s: string): string {
  return s
    .toLowerCase()
    .replace(/^[\s\-*•]+/, "")        // leading bullet markers / space
    .replace(/[\s.!?,;:]+$/, "")      // trailing punctuation / space
    .replace(/\s+/g, " ")              // collapse internal whitespace
    .trim();
}

/**
 * Append `bullet` to `existingContent` as a `- bullet` line, unless an
 * equivalent line is already present. Returns `changed: false` when it was a
 * duplicate so the caller can skip the write.
 */
export function mergeBullet(
  existingContent: string,
  bullet: string,
): { content: string; changed: boolean } {
  const base = (existingContent ?? "").replace(/\s+$/, "");
  const cleanBullet = bullet.trim();
  if (!cleanBullet) return { content: base, changed: false };

  const target = normalizeForDedup(cleanBullet);
  const existingLines = base.split("\n");
  const already = existingLines.some((ln) => {
    const m = ln.match(/^\s*[-*•]\s+(.*)$/);
    if (!m) return false;
    return normalizeForDedup(m[1]) === target;
  });
  if (already) return { content: existingContent, changed: false };

  return { content: `${base}\n- ${cleanBullet}`, changed: true };
}

/** Build the bullet body for a saved reference URL. */
export function referenceBullet(url: string, note?: string): string {
  return note ? `${url} — ${note}` : url;
}
