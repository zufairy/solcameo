/**
 * Website → product understanding + 3 UGC sample concepts + an agent identity.
 *
 * Extracted from app/api/admin/ugc-sample/analyze/route.ts so the public
 * Launch funnel (lib/server/launch/runLaunch.ts) and the admin tool run the
 * SAME analysis. The admin route is now a thin auth wrapper over this.
 *
 * Pure analysis, no video spend: one Claude JSON pass plus best-effort probes
 * (page text, live screenshot, crawled product images, vision ranking).
 */
import { callClaudeJSON, callGeminiVision } from "@/lib/server/kie-claude";
import { captureUrlScreenshots } from "@/lib/server/screenshotUrl";
import { crawlProductImageCandidates } from "@/lib/server/productImageCrawl";
import type { ClientType, UgcConcept } from "@/lib/server/ugcSampleWorkers";
import { fallbackIdentity, sanitizeHandle } from "./launchInput";

export interface AgentIdentity {
  agentName: string;
  handle: string;
  niche: string;
  language: string;
  audience: string;
  pillars: string[];
}

export interface WebsiteAnalysis {
  productSummary: string;
  concepts: UgcConcept[];
  screenshotUrl: string;
  productImageUrl: string;
  productImageUrls: string[];
  websiteText: string;
  identity: AgentIdentity;
}

// Best-effort page-text scrape for grounding (same pattern as swarm/plan).
export async function fetchWebsiteText(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "";
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch {
    return "";
  }
}

/** Pure: shape the model's JSON into ordered concepts + a complete identity. */
export function parseAnalysis(
  raw: unknown,
  websiteUrl: string,
): Pick<WebsiteAnalysis, "productSummary" | "concepts" | "identity"> {
  const result = (raw && typeof raw === "object" ? raw : {}) as {
    productSummary?: unknown;
    concepts?: { format?: unknown; title?: unknown; idea?: unknown; hookText?: unknown }[];
    identity?: { agentName?: unknown; handle?: unknown; niche?: unknown; language?: unknown; audience?: unknown; pillars?: unknown };
  };
  const byFormat = new Map(
    (Array.isArray(result.concepts) ? result.concepts : [])
      .filter((c) => c && typeof c.format === "string")
      .map((c) => [c.format as string, c]),
  );
  const concepts: UgcConcept[] = (["reaction", "cartoon", "review"] as const).map((format) => {
    const c = byFormat.get(format);
    return {
      format,
      title: String(c?.title ?? "").slice(0, 80) || format,
      idea: String(c?.idea ?? "").slice(0, 600),
      hookText: String(c?.hookText ?? "").slice(0, 80),
    };
  });
  if (concepts.some((c) => !c.idea)) throw new Error("concept generation came back incomplete");

  const fb = fallbackIdentity(websiteUrl);
  const id = result.identity ?? {};
  const agentName = String(id.agentName ?? "").trim().slice(0, 40) || fb.agentName;
  // Model handle wins; else a slug of the (model or domain) name with the same
  // `_vello` suffix the mint route's deriveHandle appends.
  const handle = sanitizeHandle(String(id.handle ?? ""), id.agentName ? `${sanitizeHandle(agentName, "agent")}_vello`.slice(0, 24) : fb.handle);
  const pillars = (Array.isArray(id.pillars) ? id.pillars : [])
    .map((p) => String(p ?? "").trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 5);
  return {
    productSummary: String(result.productSummary ?? "").slice(0, 600),
    concepts,
    identity: {
      agentName,
      handle,
      niche: String(id.niche ?? "").trim().slice(0, 40) || "lifestyle",
      language: String(id.language ?? "").trim().slice(0, 40) || "English",
      audience: String(id.audience ?? "").trim().slice(0, 120),
      pillars,
    },
  };
}

export function clientTypeLine(clientType: ClientType): string {
  return clientType === "physical"
    ? "CLIENT TYPE: PHYSICAL PRODUCT — concepts must feature the presenter physically holding/using the product; tactile, in-hand moments."
    : clientType === "service"
      ? "CLIENT TYPE: SERVICE/SHOP — concepts sell the experience and outcome (before/after, the payoff moment), not an object."
      : "CLIENT TYPE: APP/SOFTWARE — concepts revolve around the real UI on a screen (what the user sees and does in the app).";
}

const SYSTEM = `You are a UGC creative director preparing SAMPLE videos to pitch a prospective client whose website you just analyzed.

Write:
1. "productSummary" — 2-3 sentences: what the product/service actually is, who it's for, its strongest selling point. Ground EVERY claim in the provided website content; never invent stats, prices, or guarantees.
2. "concepts" — EXACTLY 3 concepts, one per fixed format, in this order:
   - format "reaction": a 6-8s candid multi-cut reaction clip that sells by REVERSE PSYCHOLOGY — she's caught casually doing the impressive thing with the product (absorbed, never presenting, never addressing the camera), and the on-screen text is an OBSERVER's dry understated remark about it (never a pitch, never a feature name — "she really just did that on her phone" energy). Give the exact observer text (max 8 words, deadpan, specific to what this product does) and the 2-3 candid beats she's caught in.
   - format "cartoon": a ~20s ANIME mini-episode that soft-sells the product. The episode's conflict must BE the real problem this product solves (from the site), and the turning point must use one REAL feature — never a generic mascot story. Give the tiny story beat-by-beat in 2-3 sentences (cold-open on the problem → comic escalation → the feature turns it → payoff).
   - format "review": a 10s hyper-realistic selfie-style review — a real person talking to camera about their genuine experience, specific details pulled from the site, casual imperfect phrasing, zero ad-speak. Give the angle and the one concrete detail she mentions.
3. "identity" — the AI creator persona who will front this brand's content: {"agentName": a short human first name + optional brand-flavoured surname (2 words max, NOT the company name verbatim), "handle": lowercase a-z0-9_ (3-20 chars), "niche": one or two words (e.g. "productivity", "skincare", "fintech"), "language": the site's primary language in English words (e.g. "English", "Malay"), "audience": one sentence, "pillars": 3-5 short content themes}.

Respond ONLY JSON: {"productSummary": string, "concepts": [{"format": "reaction"|"cartoon"|"review", "title": string, "idea": string, "hookText": string}], "identity": {"agentName": string, "handle": string, "niche": string, "language": string, "audience": string, "pillars": string[]}} — "hookText" only meaningful for reaction (empty string for the others).`;

export class WebsiteUnreadableError extends Error {
  constructor() { super("Couldn't read that site (no text, no screenshot). Check the URL is public."); }
}

/** Full analysis: probes + vision ranking + one Claude pass. Throws
 *  WebsiteUnreadableError when neither text nor a screenshot came back. */
export async function analyzeWebsite(args: { websiteUrl: string; clientType: ClientType; notes?: string }): Promise<WebsiteAnalysis> {
  const { websiteUrl, clientType } = args;
  const notes = String(args.notes ?? "").trim().slice(0, 800);

  // Crawl text + live screenshot + a real product photo, in parallel — each
  // best-effort: a site that blocks one probe still gets a useful breakdown
  // from whatever the other probes returned.
  const [websiteText, screenshots, appScreens, productCandidates] = await Promise.all([
    fetchWebsiteText(websiteUrl),
    captureUrlScreenshots(websiteUrl, { device: "web", timeoutMs: 80_000 }).catch(() => [] as string[]),
    clientType === "app"
      ? captureUrlScreenshots(websiteUrl, { device: "app", timeoutMs: 80_000 }).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
    crawlProductImageCandidates(websiteUrl, 8).catch(() => [] as string[]),
  ]);
  const screenshotUrl = screenshots[0] ?? "";
  const appScreenUrl = appScreens[0] ?? "";
  if (!websiteText && !screenshotUrl) throw new WebsiteUnreadableError();

  // Vision-RANK the crawl: top product references (≤3, best first), type-aware.
  let productImageUrls: string[] = [];
  const picks = productCandidates.slice(0, 6);
  if (picks.length > 0) {
    const wantLine = clientType === "physical"
      ? "the ACTUAL PHYSICAL PRODUCT, clearly: clean product photos (packshots, in-hand, different angles all welcome). NOT logos, banners, lifestyle shots without the product, or UI screenshots."
      : clientType === "app"
        ? "the APP'S REAL USER INTERFACE: screenshots of actual app screens / dashboard views (phone UI best). NOT logos, banners, team photos, or abstract marketing art."
        : "the SERVICE/EXPERIENCE at its clearest: the place, the result, the branded moment. NOT logos or abstract banners.";
    try {
      const raw = await callGeminiVision({
        system: `You are shown ${picks.length} images crawled from a client's website, numbered 1..${picks.length}. Rank the ones that best show ${wantLine} Respond ONLY JSON: {"best": [<numbers, best first, up to 3, ONLY images that genuinely qualify>]}. Empty array if none qualify.`,
        user: "Rank the best product reference images.",
        images: picks,
        maxTokens: 80,
      });
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { best?: unknown };
      const order = (Array.isArray(parsed.best) ? parsed.best : [])
        .map((n) => Math.round(Number(n)))
        .filter((n) => n >= 1 && n <= picks.length);
      productImageUrls = [...new Set(order.map((n) => picks[n - 1]))].slice(0, 3);
    } catch {
      productImageUrls = picks.slice(0, 1);
    }
  }
  if (appScreenUrl) productImageUrls = [...new Set([appScreenUrl, ...productImageUrls])].slice(0, 3);
  const productImageUrl = productImageUrls[0] ?? "";

  const user = [
    `WEBSITE: ${websiteUrl}`,
    clientTypeLine(clientType),
    websiteText ? `WEBSITE CONTENT (scraped, partial):\n${websiteText}` : "No text could be scraped — a live screenshot exists instead.",
    notes ? `OPERATOR NOTES: ${notes}` : "",
  ].filter(Boolean).join("\n\n");

  const result = await callClaudeJSON<unknown>({ system: SYSTEM, user, maxTokens: 1600 });
  const parsed = parseAnalysis(result, websiteUrl);
  return {
    ...parsed,
    screenshotUrl,
    productImageUrl,
    productImageUrls,
    websiteText: websiteText.slice(0, 3000),
  };
}

/**
 * TEXT-ONLY preview for the index page's pre-login moment: page text + one
 * Claude pass, no screenshots, no vision ranking (~10s, cheap). Shows the
 * visitor their product summary, agent name and winning hook BEFORE the
 * sign-in wall. The full analysis (screenshots, product refs) runs after
 * login in runLaunch.
 */
export async function previewWebsite(websiteUrl: string): Promise<Pick<WebsiteAnalysis, "productSummary" | "concepts" | "identity">> {
  const websiteText = await fetchWebsiteText(websiteUrl);
  if (!websiteText) throw new WebsiteUnreadableError();
  const user = [
    `WEBSITE: ${websiteUrl}`,
    clientTypeLine("app"),
    `WEBSITE CONTENT (scraped, partial):\n${websiteText}`,
  ].join("\n\n");
  const result = await callClaudeJSON<unknown>({ system: SYSTEM, user, maxTokens: 1600 });
  return parseAnalysis(result, websiteUrl);
}

