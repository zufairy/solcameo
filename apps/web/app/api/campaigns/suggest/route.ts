import { NextRequest, NextResponse } from "next/server";
import { callClaudeJSON } from "@/lib/server/kie-claude";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { fetchWebsiteIntelligence } from "@/lib/builder/websiteIntelligence";

export const maxDuration = 45;

const NICHES = ["lifestyle", "tech", "fashion", "fitness", "food", "travel", "finance", "gaming"];
const LANGS = ["en", "ms", "id", "ar", "zh", "hi", "es", "fr"];

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * POST /api/campaigns/suggest: drafts the hard-to-write parts of a campaign.
 * Given a website (crawled through the SSRF-safe fetcher) and/or the brand and
 * title, returns a brief, 4-6 concrete requirements and a niche + language guess.
 * Auth-gated (it spends model credits). Output is sanitised and clamped.
 */
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => ({}))) as {
    url?: string; brandName?: string; title?: string; brief?: string;
    campaignType?: string; boardCategory?: string; want?: "all" | "requirements";
  };
  const url = clean(body.url, 300);
  const brand = clean(body.brandName, 80);
  const title = clean(body.title, 120);
  const brief = typeof body.brief === "string" ? body.brief.slice(0, 2000) : "";
  const type = body.campaignType === "bounty" ? "bounty" : body.campaignType === "agent_task" ? "agent task" : "marketing";
  const board = body.boardCategory === "ugc" ? "UGC (original videos about the brand)" : "Clipping (cut and repost clips from supplied source videos)";
  const want = body.want === "requirements" ? "requirements" : "all";

  if (!url && !brand && !title && !brief) {
    return NextResponse.json({ ok: false, error: "Add a website, brand or title first." }, { status: 400 });
  }

  let site = "";
  let siteName = "";
  if (url) {
    if (!/^https?:\/\//i.test(url)) return NextResponse.json({ ok: false, error: "Use a full link starting with https://" }, { status: 400 });
    try {
      const intel = await fetchWebsiteIntelligence(url);
      if (intel) {
        siteName = intel.siteName || intel.title || "";
        site = [intel.title && `Title: ${intel.title}`, intel.description && `Description: ${intel.description}`, intel.readableText && `Page text: ${intel.readableText.slice(0, 2500)}`].filter(Boolean).join("\n");
      }
    } catch { /* unreachable site: fall back to brand + title */ }
    if (!site) return NextResponse.json({ ok: false, error: "Couldn't read that website. Check the link is public, or describe the brand instead." }, { status: 422 });
  }

  const system = `You help advertisers launch creator/agent campaigns on Vello, where AI agents and creators post short videos and are paid per 1,000 verified views. Reply ONLY with JSON:
{"brandName": string, "title": string, "brief": string, "requirements": string[], "niche": ${JSON.stringify(NICHES)}[one of], "language": ${JSON.stringify(LANGS)}[one of]}
Rules: brief = 70-140 words, plain language, covers what the content should show, tone, key message and what to avoid; no hashtags spam, no emojis, no markdown. requirements = 4-6 short, checkable instructions (each under 140 chars) that every post must follow (e.g. mention the brand name in the first 3 seconds, on-screen captions, length range, call to action, banned claims). Never invent prices, discounts or statistics. If you lack info, stay generic rather than guessing facts.`;
  const user = [
    `Campaign type: ${type}. Board: ${board}.`,
    brand && `Brand: ${brand}`,
    title && `Working title: ${title}`,
    url && `Website: ${url}`,
    site && `Website content:\n${site}`,
    brief && `Advertiser's current brief:\n${brief}`,
    want === "requirements" ? "Focus on the requirements; keep the brief close to the current one." : "Write the full set.",
  ].filter(Boolean).join("\n");

  try {
    const out = await callClaudeJSON<Record<string, unknown>>({ system, user, maxTokens: 900 });
    const reqs = Array.isArray(out.requirements)
      ? (out.requirements as unknown[]).map((r) => clean(r, 160)).filter(Boolean).slice(0, 6)
      : [];
    const niche = typeof out.niche === "string" && NICHES.includes(out.niche.toLowerCase()) ? out.niche.toLowerCase() : undefined;
    const language = typeof out.language === "string" && LANGS.includes(out.language.toLowerCase()) ? out.language.toLowerCase() : undefined;
    const result = {
      brandName: clean(out.brandName, 80) || brand || clean(siteName, 80),
      title: clean(out.title, 120),
      brief: clean(out.brief, 1400),
      requirements: reqs,
      niche,
      language,
    };
    if (!result.brief && reqs.length === 0) throw new Error("empty");
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ ok: false, error: "The writer is busy. Try again in a moment, or use the quick suggestions." }, { status: 502 });
  }
}
