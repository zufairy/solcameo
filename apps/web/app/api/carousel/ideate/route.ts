import { beginAgentGeneration } from "@/lib/server/agentGenerationBilling";
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { callClaudeJSON, callGeminiVision } from "@/lib/server/kie-claude";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";

// Structured-idea generation is a single Kie/Claude round trip (fast), but a
// reference-image describe step can add a few seconds — give it room.
export const runtime = "nodejs";
export const maxDuration = 60;

const STYLES = ["ugc", "tutorial", "listicle", "before_after", "quote", "product_showcase"] as const;
type Style = (typeof STYLES)[number];
const STYLE_LABELS: Record<Style, string> = {
  ugc: "UGC review — a real person's off-the-cuff, relatable review carousel",
  tutorial: "Tutorial / how-to — numbered steps that teach something concrete",
  listicle: "Listicle — a countdown or ranked list format",
  before_after: "Before/after — a transformation or comparison narrative",
  quote: "Quote / motivational — bold typographic statement slides",
  product_showcase: "Product showcase — clean hero shots highlighting a product's features",
};

const IDEAS_COUNT = 3;
const SLIDES_PER_IDEA = 5;

interface IdeaSlide { prompt: string }
interface Idea { title: string; hook: string; slides: IdeaSlide[] }

// Best-effort: fetch a page and strip tags down to plain text for LLM context.
// No headless browser — client-rendered pages will yield thin/empty text, which
// is fine, the model just gets less to work with rather than the route failing.
async function fetchWebsiteText(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "";
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "";
    const html = await res.text();
    const text = html
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 4000);
  } catch {
    return ""; // unreachable / not a URL — ideation just proceeds without it
  }
}

// Body: { username (mintAddress), sessionId?, prompt, websiteUrl?, referenceImageUrl?, style }
// Generates IDEAS_COUNT carousel concepts (title + hook + SLIDES_PER_IDEA slide
// prompts each) via Kie's Claude passthrough. No DB write — this is a disposable
// planning step; only the images a user actually renders per slide get persisted
// (via the existing /api/carousel/generate → carouselImages.recordGenerated path).
export async function POST(req: NextRequest) {
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  let body: {
    username?: string;
    prompt?: string;
    websiteUrl?: string;
    referenceImageUrl?: string;
    style?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const mintAddress = (body.username ?? "").trim();
  const prompt = (body.prompt ?? "").trim();
  const style = STYLES.includes(body.style as Style) ? (body.style as Style) : "ugc";
  if (!mintAddress) return NextResponse.json({ ok: false, error: "username is required" }, { status: 400 });
  if (!prompt) return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
  if (prompt.length > 4000) return NextResponse.json({ ok: false, error: "prompt too long (max 4,000 chars)" }, { status: 400 });

  // Ownership check — same pattern as /api/carousel/generate.
  let secret = "";
  try {
    const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
    const convex = new ConvexHttpClient(CONVEX_URL);
    secret = process.env.INTERNAL_CRON_SECRET ?? "";
    const agent = await convex.query(api.influencers.getByMintServer, { mintAddress, authSecret: secret });
    if (!auth.internal) {
      const err = requireOwnerWithSiws(auth, agent);
      if (err) return err;
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Could not verify agent ownership: ${e instanceof Error ? e.message : "internal error"}` },
      { status: 502 },
    );
  }

  const [websiteText, referenceDescription] = await Promise.all([
    body.websiteUrl?.trim() ? fetchWebsiteText(body.websiteUrl.trim()) : Promise.resolve(""),
    body.referenceImageUrl?.trim()
      ? callGeminiVision({
          system: "Describe this reference image in 2-3 sentences: subject, composition, lighting, color palette, mood. This will steer an AI image generator's style — be concrete, not poetic.",
          user: "Describe this reference image for style-matching.",
          images: [body.referenceImageUrl.trim()],
          maxTokens: 200,
        }).catch(() => "")
      : Promise.resolve(""),
  ]);

  const contextLines = [
    `Operator's idea: ${prompt}`,
    `Requested style: ${STYLE_LABELS[style]}`,
    websiteText ? `Website context (scraped, may be partial):\n${websiteText}` : "",
    referenceDescription ? `Reference image style to match: ${referenceDescription}` : "",
  ].filter(Boolean).join("\n\n");

  const system = `You are a social media carousel strategist. Given an idea, generate exactly ${IDEAS_COUNT} distinct carousel concepts in the requested style. Each concept has a short punchy title, a one-sentence hook (why someone stops scrolling), and exactly ${SLIDES_PER_IDEA} slides. Slide 1 is always the cover (must hook attention visually), the last slide is always a CTA or payoff. Each slide's "prompt" is a literal, concrete AI-image-generation prompt (composition, subject, setting, mood, text overlay if any) — not a description of the idea. Respond with ONLY this JSON shape, no prose: {"ideas":[{"title":string,"hook":string,"slides":[{"prompt":string}, ...]}]}`;

  const billing = await beginAgentGeneration(req, mintAddress, "llm_message");
  if (billing.error) return billing.error;
  let ideas: Idea[];
  try {
    const result = await callClaudeJSON<{ ideas?: Idea[] }>({
      system,
      user: contextLines,
      maxTokens: 2000,
    });
    ideas = Array.isArray(result.ideas) ? result.ideas : [];
    ideas = ideas
      .filter((i) => i && typeof i.title === "string" && Array.isArray(i.slides))
      .map((i) => ({
        title: i.title,
        hook: typeof i.hook === "string" ? i.hook : "",
        slides: i.slides.filter((s) => s && typeof s.prompt === "string" && s.prompt.trim()).slice(0, SLIDES_PER_IDEA),
      }))
      .filter((i) => i.slides.length > 0)
      .slice(0, IDEAS_COUNT);
    if (ideas.length === 0) throw new Error("model returned no usable ideas");
  } catch (e) {
    await billing.refund();
    return NextResponse.json(
      { ok: false, error: `Idea generation failed: ${e instanceof Error ? e.message : "internal error"}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, ideas, style });
}
