// The influencer heartbeat pipeline for Show-Bible agents:
//   taste update → expire stale → ideate (pool low) → select → produce → advance rotation.
// LLMs fill content; the stage ORDER is fixed — this is what replaces the
// free-form heartbeat planner's guesswork for bible agents.
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { generateIdeas, type CampaignOffer } from "./ideation";
import { isJoinableUgcCampaign } from "@/lib/campaignLifecycle";
import { updateTasteProfile } from "./tasteProfile";
import {
  normalizeShowBible, normalizeRotationState, advanceRotation, resolveBibleDirectives,
} from "../builder/showBible";
import { fillFormatPrompt } from "../builder/formatPromptBuilder";
import { formatById } from "../builder/formatCatalog";

export interface SelectableIdea {
  _id: string; status: string; score: number; source: string;
  createdAt: number; expiresAt?: number;
  intent?: string; campaignId?: string;
}

/**
 * Influencer-balance guards on the producible pool:
 * - never two promo productions in a row (unless promo is all that's fresh);
 * - campaign ideas drop once the day's brand budget (maxBrandsPerDay) is spent.
 */
export function applySelectionGuards<T extends SelectableIdea>(
  pool: T[],
  opts: { lastProducedIntent?: string; campaignBudgetLeft: number },
): T[] {
  let out = pool;
  if (opts.campaignBudgetLeft <= 0) out = out.filter((i) => !i.campaignId);
  if (opts.lastProducedIntent === "promo") {
    const nonPromo = out.filter((i) => (i.intent ?? "entertain") !== "promo");
    if (nonPromo.length) out = nonPromo;
  }
  return out;
}

export function freshnessDecay(idea: Pick<SelectableIdea, "source" | "createdAt" | "expiresAt">, now: number): number {
  if (idea.source !== "news" || !idea.expiresAt) return 1;
  if (idea.expiresAt <= now) return 0;
  const total = idea.expiresAt - idea.createdAt;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (idea.expiresAt - now) / total));
}

/** Approved ideas win (operator's word, FIFO); else max score × freshness. */
export function selectIdea<T extends SelectableIdea>(ideas: T[]): T | null {
  const now = Date.now();
  const approved = ideas.filter((i) => i.status === "approved");
  if (approved.length) return approved.sort((a, b) => a.createdAt - b.createdAt)[0];
  const scored = ideas
    .map((i) => ({ i, s: i.score * freshnessDecay(i, now) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored[0]?.i ?? null;
}

const MIN_FRESH_POOL = 5;
const SECRET = () => process.env.INTERNAL_CRON_SECRET ?? "";

export interface IdeaPipelineResult { queued: number; ideated: number; message: string; }

/** Run one heartbeat's worth of the idea pipeline. Returns 0 or 1 queued
 *  create_video tasks; the caller dispatches pending tasks as usual. */
export async function runIdeaPipeline(args: {
  convex: ConvexHttpClient;
  mintAddress: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: Record<string, any>;
}): Promise<IdeaPipelineResult> {
  const { convex, mintAddress, agent } = args;
  const bible = normalizeShowBible(agent.showBible);
  if (!bible) return { queued: 0, ideated: 0, message: "no bible" };

  // 0. taste update — fold unconsumed feedback events into the prose profile
  //    BEFORE ideation reads it. Best-effort: taste is steering, never blocking.
  try {
    const events = await convex.mutation(api.tasteEvents.takeUnconsumed, { mintAddress, authSecret: SECRET() });
    if (Array.isArray(events) && events.length >= 3) {
      const prose = await updateTasteProfile({ oldProse: String(agent.tasteProfile?.prose ?? ""), events });
      if (prose) {
        const tasteProfile = {
          prose,
          updatedAt: Date.now(),
          eventCount: (Number(agent.tasteProfile?.eventCount) || 0) + events.length,
        };
        await convex.mutation(api.influencers.setTasteProfile, { mintAddress, tasteProfile, authSecret: SECRET() });
        agent.tasteProfile = tasteProfile;
      }
    }
  } catch (e) {
    console.warn("[ideaPipeline] taste update skipped:", e instanceof Error ? e.message : e);
  }

  // 1. expire stale news ideas
  await convex.mutation(api.contentIdeas.expireStalePublic, { mintAddress, authSecret: SECRET() }).catch(() => null);

  // Recent idea history feeds BOTH ideation (mix rebalancing) and selection
  // guards (no consecutive promo, daily brand budget).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentIdeas: any[] = await convex.query(api.contentIdeas.listForMint, { mintAddress, limit: 50 }).catch(() => []);
  const producedRecent = recentIdeas.filter((i) => i.status === "produced" || i.status === "producing");
  const recentIntents = producedRecent.map((i) => String(i.intent ?? "entertain")).slice(0, 8);
  const lastProducedIntent = recentIntents[0];
  const maxBrandsPerDay = Math.max(0, Number(agent.videoConfig?.maxBrandsPerDay ?? 1));
  // Approximation: idea.createdAt stands in for production time (ideas are
  // produced within their freshness window, so this bounds the daily brand cap).
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const campaignsSpent = producedRecent.filter((i) => i.campaignId && i.createdAt > dayAgo).length;
  const campaignBudgetLeft = maxBrandsPerDay - campaignsSpent;

  // Joinable brand campaigns matching the niche — persona-native promo targets.
  let campaignOffers: CampaignOffer[] = [];
  if (campaignBudgetLeft > 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const all: any[] = await convex.query(api.campaigns.list, {});
      campaignOffers = (Array.isArray(all) ? all : [])
        .filter((c) => isJoinableUgcCampaign(c) &&
          (!Array.isArray(c.targetNiche) || c.targetNiche.includes(agent.niche) || c.targetNiche.includes("all")))
        .slice(0, 3)
        .map((c) => ({ id: String(c._id), title: String(c.title ?? ""), brandName: String(c.brandName ?? ""), brief: String(c.brief ?? "") }));
    } catch { /* campaigns unavailable — organic ideas only */ }
  }

  // 2. ideate when the fresh pool is low
  let fresh = await convex.query(api.contentIdeas.listFreshProposed, { mintAddress });
  let ideated = 0;
  if (fresh.length < MIN_FRESH_POOL) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recentTasks: any[] = await convex.query(api.agentTasks.listByMint, { mintAddress, limit: 15 }).catch(() => []);
    const recentScriptTopics = (Array.isArray(recentTasks) ? recentTasks : [])
      .filter((t) => t?.type === "create_video")
      .map((t) => String(t?.title ?? "").replace(/^Create video:\s*/i, "").trim())
      .filter(Boolean);
    // Open series threads feed continuation ideas (best-effort).
    let openThreads: string[] = [];
    if (bible.contentEngine.seriesArcs) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const episodes: any[] = await convex.query(api.seriesEpisodes.recent, { mintAddress, limit: 6 });
        openThreads = (Array.isArray(episodes) ? episodes : [])
          .flatMap((e) => (Array.isArray(e?.openThreads) ? e.openThreads.map(String) : []))
          .filter(Boolean);
      } catch { /* series memory is optional */ }
    }
    const tasteProse = String(agent.tasteProfile?.prose ?? "");
    const candidates = await generateIdeas({
      bible, tasteProse, openThreads,
      recentHeadlines: recentIdeas.map((i: { headline: string }) => i.headline),
      recentScriptTopics,
      recentIntents,
      campaigns: campaignOffers,
    });
    if (candidates.length) {
      const r = await convex.mutation(api.contentIdeas.insertBatch, {
        mintAddress, ideas: candidates, authSecret: SECRET(),
      });
      ideated = r.inserted;
      fresh = await convex.query(api.contentIdeas.listFreshProposed, { mintAddress });
    }
  }

  // 3. select — review-ideas mode only produces operator-approved ideas
  const mode = String(agent.autonomyMode ?? "full-auto");
  const pool = applySelectionGuards(
    (mode === "review-ideas"
      ? fresh.filter((i: SelectableIdea) => i.status === "approved")
      : fresh) as unknown as SelectableIdea[],
    { lastProducedIntent, campaignBudgetLeft },
  );
  const idea = selectIdea(pool);
  if (!idea) {
    return {
      queued: 0, ideated,
      message: mode === "review-ideas" ? "waiting for idea approval" : "no viable idea",
    };
  }

  // 4. produce — one create_video agentTask carrying the idea + bible directives
  const rotation = normalizeRotationState(agent.rotationState);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullIdea = idea as any;
  // The idea was written FOR a specific video style (ideation stamps styleId) —
  // resolve THAT style's recipe (format/structure/hook/camera/duration) so the
  // produced video is exactly the kind of content the style defines. Ideas
  // without a styleId (legacy rows) keep the weighted-rotation pick.
  const directives = resolveBibleDirectives(bible, rotation, {
    durationSeconds: Number(fullIdea.suggestedDurationSec) || undefined,
    engine: typeof agent.videoEngine === "string" ? agent.videoEngine : undefined,
    ...(typeof fullIdea.styleId === "string" && fullIdea.styleId ? { styleId: fullIdea.styleId } : {}),
  });
  const input = {
    ideaId: idea._id,
    // Stamped so run-task can tell whether this idea's frozen bibleBrief
    // predates the operator's last Director-tab save — if the operator changed
    // format/settings AFTER this idea was queued, the frozen brief is stale and
    // must be re-resolved from the CURRENT bible/videoConfig instead of replayed
    // verbatim. See run-task/route.ts's staleIdea check.
    ideaCreatedAt: fullIdea.createdAt,
    topic: `${fullIdea.headline} — ${fullIdea.angle}`,
    durationSeconds: directives.durationSeconds,
    ...(typeof fullIdea.styleId === "string" && fullIdea.styleId ? { styleId: fullIdea.styleId } : {}),
    bibleBrief: { ...directives.brief, format: fullIdea.format || directives.brief.format },
    // Format-templated prompt (spec phase 1): when the rotation's format kind
    // is a catalog format, pre-compose the engine-neutral prompt here so the
    // render uses the format's structure instead of free-form guesswork.
    ...(formatById(fullIdea.format || directives.brief.format)?.pipeline === "generate"
      ? (() => {
          const formatId = fullIdea.format || directives.brief.format;
          // Pass the ALREADY-RESOLVED duration (engine-aware, wizard-clamped by
          // resolveBibleDirectives) so the filled template and the render agree.
          // Letting fillFormatPrompt re-derive from the format's own band could
          // silently override a short engine-specific pick (e.g. 5s Grok) with
          // the format default.
          const filled = fillFormatPrompt({ formatId, topic: `${fullIdea.headline} — ${fullIdea.angle}`, bible, durationSec: directives.durationSeconds });
          return { formatPrompt: filled.prompt, formatId, durationSeconds: directives.durationSeconds };
        })()
      : {}),
    // newsRefs feeds videoScript.ts's "LIVE FACTS" block — fact TEXT, never
    // URLs (sourceRefs are real article links, for UI citation only; see
    // ideation.ts's IdeaCandidate doc comments for why these are separate).
    ...(fullIdea.source === "news" && Array.isArray(fullIdea.newsFacts) && fullIdea.newsFacts.length
      ? { newsRefs: fullIdea.newsFacts }
      : {}),
    // The research photo behind this idea — FALLBACK overlay image when
    // run-task's own headline-screenshot capture (the real article's <h1>,
    // see lib/server/articleScreenshot.ts) fails or times out. See
    // overlay-burn's imageOverlay + the Editor tab's Specials "Reference
    // Image" tool.
    ...(fullIdea.source === "news" && typeof fullIdea.referenceImageUrl === "string" && fullIdea.referenceImageUrl
      ? { newsImageUrl: fullIdea.referenceImageUrl }
      : {}),
    // The article this idea is actually grounded in — run-task screenshots
    // ITS headline for the overlay/context image, which is far more "this is
    // literally the story" than a loosely-related search photo.
    ...(fullIdea.source === "news" && Array.isArray(fullIdea.sourceRefs) && fullIdea.sourceRefs[0]
      ? { newsSourceUrl: fullIdea.sourceRefs[0] }
      : {}),
    // Campaign-native promo: run-task's campaign path crawls the brand context,
    // renders in persona, and (when auto-posting) records the submission.
    ...(fullIdea.campaignId ? { campaignId: fullIdea.campaignId } : {}),
    // review-video mode: render but do NOT auto-post — the operator releases it.
    ...(mode !== "review-video"
      ? { autoPost: { platforms: [] as string[], ...(fullIdea.campaignId ? { campaignId: fullIdea.campaignId } : {}) } }
      : {}),
  };
  await convex.mutation(api.agentTasks.create, {
    mintAddress, sessionId: mintAddress, type: "create_video",
    title: `Create video: ${fullIdea.headline}`.slice(0, 120),
    input: JSON.stringify(input),
    triggeredBy: "idea_pipeline", status: "pending",
    authSecret: SECRET(),
  });
  await convex.mutation(api.contentIdeas.setStatus, { ideaId: idea._id as never, status: "producing", authSecret: SECRET() });
  await convex.mutation(api.influencers.setRotationState, {
    mintAddress, rotationState: advanceRotation(rotation, bible), authSecret: SECRET(),
  }).catch(() => null);

  return { queued: 1, ideated, message: `producing: ${fullIdea.headline}` };
}
