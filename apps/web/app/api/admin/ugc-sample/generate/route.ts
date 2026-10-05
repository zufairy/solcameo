import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import {
  SLOT_DEFS, runConceptSlot, runStorySlot, runCarouselSlot,
  type ClientType, type UgcConcept, type UgcSlotCtx,
} from "@/lib/server/ugcSampleWorkers";

// Admin UGC-Sample step 2: fire the 6 sample slots. Creates the run doc
// (slots pending) and returns its id IMMEDIATELY — the page subscribes via
// ugcSampleRuns.get and watches slots flip scripting → rendering → done.
// The workers run post-response (Railway is a long-lived Node process — same
// background-drain pattern as swarm/launch), each slot fully independent; the
// shared workers live in lib/server/ugcSampleWorkers.ts so the retry route can
// re-run ONE failed slot without a full (token-burning) re-run.
export const runtime = "nodejs";
export const maxDuration = 300;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
const CHECK_ADMIN = makeFunctionReference<"action">("submissions:checkAdminToken");
const CREATE_RUN = makeFunctionReference<"mutation">("ugcSampleRuns:create");

async function isAuthorized(req: NextRequest, accessToken?: string): Promise<boolean> {
  if (checkInternalSecret(req)) return true;
  if (!accessToken || !CONVEX_URL) return false;
  const convex = new ConvexHttpClient(CONVEX_URL);
  const chk = (await convex.action(CHECK_ADMIN, { accessToken }).catch(() => null)) as { admin: boolean } | null;
  return !!chk?.admin;
}

export async function POST(req: NextRequest) {
  let body: {
    websiteUrl?: string; photoUrl?: string; productSummary?: string; websiteText?: string;
    screenshotUrl?: string; productImageUrl?: string; productImageUrls?: string[]; concepts?: UgcConcept[]; accessToken?: string;
    clientType?: string; language?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const websiteUrl = String(body.websiteUrl ?? "").trim();
  const photoUrl = String(body.photoUrl ?? "").trim();
  if (!/^https?:\/\//i.test(websiteUrl)) return NextResponse.json({ ok: false, error: "websiteUrl required" }, { status: 400 });
  if (!/^https?:\/\//i.test(photoUrl)) return NextResponse.json({ ok: false, error: "Upload a presenter photo first." }, { status: 400 });
  const concepts = (Array.isArray(body.concepts) ? body.concepts : []).filter(
    (c): c is UgcConcept => !!c && (c.format === "reaction" || c.format === "cartoon" || c.format === "review") && typeof c.idea === "string",
  );
  if (concepts.length !== 3) return NextResponse.json({ ok: false, error: "Run Analyze first — 3 concepts required." }, { status: 400 });

  if (!(await isAuthorized(req, body.accessToken))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });

  const productSummary = String(body.productSummary ?? "").trim().slice(0, 600);
  const websiteText = String(body.websiteText ?? "").trim().slice(0, 3000);
  const clientType: ClientType = body.clientType === "physical" || body.clientType === "service" ? body.clientType : "app";
  const language = String(body.language ?? "English").trim().slice(0, 40) || "English";
  // Pack display name — the site's domain, cleaned up ("velloagents.com" → "Velloagents").
  const clientName = (() => {
    try {
      const host = new URL(websiteUrl).hostname.replace(/^www\./i, "");
      const stem = host.split(".")[0] ?? host;
      return stem.charAt(0).toUpperCase() + stem.slice(1);
    } catch { return websiteUrl.slice(0, 40); }
  })();

  // ── Normalize EVERY reference image ONCE, up front. Kie's remote fetcher gets
  // 403'd by hotlink/bot protection on marketing-site images, and one
  // unfetchable ref fails the whole render request. normalizeImageForKie
  // re-hosts to a public Supabase .png; optional refs we can't fetch are
  // DROPPED. The presenter photo keeps its original URL as a last resort.
  const { normalizeImageForKie } = await import("@/lib/server/imageForKie");
  const isKiePng = (u: string | null): u is string => !!u && /\.png(\?|#|$)/i.test(u);
  const normalizeOrDrop = async (u: string, idx: number): Promise<string> => {
    if (!/^https?:\/\//i.test(u)) return "";
    const n = await normalizeImageForKie(u, idx);
    return isKiePng(n) ? n : "";
  };
  // Product refs: the analyze step's vision-ranked list (best first, <=3);
  // legacy callers may still send only the single productImageUrl.
  const rawProductRefs = [...new Set([
    ...(Array.isArray(body.productImageUrls) ? body.productImageUrls.map((u) => String(u ?? "").trim()) : []),
    String(body.productImageUrl ?? "").trim(),
  ].filter(Boolean))].slice(0, 3);
  const [normPhoto, screenshotUrl, ...normProductRefs] = await Promise.all([
    normalizeImageForKie(photoUrl, 0),
    normalizeOrDrop(String(body.screenshotUrl ?? "").trim(), 1),
    ...rawProductRefs.map((u, i) => normalizeOrDrop(u, 2 + i)),
  ]);
  const productImageUrls = normProductRefs.filter(Boolean);
  const productImageUrl = productImageUrls[0] ?? "";
  const normalizedPhotoUrl = isKiePng(normPhoto) ? normPhoto : photoUrl;
  if (rawProductRefs.length > 0 && productImageUrls.length === 0) {
    console.warn(`[ugc-sample] all product images dropped (unfetchable for Kie): ${rawProductRefs[0].slice(0, 120)}`);
  }
  const convex = new ConvexHttpClient(CONVEX_URL);

  const runId = (await convex.mutation(CREATE_RUN, {
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    websiteUrl,
    clientName,
    language,
    clientType,
    photoUrl,
    ...(productSummary ? { productSummary } : {}),
    ...(websiteText ? { websiteText } : {}),
    ...(screenshotUrl ? { screenshotUrl } : {}),
    ...(productImageUrl ? { productImageUrl } : {}),
    ...(productImageUrls.length ? { productImageUrls } : {}),
    slots: [
      ...concepts.map((c) => ({
        type: c.format,
        label: SLOT_DEFS[c.format].label,
        engine: SLOT_DEFS[c.format].engineId,
        status: "pending",
        concept: String(c.idea).slice(0, 600),
      })),
      // Zero-generation-cost text-story slots (random stock clip + burned story).
      { type: "story-fomo", label: "FOMO Story (stock)", engine: "stock+text", status: "pending", concept: "Sarcastic FOMO text story over a random stock clip" },
      { type: "story-emotional", label: "Emotional Story (stock)", engine: "stock+text", status: "pending", concept: "Heartfelt text story over a random stock clip, different audience" },
      // User's-POV photo-dump carousel — 5 slides on Nano Banana 2 Lite.
      { type: "carousel", label: "Carousel · 5 slides", engine: "nano-banana-2", status: "pending", concept: "A real user's day-in-my-life photo dump — the product appears naturally in one slide" },
    ],
  })) as string;

  const ctx: UgcSlotCtx = {
    convex,
    runId,
    req,
    websiteUrl,
    productContext: [
      `WEBSITE: ${websiteUrl}`,
      productSummary ? `PRODUCT SUMMARY: ${productSummary}` : "",
      websiteText ? `WEBSITE CONTENT (scraped): ${websiteText}` : "",
    ].filter(Boolean).join("\n"),
    clientType,
    language,
    normalizedPhotoUrl,
    screenshotUrl,
    productImageUrl,
    productImageUrls,
  };

  // Background render, one worker per slot. void'd by design (see route header).
  void (async () => {
    void runCarouselSlot(ctx, concepts.length + 2);
    const { listStockClips, pickRandomClips } = await import("@/lib/server/stockClips");
    const stockPicks = pickRandomClips(await listStockClips(), 2);
    void runStorySlot(ctx, concepts.length, "story-fomo", stockPicks[0]);
    void runStorySlot(ctx, concepts.length + 1, "story-emotional", stockPicks[1] ?? stockPicks[0]);
    await Promise.all(concepts.map((concept, index) => runConceptSlot(ctx, index, concept)));
    console.log(`[ugc-sample] run ${runId} finished concept slots`);
  })();

  return NextResponse.json({ ok: true, runId });
}
