import { callGemini35Text } from "@/lib/server/kie-gemini";

/**
 * Web Search integration (Video Director → Integrations). Fetches a short,
 * CURRENT, factual research brief for the video's topic via Gemini's Google
 * Search grounding (lib/server/kie-gemini.ts — grounding is on by default),
 * so a script written after this call is anchored to what's actually true
 * right now, not just the model's training data.
 *
 * Deliberately format-agnostic: this returns plain research facts, not a
 * script or a style. The caller folds it into `campaignContext`, the SAME
 * free-text channel that already feeds both `planCreativeBrief` (the creative
 * decision — format/angle/structure) and `generateFittedScript` (the actual
 * script) — so live data reaches BOTH the decision and the writing step,
 * regardless of whether the resolved format ends up as an episodic cartoon,
 * a UGC talking head, or anything else the operator's Director settings pick.
 *
 * Best-effort: any failure (no key, network, empty result) returns "" so a
 * search outage never blocks a video from generating.
 */
export async function fetchLiveWebContext(topic: string, apiKey?: string): Promise<string> {
  return (await fetchLiveWebResearch(topic, apiKey)).context;
}

export interface LiveWebResearch {
  /** Grounded factual brief (plain bullets), "" when unavailable. */
  context: string;
  /** Direct image URLs found alongside the facts — downloadable references
   *  (news photos, official stills) the render can use as visual anchors.
   *  Best-effort; often empty. */
  imageUrls: string[];
  /** Source article/page URLs the model reports its facts came from — asked
   *  for explicitly in the prompt, same best-effort mechanism as imageUrls
   *  (Kie's Gemini proxy doesn't expose native grounding-citation metadata,
   *  only the generated text, so this is the only channel available). Not a
   *  cryptographic guarantee the model didn't misremember a URL, but it's the
   *  same trust level already used for REFERENCE IMAGES, which has proven
   *  reliable in practice. Downstream callers should still treat this as
   *  "what the model says its source was," not a verified citation. */
  sourceUrls: string[];
}

/** Directly-fetchable image URL (real image extension, http(s)). */
const IMAGE_URL_RE = /https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp)(?:\?[^\s"'<>]*)?/gi;
// Any http(s) URL — used to pull the SOURCE ARTICLES section's links. Does
// NOT exclude ")"/"]" from the URL body: real article URLs routinely contain
// them (e.g. Wikipedia's "Constitution_(Amendment)_Bill_2026"), and excluding
// them truncated those URLs mid-slug — a truncated URL 404s, silently
// dropping the headline-screenshot overlay for that idea. Trailing
// punctuation/brackets are trimmed separately below instead.
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

/** Strip sentence-trailing punctuation a model's prose puts after a URL
 *  ("...see https://en.wikipedia.org/wiki/Foo.", "(https://x.com/y)") without
 *  cutting URL-internal punctuation. Only trims a trailing bracket/paren when
 *  it's unbalanced within the match — a URL that itself ends in a balanced
 *  "...(Amendment)" keeps its closing paren. */
function trimTrailingUrlPunct(url: string): string {
  let u = url;
  while (u.length) {
    const last = u[u.length - 1];
    if (".,;:!?\"'".includes(last)) { u = u.slice(0, -1); continue; }
    if (last === ")" && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) { u = u.slice(0, -1); continue; }
    if (last === "]" && (u.match(/\[/g)?.length ?? 0) < (u.match(/\]/g)?.length ?? 0)) { u = u.slice(0, -1); continue; }
    break;
  }
  return u;
}

/**
 * Grounded research + reference images/sources in one call. The prompt asks
 * for a REFERENCE IMAGES section (direct image links, e.g. a news photo of
 * the court ruling a law-commentary video is covering) and a SOURCE ARTICLES
 * section (the actual page URL(s) the facts came from, for on-screen
 * attribution) — every URL found in each section is returned separately so
 * the caller can download images / show a citation link. The facts section
 * itself is returned WITHOUT either section so scripts don't quote raw URLs.
 */
export async function fetchLiveWebResearch(topic: string, apiKey?: string): Promise<LiveWebResearch> {
  const t = topic.trim();
  if (!t) return { context: "", imageUrls: [], sourceUrls: [] };
  try {
    const user = `Search the web and give a short, CURRENT, factual research brief for a short-form video about: "${t}".
Report what's actually true / happening right now — real facts, numbers, prices, dates, names, recent news or events relevant to this topic. 5-8 plain bullet points, no markdown headers, no fluff, no video-script writing or scene direction — just the grounded facts a scriptwriter should know before writing, dated as of today.
Then add a section titled exactly "REFERENCE IMAGES:" with up to 3 DIRECT image URLs (ending in .jpg/.jpeg/.png/.webp) of real photos relevant to these facts — news photos, official portraits, product shots. Only include URLs that link straight to the image file itself; if you can't find any, write "REFERENCE IMAGES: none".
Then add a final section titled exactly "SOURCE ARTICLES:" with up to 3 URLs of the actual news article(s)/page(s) these facts came from — the real page a viewer could click to read the full story, one per line. If you can't identify any, write "SOURCE ARTICLES: none".`;
    const raw = (await callGemini35Text({ user, apiKey, search: true })).trim();
    const imageSection = raw.match(/REFERENCE IMAGES:([\s\S]*?)(?=SOURCE ARTICLES:|$)/i)?.[1] ?? "";
    const sourceSection = raw.match(/SOURCE ARTICLES:([\s\S]*)$/i)?.[1] ?? "";
    const imageUrls = Array.from(new Set((imageSection.match(IMAGE_URL_RE) ?? []).map(trimTrailingUrlPunct))).slice(0, 3);
    const sourceUrls = Array.from(new Set((sourceSection.match(URL_RE) ?? []).map(trimTrailingUrlPunct))).slice(0, 3);
    // Strip both sections + any raw URLs out of the facts brief.
    const context = raw
      .replace(/REFERENCE IMAGES:[\s\S]*$/i, "")
      .replace(URL_RE, "")
      .trim()
      .slice(0, 4000);
    return { context, imageUrls, sourceUrls };
  } catch (e) {
    console.warn(`[webResearch] live search failed: ${e instanceof Error ? e.message : e}`);
    return { context: "", imageUrls: [], sourceUrls: [] };
  }
}
