import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { callGemini35Text } from "@/lib/server/kie-gemini";

export const runtime = "nodejs";
export const maxDuration = 60;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/** The lead-magnet modal's analyze step: fetch the visitor's website, have the
 *  LLM summarize the business and pitch 3 short-form video angles, store the
 *  whole thing as a lead, and return it for the modal's teaser cards. The
 *  visitor is anonymous — no auth — so inputs are strictly validated and the
 *  page fetch is size/time-capped. */

type Analysis = { businessName: string; summary: string; angles: string[] };

/** Strip tags and squeeze whitespace — enough signal for a summary without a
 *  real HTML parser. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchSiteText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VelloBot/1.0; +https://velloagents.com)" },
    });
    if (!res.ok) return "";
    const html = (await res.text()).slice(0, 400_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
    return [title, desc, htmlToText(html).slice(0, 6000)].filter(Boolean).join("\n");
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  const clean = (url ?? "").trim().slice(0, 500);
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a website address." }, { status: 400 });
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".") || /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) {
    return NextResponse.json({ error: "That doesn't look like a public website." }, { status: 400 });
  }
  const siteUrl = parsed.toString();

  const siteText = await fetchSiteText(siteUrl);
  const host = parsed.hostname.replace(/^www\./, "");

  let analysis: Analysis = {
    businessName: host,
    summary: `A business at ${host}. We'll tailor every video to what it sells and who it's for.`,
    angles: [
      "A scroll-stopping intro clip that shows what you do in under 15 seconds",
      "A customer-pain hook that speaks straight to your ideal buyer",
      "A social-proof style short built to convert viewers into visitors",
    ],
  };
  try {
    const user = `You're the creative director of an AI video studio. A business just submitted their website for free promo videos.
Website: ${siteUrl}
${siteText ? `Site content (extracted):\n${siteText}` : "The site couldn't be fetched — infer what you can from the domain name."}

Reply with STRICT JSON only (no markdown fences):
{"businessName": "short brand name", "summary": "2-3 sentences: what the business does, who it serves, and the angle short-form video should take for it — written to the business owner as 'you'", "angles": ["three specific short-form video concepts for THIS business, one line each"]}`;
    const raw = (await callGemini35Text({ user, search: false })).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const j = JSON.parse(raw) as Partial<Analysis>;
    if (typeof j.businessName === "string" && typeof j.summary === "string" && Array.isArray(j.angles) && j.angles.length >= 3) {
      analysis = {
        businessName: j.businessName.slice(0, 80),
        summary: j.summary.slice(0, 600),
        angles: j.angles.slice(0, 3).map((a) => String(a).slice(0, 160)),
      };
    }
  } catch (e) {
    console.warn("[leads/analyze] LLM summary failed, using fallback:", e instanceof Error ? e.message : e);
  }

  // Store the lead (best-effort — the modal must still work if this fails).
  try {
    if (CONVEX_URL) {
      const convex = new ConvexHttpClient(CONVEX_URL);
      await convex.mutation(api.leads.capture, {
        authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
        source: "cta_website",
        url: siteUrl,
        businessName: analysis.businessName,
        summary: analysis.summary,
        angles: analysis.angles,
        userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? undefined,
        referer: req.headers.get("referer")?.slice(0, 300) ?? undefined,
      });
    }
  } catch (e) {
    console.warn("[leads/analyze] lead store failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json(analysis);
}
