// Parsing for the action blocks the agent chat model appends to its replies
// ([SAVE_IDEA]{…}[/SAVE_IDEA], [OPEN_BUILDER]{…}, …). Used by /api/agents/chat.

/** Every action tag the chat model may emit — swept from the visible reply. */
export const ACTION_TAGS = ["TASK_OFFER", "JOIN_CAMPAIGN", "POST_CONTENT", "SAVE_IDEA", "UPDATE_BIBLE", "BIBLE_PATCH", "SHOW_VIDEOS", "OPEN_BUILDER", "GENERATE_VIDEO"];

/**
 * Find `[TAG]{json}[/TAG]` in a model reply — tolerant of what models actually
 * emit: a MISSING closing tag (the raw "[OPEN_BUILDER]{"tab":"ideas"}" that
 * leaked into chat), nested JSON (BIBLE_PATCH ops — a lazy `\{…?\}` regex cut
 * those at the first `}`), and whitespace between the parts. Returns
 * `[rawBlock, json]` (RegExpMatchArray-shaped, so callers strip `[0]` and
 * parse `[1]`) or null.
 */
export function extractActionBlock(text: string, tag: string, from = 0): [string, string] | null {
  const open = `[${tag}]`;
  const start = text.indexOf(open, from);
  if (start < 0) return null;
  let i = start + open.length;
  while (i < text.length && /\s/.test(text[i])) i++;
  let json = "";
  if (text[i] === "{") {
    let depth = 0;
    let inStr = false;
    let j = i;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === "\\") j++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { j++; break; }
    }
    json = text.slice(i, j);
    i = j;
  }
  const close = `[/${tag}]`;
  let k = i;
  while (k < text.length && /\s/.test(text[k])) k++;
  const end = text.startsWith(close, k) ? k + close.length : i;
  return [text.slice(start, end), json || "{}"];
}

/** Every occurrence of a tag (e.g. several [SAVE_IDEA] blocks in one reply). */
export function extractAllActionBlocks(text: string, tag: string, max = 8): [string, string][] {
  const out: [string, string][] = [];
  let from = 0;
  while (out.length < max) {
    const b = extractActionBlock(text, tag, from);
    if (!b) break;
    out.push(b);
    from = text.indexOf(b[0], from) + Math.max(1, b[0].length);
  }
  return out;
}

/** Last line of defence: no action tag (well-formed, unclosed or orphaned)
 *  may ever reach the chat bubble as raw text. */
export function stripActionTags(text: string): string {
  let t = text;
  for (const tag of ACTION_TAGS) {
    for (;;) {
      const b = extractActionBlock(t, tag);
      if (!b) break;
      t = t.replace(b[0], "");
    }
    t = t.split(`[/${tag}]`).join("");
  }
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
