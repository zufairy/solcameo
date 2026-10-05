import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { callClaudeJSON, callGeminiVision } from "@/lib/server/kie-claude";
import { requireAuth } from "@/lib/server/requireAuth";
import { captureUrlScreenshots } from "@/lib/server/screenshotUrl";
import { fetchAppStoreScreenshots, isAppStoreUrl } from "@/lib/server/appStoreScreenshots";
import { crawlProductImageCandidates } from "@/lib/server/productImageCrawl";

// One Claude round-trip that (a) understands the product and (b) casts the
// swarm: picks the best-matching influencer agents from the live roster and
// writes ONE unique content brief per requested video, distributed across them.
export const runtime = "nodejs";
export const maxDuration = 150;

const MAX_COUNT = 100;
const MAX_AGENTS = 12;      // swarm cast ceiling — variety without chaos
const MAX_CANDIDATES = 40;  // roster slice shown to Claude (context budget)

type AgentLite = {
  mintAddress: string;
  name: string;
  handle: string;
  avatarUrl: string;
  niche: string;
  archetype: string;
  description: string;
  language: string;
  connectedPlatforms: string[];
};

// Best-effort page-text scrape for grounding (same pattern as carousel ideate).
async function fetchWebsiteText(url: string): Promise<string> {
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
      .slice(0, 3500);
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { prompt?: string; websiteUrl?: string; productImageUrl?: string; count?: number; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const prompt = (body.prompt ?? "").trim();
  const count = Math.max(1, Math.min(MAX_COUNT, Math.floor(Number(body.count) || 1)));
  if (!prompt) return NextResponse.json({ ok: false, error: "Tell us about the product first." }, { status: 400 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);

  // Live roster: AI-influencer agents with a usable face. Clippers repurpose
  // existing footage — the swarm generates ORIGINAL persona videos, so only
  // persona agents qualify.
  const all = (await convex.query(api.influencers.listAll, {})) as Array<Record<string, unknown>>;
  const candidates: AgentLite[] = all
    .filter((d) => (d.agentType ?? "influencer") !== "clipping" && typeof d.avatarUrl === "string" && d.avatarUrl)
    .slice(0, MAX_CANDIDATES)
    .map((d) => ({
      mintAddress: String(d.mintAddress),
      name: String(d.name ?? ""),
      handle: String(d.handle ?? ""),
      avatarUrl: String(d.avatarUrl ?? ""),
      niche: String(d.niche ?? ""),
      archetype: String(d.archetype ?? ""),
      description: String(d.description ?? "").slice(0, 200),
      language: String(d.language ?? ""),
      connectedPlatforms: Array.isArray(d.connectedPlatforms) ? d.connectedPlatforms.map(String) : [],
    }));
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false, error: "No influencer agents available yet." }, { status: 409 });
  }

  const websiteUrl = body.websiteUrl?.trim() || "";
  const websiteText = websiteUrl ? await fetchWebsiteText(websiteUrl) : "";

  // ── VISUAL REFERENCE (mirrors the Recreate/Carousel flow) ─────────────────
  // The link (by mode) resolves to a REAL reference image that rides into KIE
  // for the storyboard AND every clip render (run-task's productImageUrl /
  // campaignImageUrls path — already consumed downstream, it was just never
  // filled from the link):
  //  - "product": crawl the page's own product photos (JSON-LD/og/large imgs)
  //    and vision-pick the one that best shows the product itself.
  //  - "app": App Store / Play Store link → the app's real store screenshots;
  //    any other link → a live phone-frame capture.
  //  - "web" (default): a live headless screenshot of the site.
  // An UPLOADED product photo still wins as the primary reference.
  const mode = body.mode === "app" ? "app" : body.mode === "product" ? "product" : "web";
  let referenceImageUrl = body.productImageUrl?.trim() || "";
  let referenceNote = referenceImageUrl ? "uploaded product photo" : "";
  if (!referenceImageUrl && websiteUrl) {
    try {
      if (mode === "product") {
        const candidates = (await crawlProductImageCandidates(websiteUrl, 6)).slice(0, 4);
        if (candidates.length > 0) {
          try {
            const raw = await callGeminiVision({
              system: `You are shown ${candidates.length} images crawled from a product's website, numbered 1..${candidates.length}. Pick the ONE that best shows the actual product itself (clear product photo — not a logo, banner, or screenshot). Respond ONLY JSON: {"best": <number 1-${candidates.length}>}. If none shows a product, {"best": 1}.`,
              user: "Pick the best product image.",
              images: candidates,
              maxTokens: 60,
            });
            const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { best?: number };
            const idx = Math.round(Number(parsed.best ?? 1));
            referenceImageUrl = candidates[idx >= 1 && idx <= candidates.length ? idx - 1 : 0];
          } catch {
            referenceImageUrl = candidates[0];
          }
          referenceNote = "product photo crawled from the site";
        }
      } else if (mode === "app") {
        if (isAppStoreUrl(websiteUrl)) {
          const shots = await fetchAppStoreScreenshots(websiteUrl);
          if (shots.length > 0) { referenceImageUrl = shots[0]; referenceNote = "app store screenshot"; }
        }
        if (!referenceImageUrl) {
          const shots = await captureUrlScreenshots(websiteUrl, { device: "app", timeoutMs: 80_000 });
          if (shots.length > 0) { referenceImageUrl = shots[0]; referenceNote = "live app screenshot"; }
        }
      } else {
        const shots = await captureUrlScreenshots(websiteUrl, { device: "web", timeoutMs: 80_000 });
        if (shots.length > 0) { referenceImageUrl = shots[0]; referenceNote = "live website screenshot"; }
      }
    } catch (e) {
      console.warn(`[swarm/plan] reference resolution failed (${mode}): ${e instanceof Error ? e.message : e}`);
    }
  }

  const roster = candidates
    .map((a, i) => `${i}. ${a.name} (@${a.handle}) — niche: ${a.niche}; archetype: ${a.archetype}; language: ${a.language}; bio: ${a.description}`)
    .join("\n");

  const maxAgents = Math.min(MAX_AGENTS, candidates.length, count);
  const system = `You are a UGC campaign director casting AI influencer agents for a product content swarm.

1. CAST: from the roster, pick the ${Math.min(maxAgents, 8) >= maxAgents ? maxAgents : `up to ${maxAgents}`} agents whose niche/persona/language best fit the product and audience. Fewer is fine when the roster fit is weak — never pad with irrelevant agents. Each pick gets a one-sentence "reason" (why THIS persona sells THIS product).
2. BRIEFS: write EXACTLY ${count} content briefs, distributed as evenly as possible across the cast. Each brief is one line: a concrete, ready-to-shoot short-video idea for that agent's persona featuring the product — vary the format aggressively across briefs (talking-head review, unboxing, day-in-my-life, tutorial, hot take, reaction, before/after, POV skit, listicle…), vary hooks and settings, never repeat an angle. Write each brief in the agent's language.

Respond ONLY with JSON: {"productSummary": string, "cast": [{"index": number, "reason": string}], "briefs": [{"agentIndex": number, "topic": string}]} where index/agentIndex reference the roster numbering and briefs has exactly ${count} entries.`;

  const user = [
    `PRODUCT (operator's own words): ${prompt}`,
    websiteText ? `WEBSITE CONTENT (scraped, partial):\n${websiteText}` : "",
    referenceImageUrl ? `A visual reference (${referenceNote}) is attached to every render — briefs can say "show the product/app/site".` : "",
    `ROSTER:\n${roster}`,
  ].filter(Boolean).join("\n\n");

  try {
    const result = await callClaudeJSON<{
      productSummary?: string;
      cast?: { index?: number; reason?: string }[];
      briefs?: { agentIndex?: number; topic?: string }[];
    }>({ system, user, maxTokens: Math.min(8000, 800 + count * 60) });

    const cast = (result.cast ?? [])
      .filter((c) => Number.isInteger(c.index) && candidates[c.index as number])
      .slice(0, maxAgents)
      .map((c) => ({ ...candidates[c.index as number], reason: (c.reason ?? "").slice(0, 200), rosterIndex: c.index as number }));
    if (cast.length === 0) throw new Error("no agents matched");
    const castIndexes = new Set(cast.map((c) => c.rosterIndex));

    // Normalize briefs: drop invalid rows, then round-robin-fill to exactly
    // `count` so a short/overlong model response never breaks the plan.
    const briefs = (result.briefs ?? [])
      .filter((b) => typeof b.topic === "string" && b.topic.trim() && Number.isInteger(b.agentIndex) && castIndexes.has(b.agentIndex as number))
      .map((b) => ({ agentIndex: b.agentIndex as number, topic: b.topic!.trim().slice(0, 500) }))
      .slice(0, count);
    let fill = 0;
    while (briefs.length < count) {
      const src = briefs[fill % Math.max(1, briefs.length)] ?? { agentIndex: cast[0].rosterIndex, topic: prompt };
      briefs.push({ agentIndex: cast[fill % cast.length].rosterIndex, topic: `${src.topic} (fresh angle #${briefs.length + 1})` });
      fill += 1;
    }

    const items = briefs.map((b) => {
      const agent = candidates[b.agentIndex];
      return { mintAddress: agent.mintAddress, topic: b.topic };
    });

    return NextResponse.json({
      ok: true,
      productSummary: (result.productSummary ?? "").slice(0, 400),
      cast: cast.map(({ rosterIndex: _i, ...rest }) => rest),
      items,
      // The resolved KIE reference (uploaded photo > crawled product shot >
      // store/app/site screenshot) — the client passes it to /launch as
      // productImageUrl so it rides into the storyboard + every clip render.
      referenceImageUrl: referenceImageUrl || null,
      referenceNote: referenceNote || null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Matching failed: ${e instanceof Error ? e.message : "internal error"}` },
      { status: 502 },
    );
  }
}
