import { NextRequest, NextResponse } from "next/server";
import { callClaudeJSON, callGeminiVision } from "@/lib/server/kie-claude";
import { requireAuth } from "@/lib/server/requireAuth";
import { captureUrlScreenshots } from "@/lib/server/screenshotUrl";
import { fetchAppStoreScreenshots, isAppStoreUrl } from "@/lib/server/appStoreScreenshots";
import { crawlProductImageCandidates } from "@/lib/server/productImageCrawl";

// Structured-idea generation is a single Kie/Claude round trip, plus an optional
// website screenshot (headless Chromium) + reference-image describe step —
// give it room.
export const runtime = "nodejs";
export const maxDuration = 150;

const STYLES = ["ugc", "tutorial", "listicle", "before_after", "quote", "product_showcase"] as const;
type Style = (typeof STYLES)[number];
const STYLE_LABELS: Record<Style, string> = {
  ugc: "UGC review — a real person's off-the-cuff, relatable review carousel",
  tutorial: "Tutorial / how-to — numbered steps that teach something concrete",
  listicle: "Listicle — a countdown or ranked list format",
  before_after: "Before/after — a transformation or comparison narrative",
  quote: "Quote / motivational — bold typographic statement slides, building momentum across the whole set",
  product_showcase: "Product showcase — clean hero shots highlighting a product's features",
};
// Slide count per style — motivational/quote carousels read better longer (more
// beats to build momentum); before/after is naturally short (just the two states
// plus framing).
const STYLE_SLIDE_COUNT: Record<Style, number> = {
  ugc: 5,
  tutorial: 6,
  listicle: 6,
  before_after: 4,
  quote: 7,
  product_showcase: 5,
};

const IDEAS_COUNT = 3;

interface IdeaSlide { prompt: string; textOverlay?: string }
interface Idea { title: string; hook: string; textTemplate?: string; slides: IdeaSlide[] }

// Best-effort: fetch a page and strip tags down to plain text for LLM context.
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
    return "";
  }
}

// Body: { prompt, websiteUrl?, websiteDevice?, referenceImageUrl?, style }
// Standalone version of /api/carousel/ideate — no agent/mintAddress dependency,
// just a logged-in user (requireAuth). No DB write here; the picked idea is
// persisted by /api/carousel-app/generate once the user commits to it.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: { prompt?: string; websiteUrl?: string; websiteDevice?: string; referenceImageUrl?: string; style?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  const style = STYLES.includes(body.style as Style) ? (body.style as Style) : "ugc";
  // "product" is a third mode: the uploaded reference image IS the product to
  // feature on every slide (screenshots, if a URL is also given, use the web frame).
  const mode = body.websiteDevice === "app" ? "app" : body.websiteDevice === "product" ? "product" : "web";
  const websiteDevice: "web" | "app" = mode === "app" ? "app" : "web";
  const productMode = mode === "product";
  if (!prompt) return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
  if (prompt.length > 4000) return NextResponse.json({ ok: false, error: "prompt too long (max 4,000 chars)" }, { status: 400 });

  const slideCount = STYLE_SLIDE_COUNT[style];
  const websiteUrl = body.websiteUrl?.trim();

  // Website: scrape the text (product/brand facts) AND screenshot it (headless
  // Chromium — same capture used for hired-agent video product refs) so the
  // actual look of the site/app can be described AND later used as a real
  // reference image when the slides render, not just summarized as text.
  const [websiteText, websiteScreenshots, referenceDescription] = await Promise.all([
    websiteUrl ? fetchWebsiteText(websiteUrl) : Promise.resolve(""),
    // 80s ceiling — observed real capture time for a slow/analytics-heavy site
    // (networkidle timeout → domcontentloaded fallback → up to 3 shots → each
    // uploaded/transcoded via hostBase64ForKie) regularly lands at 55-65s; the
    // shared 25s default (tuned for hire-generate's tighter 60s budget) was
    // racing the timeout against a capture that always finished just after it
    // gave up, so `[]` won the race even on a fully successful capture.
    // APP mode + an App Store / Play Store link → the app's REAL store
    // screenshots (iTunes lookup / Play page crawl, Kie-safe re-hosted) beat a
    // headless capture of the store page chrome. Anything else (or an empty
    // store-crawl result) falls back to the live headless capture.
    websiteUrl
      ? (async () => {
          if (websiteDevice === "app" && isAppStoreUrl(websiteUrl)) {
            const store = await fetchAppStoreScreenshots(websiteUrl);
            if (store.length > 0) return store;
          }
          return captureUrlScreenshots(websiteUrl, { device: websiteDevice, timeoutMs: 80_000 });
        })()
      : Promise.resolve([] as string[]),
    body.referenceImageUrl?.trim()
      ? callGeminiVision({
          system: productMode
            ? "This is a PRODUCT photo that an AI image generator will receive as a reference and must reproduce faithfully on every carousel slide. Describe the exact product in 2-4 sentences: what it is, shape, materials, colors, branding/label text, packaging, and any distinctive details. Be concrete and literal, not poetic."
            : "Describe this reference image in 2-3 sentences: subject, composition, lighting, color palette, mood. This will steer an AI image generator's style — be concrete, not poetic.",
          user: productMode ? "Describe this exact product for faithful reproduction." : "Describe this reference image for style-matching.",
          images: [body.referenceImageUrl.trim()],
          maxTokens: 250,
        }).catch(() => "")
      : Promise.resolve(""),
  ]);
  const websiteScreenshotUrl = websiteScreenshots[0];

  // PRODUCT MODE + website: crawl the site itself for a real PRODUCT photo
  // (JSON-LD Product.image → og:image → large inline imgs), then let vision
  // pick the candidate that best shows the actual product and describe it.
  // That photo becomes a KIE reference at generation time — so the slides show
  // THIS product, not a lookalike — even when the user uploaded nothing. An
  // uploaded product photo still wins as the primary reference; the crawled one
  // then rides along as a second angle.
  let productImageUrl: string | null = null;
  let productDescription = "";
  if (productMode && websiteUrl) {
    const candidates = await crawlProductImageCandidates(websiteUrl, 6).catch(() => [] as string[]);
    if (candidates.length > 0) {
      const shortlist = candidates.slice(0, 4);
      try {
        const raw = await callGeminiVision({
          system: `You are shown ${shortlist.length} images crawled from a product's website, numbered 1..${shortlist.length} in order. Pick the ONE that best shows the actual product itself (clear, unobstructed product photo — not a logo, banner, lifestyle collage, or screenshot). Then describe that exact product in 2-4 concrete sentences: what it is, shape, materials, colors, branding/label text, packaging, distinctive details. Respond with ONLY JSON: {"best": <number 1-${shortlist.length}>, "description": "<the product description>"}. If NONE shows a product, respond {"best": 0, "description": ""}.`,
          user: "Pick the best product image and describe the product.",
          images: shortlist,
          maxTokens: 300,
        });
        const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { best?: number; description?: string };
        const idx = typeof parsed.best === "number" ? Math.round(parsed.best) : 0;
        if (idx >= 1 && idx <= shortlist.length) {
          productImageUrl = shortlist[idx - 1];
          productDescription = typeof parsed.description === "string" ? parsed.description.trim() : "";
        }
      } catch {
        // Vision pick failed — fall back to the highest-confidence candidate
        // (JSON-LD/og:image ordering) with no description.
        productImageUrl = shortlist[0];
      }
    }
  }
  const websiteVisualDescription = websiteScreenshotUrl
    ? await callGeminiVision({
        system: "Describe this website/app screenshot in 2-3 sentences: brand, product, layout, color palette, visual style. This grounds an AI image generator in the real brand look — be concrete, not poetic.",
        user: "Describe this website/app screenshot.",
        images: [websiteScreenshotUrl],
        maxTokens: 200,
      }).catch(() => "")
    : "";

  const contextLines = [
    `Operator's idea: ${prompt}`,
    `Requested style: ${STYLE_LABELS[style]}`,
    websiteText ? `Website text content (scraped, may be partial):\n${websiteText}` : "",
    websiteVisualDescription ? `Website/app real visual look (from a live screenshot): ${websiteVisualDescription}` : "",
    referenceDescription
      ? (productMode
          ? `THE PRODUCT (from the attached product photo — the image generator receives this photo as a reference, so every slide can and must show THIS exact product): ${referenceDescription}`
          : `Reference image style to match: ${referenceDescription}`)
      : "",
    productDescription
      ? `THE PRODUCT (photo crawled from the brand's own website — the image generator receives this photo as a reference, so every slide can and must show THIS exact product): ${productDescription}`
      : "",
  ].filter(Boolean).join("\n\n");

  const productRule = productMode && (referenceDescription || productDescription)
    ? `\n\nPRODUCT MODE (critical): a real product photo is attached and passed to the image generator as a reference on EVERY slide. Every concept must be built around THIS exact product. In each slide's "prompt", explicitly say "the exact product from the reference image" (plus its short description) wherever the product appears — never invent a different product, packaging, or branding.`
    : "";

  const system = `You are a social media carousel strategist and art director. Given an idea, generate exactly ${IDEAS_COUNT} DISTINCT carousel concepts in the requested style — each a genuinely different angle on the SAME idea (e.g. different hook, different structure), not variations of one idea with reworded text.

GROUNDING (critical): every concept must be strictly grounded in the operator's idea and any website/reference context given — use the actual product, brand, or details mentioned, never generic stock-carousel filler unrelated to what was asked.

STRUCTURE: each concept has a short punchy title, a one-sentence hook (why someone stops scrolling), and exactly ${slideCount} slides that read as ONE deliberate narrative arc, not a random list of images:
  - Slide 1 is the cover — must hook attention in half a second.
  - The middle slides build in a clear logical order (setup → development → turn/payoff) matching the requested style.
  - The last slide is always a CTA or payoff that resolves the hook.

VISUAL CONTINUITY (critical — each slide is rendered as a SEPARATE, independent image with no memory of the others): define ONE consistent visual anchor per concept — the same subject/character appearance (face, hair, build, wardrobe), product, color palette, and setting family — and repeat that anchor's concrete descriptive details (not just a name) in EVERY slide's prompt, so the rendered images look like they belong to the same shoot even though each is generated alone. Only the composition/action/camera should change slide to slide.

PROMPT DETAIL (critical): each slide's "prompt" is a literal, ready-to-render AI-image-generation prompt, not a one-line description. Pack in concrete detail every time: exact composition/framing (close-up, medium shot, POV, flat-lay…), camera/lens feel (e.g. "35mm, shallow depth of field"), subject appearance and pose, setting/background specifics, lighting (e.g. "soft window light", "golden hour"), color palette, and mood — 2-4 sentences of real detail, never a vague phrase like "a person holding the product".

TEXT-OVERLAY TEMPLATE (critical — this is what makes the carousel look like ONE designed post, not random slides): decide ONE consistent text-overlay TREATMENT per concept — font style/weight, where it sits (e.g. "bottom third", "top-left corner"), color, and background treatment (e.g. "white bold sans-serif on a solid black rounded chip") — and describe that treatment fully in "textTemplate". Every slide that carries text must use that IDENTICAL treatment (only the words change). Put the actual short on-screen words for that slide in "textOverlay" (2-8 words, punchy — omit or leave "" for a slide with no text). Do NOT re-describe the text styling inside "prompt" itself — that's textTemplate's job; "prompt" only describes the VISUAL scene.

Respond with ONLY this JSON shape, no prose: {"ideas":[{"title":string,"hook":string,"textTemplate":string,"slides":[{"prompt":string,"textOverlay":string}, ...]}]}${productRule}`;

  let ideas: Idea[];
  try {
    const result = await callClaudeJSON<{ ideas?: Idea[] }>({
      system,
      user: contextLines,
      maxTokens: 3200,
    });
    ideas = Array.isArray(result.ideas) ? result.ideas : [];
    ideas = ideas
      .filter((i) => i && typeof i.title === "string" && Array.isArray(i.slides))
      .map((i) => {
        const textTemplate = typeof i.textTemplate === "string" ? i.textTemplate.trim() : "";
        const slides = i.slides
          .filter((s) => s && typeof s.prompt === "string" && s.prompt.trim())
          .slice(0, slideCount)
          .map((s) => {
            const overlay = typeof s.textOverlay === "string" ? s.textOverlay.trim() : "";
            // Enforce IDENTICAL overlay phrasing across every slide server-side —
            // only the quoted words differ — rather than trusting the model to
            // repeat the same styling instruction verbatim on its own each time.
            const prompt = overlay && textTemplate
              ? `${s.prompt.trim()}\n\nTEXT OVERLAY: render the on-screen words "${overlay}" using this exact treatment — ${textTemplate}`
              : s.prompt.trim();
            return { prompt };
          });
        return { title: i.title, hook: typeof i.hook === "string" ? i.hook : "", slides };
      })
      .filter((i) => i.slides.length > 0)
      .slice(0, IDEAS_COUNT);
    if (ideas.length === 0) throw new Error("model returned no usable ideas");
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Idea generation failed: ${e instanceof Error ? e.message : "internal error"}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, ideas, style, websiteScreenshotUrl: websiteScreenshotUrl ?? null, productImageUrl });
}
