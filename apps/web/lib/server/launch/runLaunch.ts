/**
 * Launch orchestrator — the background job behind POST /api/launch/start.
 *
 *   analyzing → naming → minting → rendering → done | failed
 *
 * Every dependency is injected (LaunchDeps) so the sequencing is unit-tested
 * without Kie/Convex; `defaultLaunchDeps` wires the real ones. Stage failures
 * are written to the run doc; the doc always reaches a terminal stage.
 */
import type { NextRequest } from "next/server";
import type { ConvexHttpClient } from "convex/browser";
import type { UgcConcept } from "@/lib/server/ugcSampleWorkers";
import type { AgentIdentity, WebsiteAnalysis } from "./analyzeWebsite";

export interface LaunchClip {
  templateId: string;
  templateLabel: string;
  ok: boolean;
  clipUrl?: string;
  title?: string;
  error?: string;
}

export interface LaunchPatch {
  stage?: "analyzing" | "naming" | "minting" | "rendering" | "done" | "failed";
  error?: string;
  productSummary?: string;
  agentName?: string;
  handle?: string;
  niche?: string;
  avatarUrl?: string;
  mintAddress?: string;
  ugcRunId?: string;
  samplesSkipped?: boolean;
  clips?: LaunchClip[];
  clipsError?: string;
}

export interface LaunchDeps {
  analyze: (websiteUrl: string) => Promise<WebsiteAnalysis>;
  /** Text-to-image presenter portrait (Kie-safe URL). Doubles as the agent avatar. */
  makePresenter: (a: WebsiteAnalysis) => Promise<string>;
  mint: (args: { runId: string; creatorWallet: string; identity: AgentIdentity; productSummary: string; websiteUrl: string; avatarUrl: string }) => Promise<{ mintAddress: string }>;
  /** Create the ugcSampleRuns doc + fire the 3 concept workers; returns the run id. */
  startUgc: (args: { analysis: WebsiteAnalysis; presenterUrl: string; websiteUrl: string; mintAddress: string }) => Promise<string>;
  renderClips: (sourceUrl: string) => Promise<LaunchClip[]>;
  patch: (fields: LaunchPatch) => Promise<void>;
}

export interface LaunchInputArgs {
  runId: string;
  websiteUrl: string;
  sourceUrl?: string;
  creatorWallet: string;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);

export async function runLaunch(deps: LaunchDeps, input: LaunchInputArgs): Promise<void> {
  const { runId, websiteUrl, sourceUrl, creatorWallet } = input;
  const safePatch = (f: LaunchPatch) => deps.patch(f).catch((e) => console.error(`[launch ${runId}] patch failed: ${msg(e)}`));

  // 1. Analyze (stage already "analyzing" at create).
  let analysis: WebsiteAnalysis;
  try {
    analysis = await deps.analyze(websiteUrl);
  } catch (e) {
    await safePatch({ stage: "failed", error: msg(e) });
    return;
  }
  await safePatch({
    stage: "naming",
    productSummary: analysis.productSummary,
    agentName: analysis.identity.agentName,
    handle: analysis.identity.handle,
    niche: analysis.identity.niche,
  });

  // 2. Presenter portrait = UGC presenter photo + agent avatar. Best-effort:
  //    without it the agent still mints (dicebear) but the samples can't run
  //    (the UGC workers need a presenter identity reference).
  let presenterUrl = "";
  try {
    presenterUrl = await deps.makePresenter(analysis);
  } catch (e) {
    console.warn(`[launch ${runId}] presenter generation failed: ${msg(e)}`);
  }
  const avatarUrl = presenterUrl || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(analysis.identity.handle)}`;
  await safePatch({ stage: "minting", avatarUrl });

  // 3. Mint (headless, internal). The agent is the deliverable — a mint
  //    failure fails the launch.
  let mintAddress: string;
  try {
    ({ mintAddress } = await deps.mint({ runId, creatorWallet, identity: analysis.identity, productSummary: analysis.productSummary, websiteUrl, avatarUrl }));
  } catch (e) {
    await safePatch({ stage: "failed", error: `Agent mint failed: ${msg(e)}` });
    return;
  }
  await safePatch({ stage: "rendering", mintAddress });

  // 4. Samples (3 UGC concepts) + optional clips, concurrently. Either can
  //    fail without failing the launch — the page shows what landed.
  const ugcP: Promise<void> = presenterUrl
    ? deps.startUgc({ analysis, presenterUrl, websiteUrl, mintAddress })
        .then((ugcRunId) => safePatch({ ugcRunId }))
        .catch((e) => safePatch({ samplesSkipped: true, error: `Samples failed to start: ${msg(e)}` }))
    : safePatch({ samplesSkipped: true });
  const clipsP: Promise<void> = sourceUrl
    ? deps.renderClips(sourceUrl)
        .then((clips) => safePatch({ clips }))
        .catch((e) => safePatch({ clipsError: msg(e) }))
    : Promise.resolve();
  await Promise.all([ugcP, clipsP]);
  await safePatch({ stage: "done" });
}

// ── Production wiring ────────────────────────────────────────────────────────

export function defaultLaunchDeps(convex: ConvexHttpClient, runId: string, req?: NextRequest): LaunchDeps {
  const SECRET = process.env.INTERNAL_CRON_SECRET ?? "";
  return {
    analyze: async (websiteUrl) => {
      const { analyzeWebsite } = await import("./analyzeWebsite");
      return analyzeWebsite({ websiteUrl, clientType: "app" });
    },

    makePresenter: async (a) => {
      const { generateCarouselImage } = await import("@/lib/server/carouselImage");
      const { resolveImageEngine } = await import("@/lib/builder/imageEngines");
      const { normalizeImageForKie } = await import("@/lib/server/imageForKie");
      const id = a.identity;
      const prompt = [
        `Candid smartphone selfie portrait of ${id.agentName}, a real ${id.niche} content creator in her mid-20s, natural skin texture, soft daylight, plain apartment background, looking just past the lens, slight relaxed smile.`,
        `Shot on a phone front camera, 9:16, no text, no logo, no watermark, no filter look.`,
        id.audience ? `She makes short videos for: ${id.audience}.` : "",
      ].filter(Boolean).join(" ");
      const { imageUrl } = await generateCarouselImage({
        prompt,
        engine: resolveImageEngine("nano-banana-pro"),
        aspectRatio: "9:16",
        maxWaitMs: 150_000,
      });
      const norm = await normalizeImageForKie(imageUrl, 0);
      return norm && /\.png(\?|#|$)/i.test(norm) ? norm : imageUrl;
    },

    mint: async ({ creatorWallet, identity, productSummary, websiteUrl, avatarUrl }) => {
      const { fetchSelf } = await import("@/lib/server/fetchInternal");
      const sessionId = `launch_${runId}`;
      const res = await fetchSelf("/api/nft/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET },
        body: JSON.stringify({
          sessionId,
          txSignature: `launch_${runId}`,
          creatorWallet,
          agentBlueprint: {
            agentType: "influencer",
            persona: {
              name: identity.agentName,
              handle: identity.handle,
              niche: identity.niche,
              language: identity.language,
              audience: identity.audience,
              backstory: `${identity.agentName} is the creator voice for ${websiteUrl}. ${productSummary}`.slice(0, 600),
              contentPillars: identity.pillars,
            },
          },
          avatarUrls: [avatarUrl],
        }),
      }, req);
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; mintAddress?: string; error?: string };
      if (!res.ok || !j.mintAddress) throw new Error(j.error ?? `HTTP ${res.status}`);
      return { mintAddress: j.mintAddress };
    },

    startUgc: async ({ analysis, presenterUrl, websiteUrl }) => {
      const { api } = await import("@/convex/_generated/api");
      const { SLOT_DEFS, runConceptSlot } = await import("@/lib/server/ugcSampleWorkers");
      const { normalizeImageForKie } = await import("@/lib/server/imageForKie");
      const isKiePng = (u: string | null): u is string => !!u && /\.png(\?|#|$)/i.test(u);
      const normalizeOrDrop = async (u: string, idx: number): Promise<string> => {
        if (!/^https?:\/\//i.test(u)) return "";
        const n = await normalizeImageForKie(u, idx);
        return isKiePng(n) ? n : "";
      };
      const [screenshotUrl, ...refs] = await Promise.all([
        normalizeOrDrop(analysis.screenshotUrl, 1),
        ...analysis.productImageUrls.slice(0, 3).map((u, i) => normalizeOrDrop(u, 2 + i)),
      ]);
      const productImageUrls = refs.filter(Boolean);
      const concepts: UgcConcept[] = analysis.concepts;
      const ugcRunId = (await convex.mutation(api.ugcSampleRuns.create, {
        authSecret: SECRET,
        websiteUrl,
        clientName: analysis.identity.agentName,
        language: analysis.identity.language,
        clientType: "app",
        photoUrl: presenterUrl,
        productSummary: analysis.productSummary,
        websiteText: analysis.websiteText,
        ...(screenshotUrl ? { screenshotUrl } : {}),
        ...(productImageUrls[0] ? { productImageUrl: productImageUrls[0] } : {}),
        ...(productImageUrls.length ? { productImageUrls } : {}),
        slots: concepts.map((c) => ({
          type: c.format, label: SLOT_DEFS[c.format].label, engine: SLOT_DEFS[c.format].engineId, status: "pending", concept: c.idea.slice(0, 600),
        })),
      })) as string;
      const ctx = {
        convex, runId: ugcRunId, req, websiteUrl,
        productContext: [`WEBSITE: ${websiteUrl}`, `PRODUCT SUMMARY: ${analysis.productSummary}`, analysis.websiteText ? `WEBSITE CONTENT (scraped): ${analysis.websiteText}` : ""].filter(Boolean).join("\n"),
        clientType: "app" as const,
        language: analysis.identity.language,
        normalizedPhotoUrl: presenterUrl,
        screenshotUrl,
        productImageUrl: productImageUrls[0] ?? "",
        productImageUrls,
      };
      // Slot progress lives on the ugcSampleRuns doc (the page subscribes to
      // it); the launch itself reaches "done" once the workers settle.
      await Promise.all(concepts.map((c, i) => runConceptSlot(ctx, i, c))).then(
        () => console.log(`[launch ${runId}] ugc slots settled (${ugcRunId})`),
        (e) => console.error(`[launch ${runId}] ugc slots error: ${msg(e)}`),
      );
      return ugcRunId;
    },

    renderClips: async (sourceUrl) => {
      const { fetchSelf } = await import("@/lib/server/fetchInternal");
      const res = await fetchSelf("/api/admin/samples/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Secret": SECRET },
        body: JSON.stringify({ sourceUrl, templates: ["podcast", "genz", "aliabdaal"] }),
      }, req);
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; clips?: Array<{ templateId: string; templateLabel: string; ok: boolean; clipUrl?: string; title?: string; error?: string }> };
      if (!res.ok || !j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      return (j.clips ?? []).map((c) => ({
        templateId: c.templateId, templateLabel: c.templateLabel, ok: !!c.ok,
        ...(c.clipUrl ? { clipUrl: c.clipUrl } : {}), ...(c.title ? { title: c.title } : {}), ...(c.error ? { error: c.error } : {}),
      }));
    },

    patch: async (fields) => {
      const { api } = await import("@/convex/_generated/api");
      const { ugcRunId, ...rest } = fields;
      await convex.mutation(api.launchRuns.patch, {
        runId: runId as never,
        authSecret: SECRET,
        ...rest,
        ...(ugcRunId ? { ugcRunId: ugcRunId as never } : {}),
      });
    },
  };
}
