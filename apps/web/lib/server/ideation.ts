// Ideation — heartbeat stage 1. Turns the bible's content engine (live news
// search + evergreen pools + series threads) into scored idea candidates.
import { callClaudeJSON } from "./kie-claude";
import { fetchLiveWebResearch } from "./webResearch";
import { bibleVideoStyles, type ShowBible } from "../builder/showBible";

export interface IdeaCandidate {
  headline: string; angle: string; whyNow?: string;
  source: "news" | "evergreen" | "series" | "user";
  /** REAL article/page URLs this idea is grounded in — for on-screen/UI
   *  citation (Ideas tab source links, video reference-image overlay). NOT
   *  fact text — see newsFacts for that. */
  sourceRefs?: string[];
  /** Plain-text grounded fact bullets from the research step — what the
   *  SCRIPT stage actually quotes from (lib/server/videoScript.ts's "LIVE
   *  FACTS" block). Kept separate from sourceRefs so a URL never gets fed to
   *  the script writer as if it were a fact. */
  newsFacts?: string[];
  /** A real photo the research step found alongside the facts (news photo,
   *  official portrait) — used as the video's on-screen reference-image
   *  overlay so viewers see what's being discussed, not just hear it. */
  referenceImageUrl?: string;
  format: string; suggestedDurationSec: number;
  score: number; expiresAt?: number;
  /** Influencer balance slot this idea fills. */
  intent: "entertain" | "value" | "promo";
  /** Which of the bible's video styles this idea is FOR — the production stage
   *  resolves this style's exact recipe (format/structure/hook/duration) so the
   *  show keeps posting each style's kind of content on its weighted cadence. */
  styleId: string;
  /** Campaign-native promo: validated against the offered campaign set. */
  campaignId?: string; campaignTitle?: string;
}

export interface CampaignOffer { id: string; title: string; brandName: string; brief: string; }

const NEWS_TTL_MS = 24 * 3600 * 1000;
const SOURCES = new Set(["news", "evergreen", "series", "user"]);

export function buildIdeationPrompt(args: {
  bible: ShowBible; tasteProse: string; newsContext: string;
  recentHeadlines: string[]; recentScriptTopics: string[]; count: number;
  /** Intents of recently PRODUCED ideas, newest first — the batch rebalances against these. */
  recentIntents?: string[];
  /** Joinable brand campaigns the persona could promote natively. */
  campaigns?: CampaignOffer[];
  /** An operator's ad-hoc chat request ("make a video about X") — the idea MUST
   *  honor it, reinterpreted through the bible's premise/voice/formats rather than
   *  taken as a literal override. Used by the copilot's ad-hoc generate path; absent
   *  for the autonomous heartbeat, which has no operator ask to reconcile. */
  requestedAngle?: string;
}): { system: string; user: string } {
  const { bible, tasteProse, newsContext, recentHeadlines, recentScriptTopics, count } = args;
  const mix = bible.contentMix;
  const recentIntents = args.recentIntents ?? [];
  const campaigns = args.campaigns ?? [];
  const system = `You are the ideation engine for an autonomous short-form video show. Generate specific, scroll-stopping episode ideas that fit the show bible. Reply with ONLY a JSON object — no fences, no commentary.`;
  const styles = bibleVideoStyles(bible);
  const user = `SHOW BIBLE
Premise: ${bible.premise}
Formats: ${bible.format.kinds.join(", ")}
Voice: ${bible.voice.tone}${bible.voice.language ? ` (${bible.voice.language})` : ""}
Evergreen pools: ${bible.contentEngine.evergreenPools.join("; ") || "(none)"}

VIDEO STYLES (the show's recurring kinds of videos — every idea is written FOR one of these so the feed keeps delivering each style on cadence):
${styles.map((s) => `- styleId=${s.id} · "${s.name}" · format=${s.format}${s.structure ? ` · structure=${s.structure}` : ""}${s.hookStyle ? ` · hook=${s.hookStyle}` : ""}${s.durationSec ? ` · ${s.durationSec.min}-${s.durationSec.max}s` : ""} · weight=${s.weight ?? 1}`).join("\n")}
${tasteProse ? `\nOPERATOR TASTE (weight ideas toward this — it is learned from their ratings):\n${tasteProse.slice(0, 800)}\n` : ""}${newsContext ? `\nLIVE NEWS CONTEXT (from web search, TODAY — news-sourced ideas MUST come from these real items):\n${newsContext.slice(0, 3500)}\n` : ""}${recentHeadlines.length ? `\nEXISTING/RECENT IDEAS (do NOT duplicate or lightly rephrase any of these):\n${recentHeadlines.slice(0, 20).map((h) => `- ${h}`).join("\n")}\n` : ""}${recentScriptTopics.length ? `\nRECENTLY PRODUCED VIDEOS (pick clearly DIFFERENT subjects):\n${recentScriptTopics.slice(0, 10).map((t) => `- ${t}`).join("\n")}\n` : ""}${args.requestedAngle ? `\nOPERATOR REQUEST (you MUST honor this — it is what they asked for right now): "${args.requestedAngle}"\nReinterpret it through the show's premise/voice/formats above rather than dropping the bible — e.g. a generic topic becomes THIS show's specific angle on it, in one of the listed formats. Do not ignore the request; do not ignore the bible either.\n` : ""}
CONTENT MIX (an influencer audience churns on hard sell — keep this balance): ${mix.entertain}% entertain (pure watchability), ${mix.value}% value (teach/inform), ${mix.promo}% promo (product/brand, persona-native).${recentIntents.length ? ` Recently produced intents (newest first): ${recentIntents.slice(0, 8).join(", ")} — weight this batch toward whatever the mix is currently short of.` : ""}
${campaigns.length ? `
OPEN BRAND CAMPAIGNS (optional targets for promo-intent ideas — set "campaignId" to promote one):
${campaigns.map((c) => `- campaignId=${c.id} · "${c.title}" by ${c.brandName} · ${c.brief.slice(0, 140)}`).join("\n")}
A campaign promo idea is never a hard ad: the persona folds the product into their normal format (a skit where it appears, a react where it solves the problem) — the audience should enjoy it even if they skip the product.
` : ""}
Generate ${count} ideas. RULES:
- Each idea: a concrete headline (what the episode is), an angle (the specific take, 1-3 sentences), whyNow when time-sensitive.
- "styleId": one of [${styles.map((s) => s.id).join(", ")}]. EVERY idea is written for exactly one style — its headline/angle must FIT that style's format and structure. Distribute the batch proportionally to the styles' weights (weight 2 gets ~twice as many ideas as weight 1).
- "source": "news" ONLY when grounded in the LIVE NEWS CONTEXT above (then fill sourceRefs with the EXACT url(s) from that context's SOURCES list this idea is grounded in — copy them verbatim, never invent or paraphrase a URL); "evergreen" otherwise. Any idea written for a "news-commentary" style MUST be "news" and grounded in a real item from LIVE NEWS CONTEXT — that style's whole premise is reacting to an actual current headline, never a made-up or generic one.
- "suggestedDurationSec": within the chosen style's second range shown above.
- "score" 0-100: fit to premise + operator taste + freshness + how different it is from the recent lists.
- "intent": "entertain" | "value" | "promo" per the CONTENT MIX above. "campaignId" only on promo ideas targeting a listed campaign.
Return ONLY: { "ideas": [ { "headline": "...", "angle": "...", "whyNow": "...", "styleId": "...", "source": "news", "sourceRefs": ["..."], "suggestedDurationSec": 40, "score": 80, "intent": "entertain", "campaignId": null } ] }`;
  return { system, user };
}

/** Validate + clamp raw LLM candidates against the bible. Exported for tests. */
const INTENTS = new Set(["entertain", "value", "promo"]);

export function coerceIdeaCandidates(
  raw: unknown,
  bible: ShowBible,
  campaigns: CampaignOffer[] = [],
  /** Real citation URLs actually returned by search grounding this run — the
   *  allowlist sourceRefs is checked against. A model-supplied URL not in this
   *  set is dropped rather than trusted (mirrors pickCorrelatedPermalink's
   *  "never guess" rule in lib/server/uploadPost.ts): the LLM can paraphrase a
   *  fact but must not be trusted to recall a URL correctly from memory. */
  knownSourceUrls: Set<string> = new Set(),
): IdeaCandidate[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: IdeaCandidate[] = [];
  for (const item of arr) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const headline = String(r.headline ?? "").trim();
    const angle = String(r.angle ?? "").trim();
    if (!headline || !angle) continue;
    const source = (SOURCES.has(String(r.source)) ? String(r.source) : "evergreen") as IdeaCandidate["source"];
    // Bind the idea to one of the bible's video styles: the LLM's styleId when it
    // exists, else the style matching the idea's format, else the first style.
    // The style then OWNS the idea's format + duration range so production
    // renders exactly the kind of video the style defines.
    const styles = bibleVideoStyles(bible);
    const style = styles.find((s) => s.id === String(r.styleId ?? "").trim())
      ?? styles.find((s) => s.format === String(r.format ?? "").trim())
      ?? styles[0];
    const format = style?.format
      ?? (bible.format.kinds.includes(String(r.format)) ? String(r.format) : bible.format.kinds[0]);
    const range = style?.durationSec ?? bible.cadence.perFormatDuration[format] ?? { min: 16, max: 32 };
    const mid = Math.round((range.min + range.max) / 2);
    const requested = Math.round(Number(r.suggestedDurationSec ?? mid)) || mid;
    const dur = Math.max(range.min, Math.min(range.max, requested));
    out.push({
      headline: headline.slice(0, 160),
      angle: angle.slice(0, 500),
      ...(String(r.whyNow ?? "").trim() ? { whyNow: String(r.whyNow).trim().slice(0, 300) } : {}),
      source,
      ...(() => {
        if (!Array.isArray(r.sourceRefs)) return {};
        const verified = (r.sourceRefs as unknown[])
          .map(String)
          .filter((u) => knownSourceUrls.has(u))
          .slice(0, 5);
        return verified.length ? { sourceRefs: verified } : {};
      })(),
      format,
      styleId: style?.id ?? format,
      suggestedDurationSec: dur,
      score: Math.max(0, Math.min(100, Math.round(Number(r.score ?? 50)) || 0)),
      intent: (INTENTS.has(String(r.intent)) ? String(r.intent) : "entertain") as IdeaCandidate["intent"],
      ...(() => {
        const offered = campaigns.find((c) => c.id === String(r.campaignId ?? "").trim());
        return offered ? { campaignId: offered.id, campaignTitle: offered.title } : {};
      })(),
      ...(source === "news" ? { expiresAt: Date.now() + NEWS_TTL_MS } : {}),
    });
  }
  return out;
}

export async function generateIdeas(args: {
  bible: ShowBible; tasteProse: string;
  recentHeadlines: string[]; recentScriptTopics: string[];
  openThreads?: string[]; count?: number; apiKey?: string;
  recentIntents?: string[]; campaigns?: CampaignOffer[];
  requestedAngle?: string;
}): Promise<IdeaCandidate[]> {
  const { bible } = args;
  // Floor was 3 unconditionally — wasted LLM output on the ad-hoc copilot path
  // (video-script/route.ts requests count:1 for a single on-premise topic and
  // only ever reads candidates[0]) generating 2 ideas nobody uses. Heartbeat
  // callers (ideaPipeline.ts) never pass a count below 3 anyway, so this only
  // changes behavior for genuine single-idea requests.
  const count = Math.max(1, Math.min(10, args.count ?? 6));
  // The onboarding wizard never writes contentEngine.newsQueries (it only
  // collects format.kinds) — so a show whose format includes "news-commentary"
  // can reach here with newsQueries: [] even though that format's whole
  // premise is "react to a real current headline" and its scriptRecipe
  // promises an on-screen source link. Without a query, fetchLiveWebResearch
  // never runs, no sourceRefs/referenceImageUrl exist, and news-commentary
  // ideas silently degrade to unsourced "evergreen" ones. Derive a
  // premise-scoped query as a fallback so the format's promise still holds
  // even when the wizard-authored bible never configured search explicitly.
  const usesNewsFormat = bible.format.kinds.includes("news-commentary")
    || bibleVideoStyles(bible).some((s) => s.format === "news-commentary");
  const derivedQueries = usesNewsFormat && !bible.contentEngine.newsQueries.length
    ? [`latest news today: ${bible.premise.slice(0, 120)}`]
    : [];
  // Live search per news query — concurrent, best-effort (each returns "" on failure).
  const queries = (bible.contentEngine.newsQueries.length ? bible.contentEngine.newsQueries : derivedQueries).slice(0, 3);
  const research = await Promise.all(queries.map((q) => fetchLiveWebResearch(q, args.apiKey)));
  // Union of every article URL the research step reported for its facts — the
  // only URLs an idea's sourceRefs may cite (coerceIdeaCandidates drops
  // anything else). Not a verified citation (see LiveWebResearch.sourceUrls),
  // but still worth cross-checking: the ideation LLM is a SEPARATE call and
  // must not invent its own URL on top of what research already found.
  const knownSourceUrls = new Set<string>();
  for (const r of research) for (const u of r.sourceUrls) knownSourceUrls.add(u);
  // First real photo any query turned up — the reference-image overlay's
  // source. Order-of-queries is the only ranking signal available; good
  // enough since queries are already niche-scoped by the show bible.
  const referenceImageUrl = research.flatMap((r) => r.imageUrls)[0];
  const newsContext = research
    .map((r, i) => (r.context ? `[query: ${queries[i]}]\n${r.context}` : ""))
    .filter(Boolean)
    .join("\n\n")
    + (knownSourceUrls.size
      ? `\n\nSOURCES (the ONLY urls you may put in a "news" idea's sourceRefs — copy exact url, never invent one):\n${[...knownSourceUrls].map((u) => `- ${u}`).join("\n")}`
      : "");
  const threadLines = (args.openThreads ?? []).slice(0, 5);
  const { system, user } = buildIdeationPrompt({
    bible,
    tasteProse: args.tasteProse,
    newsContext: newsContext + (threadLines.length ? `\n\nOPEN SERIES THREADS (continuation ideas welcome, source "series"):\n${threadLines.map((l) => `- ${l}`).join("\n")}` : ""),
    recentHeadlines: args.recentHeadlines,
    recentScriptTopics: args.recentScriptTopics,
    recentIntents: args.recentIntents,
    campaigns: args.campaigns,
    requestedAngle: args.requestedAngle,
    count,
  });
  try {
    const raw = await callClaudeJSON<{ ideas?: unknown }>({ system, user, maxTokens: 2200, apiKey: args.apiKey });
    const candidates = coerceIdeaCandidates(raw?.ideas, bible, args.campaigns ?? [], knownSourceUrls);
    // The ideation LLM rarely reproduces a long URL verbatim across this
    // separate call (asking it to "quote" a source reliably doesn't hold up
    // in practice), so a "news" idea's sourceRefs come back empty far more
    // often than the research step actually had sources available. Rather
    // than let the Ideas tab show no reference link whenever that happens,
    // fall back to the research batch's own real, current source list — every
    // "news" idea IS grounded in this exact batch's LIVE NEWS CONTEXT, so
    // these links are honest even without per-idea attribution.
    const fallbackRefs = [...knownSourceUrls].slice(0, 3);
    // Fact bullets for the SCRIPT stage (videoScript.ts's "LIVE FACTS" block).
    const factLines = research.flatMap((r) => (r.context ? r.context.split(/\n+/).filter((l) => l.trim().startsWith("*") || l.trim().startsWith("-")) : []));
    // Per-idea relevance matching. The old fallback attached the BATCH-level
    // union (same sourceRefs list + same 8 fact lines on every idea), so an
    // idea about story A could carry story B's URL as sourceRefs[0] — which
    // run-task then SCREENSHOTS for the on-video overlay ("screenshot of a
    // different website"), while the script got grounded in a mixed-story
    // fact pile ("what the agent says doesn't match the overlay"). Rank both
    // by keyword overlap with THIS idea's headline+angle so sourceRefs[0] is
    // the article the idea is actually about and the facts are its facts.
    const STOP = new Set(["the","a","an","and","or","of","to","in","on","for","with","is","are","was","were","this","that","it","its","as","at","by","from","be","has","have","how","why","what","new","latest","news","today"]);
    const tokensOf = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((w) => w.length > 2 && !STOP.has(w)));
    const overlap = (idea: Set<string>, text: string) => {
      let n = 0;
      for (const w of tokensOf(text)) if (idea.has(w)) n++;
      return n;
    };
    for (const c of candidates) {
      // news-commentary ideas need the reference link regardless of how the
      // LLM labeled "source" — the format's own scriptRecipe promises "the
      // source link is shown on-screen separately", so a headline-reaction
      // idea with no sourceRefs is a broken promise even if the LLM called it
      // "evergreen" (e.g. it didn't feel confident asserting "news").
      if (c.source !== "news" && c.format !== "news-commentary") continue;
      const ideaTokens = tokensOf(`${c.headline} ${c.angle}`);
      if (!c.sourceRefs?.length && fallbackRefs.length) {
        // URL slugs usually carry the article's own headline words — score on
        // them so the best-matching article leads (run-task screenshots [0]).
        c.sourceRefs = [...fallbackRefs].sort((a, b) => overlap(ideaTokens, b) - overlap(ideaTokens, a));
      }
      if (!c.newsFacts?.length && factLines.length) {
        const scored = factLines
          .map((l) => ({ l, s: overlap(ideaTokens, l) }))
          .sort((a, b) => b.s - a.s);
        // Only facts that actually mention this idea's story; if nothing
        // overlaps (rare — vague headline), keep the old whole-batch behavior
        // rather than shipping a factless script.
        const relevant = scored.filter((x) => x.s > 0).map((x) => x.l);
        c.newsFacts = (relevant.length ? relevant : factLines).slice(0, 8);
      }
      if (!c.referenceImageUrl && referenceImageUrl) c.referenceImageUrl = referenceImageUrl;
    }
    return candidates;
  } catch (e) {
    console.warn("[ideation] LLM failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
