import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { generateFittedScript } from "@/lib/server/videoScript";
import { estimateSecondsFromScript, resolveDurationRange } from "@/lib/builder/agentTypes";
import { resolveVideoDirectives } from "@/lib/builder/videoDirector";
import {
  resolveAgentDirectives, applyDirectivesToBrief, directiveBlock, isEmptyDirective,
} from "@/lib/server/agentDirectives";
import { buildAgentBrain } from "@/lib/server/agentBrain";
import { planVideoCreative } from "@/lib/server/creativeDirector";
import { ensureStaticFace } from "@/lib/server/staticFace";
import { requireInternalOrUserAuth, requireOwnerWithSiws } from "@/lib/server/requireAuth";
import { assertPublicHttpUrl } from "@/lib/server/downloader";

// Market-page "Generate Content" endpoint.
// Runs the SAME pipeline as the builder copilot:
//   1. Script — generateVideoScript (third-person framing + Claude→Gemini→heuristic
//      fallback, so it NEVER throws; the old bespoke first-person prompt here used
//      to get refused by Claude → "Script LLM returned no JSON").
//   2. Video — generateVideoFromScript renders a storyboard + multi-clip Veo extend
//      sized to the script's duration.
//   3. Distribution — post the finished video to the agent's CONNECTED social
//      accounts (same upload-post path the builder's post_content task uses).
// Everything is enriched with the campaign's brief so the content is on-brand.

// Multi-segment Veo extend chains can take 2-5 minutes. Default Next.js function
// timeout (60s) murders the pipeline mid-chain — bump to the 5-minute ceiling.
export const maxDuration = 300;
export const runtime = "nodejs";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

function detectCampaignClass(campaignType?: string, contentLinks?: string[]): "ugc" | "clipping" | "agent_task" | "content_reward" {
  const t = (campaignType ?? "").toLowerCase();
  if (t === "agent_task") return "agent_task";
  if (t === "bounty" || t === "" || t === "ugc") return "ugc";
  if (t === "marketing" && contentLinks && contentLinks.length > 0) return "clipping";
  if (t === "marketing") return "ugc";
  return "content_reward";
}

const CLASS_FORMAT: Record<string, string> = {
  ugc: "Original UGC short-form video (TikTok / Reels / Shorts) made from scratch.",
  clipping: "Reframe the brand's existing long-form content into a punchy viral short.",
  agent_task: "A specific branded deliverable the campaign needs produced.",
  content_reward: "A native, in-voice promo short that earns from the campaign treasury.",
};

interface InfluencerInput { id: string; name: string; handle?: string; avatarUrl: string; niche: string; language: string; archetype?: string; description?: string; personality?: Record<string, number> }
interface CampaignInput {
  id?: string; title: string; brandName: string;
  brief?: string; campaignType?: string; budget?: number; ratePerThousandViews?: number;
  deliverables?: string; contentLinks?: string[];
  // Rich campaign understanding (passed from the scanner)
  description?: string;
  requirements?: string[];
  websiteUrl?: string;
  audience?: string;
  brandKnowledge?: string;
  platforms?: string[];
  /** Real product/brand image to reference in the video (not a logo/SVG). */
  productImageUrl?: string;
  /** Which source the match came from — only "campaign" rows are real
   *  `campaigns` docs that can receive an on-chain submission. */
  source?: "campaign" | "builder";
}

// A usable static raster reference: real http image, not a GIF and not an SVG /
// dicebear placeholder (Veo can't lock identity onto vector logos).
function usableImageRef(u?: string): string | null {
  if (!u || !/^https?:\/\//i.test(u)) return null;
  if (/\.(gif|svg)(\?|#|$)/i.test(u) || /dicebear\.com/i.test(u)) return null;
  return u;
}

// Veo fetches reference images server-side and rejects the WHOLE request if any
// one URL 404s or isn't an image. Preflight each so a single bad campaign image
// can't kill the render — unreachable refs are simply dropped.
async function isFetchableImage(url: string): Promise<boolean> {
  const check = async (method: "HEAD" | "GET") => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      await assertPublicHttpUrl(url);
      const res = await fetch(url, {
        method,
        redirect: "manual",
        signal: ctrl.signal,
        headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return false;
        await assertPublicHttpUrl(new URL(loc, url).toString());
        return false; // re-validated hop is safe but not yet confirmed an image — drop conservatively
      }
      const ct = res.headers.get("content-type") ?? "";
      return res.ok && /image\//i.test(ct);
    } finally {
      clearTimeout(t);
    }
  };
  try {
    if (await check("HEAD")) return true;
  } catch { /* some hosts reject HEAD — try GET */ }
  try {
    return await check("GET");
  } catch {
    return false;
  }
}

// Pick the first real http(s) URL from any of the campaign's link fields — the
// brand site or app landing page the agent should study and point viewers to.
function resolveCampaignUrl(c: CampaignInput): string | null {
  const candidates = [c.websiteUrl, ...(c.contentLinks ?? [])];
  for (const u of candidates) {
    if (typeof u === "string" && /^https?:\/\/\S+\.\S+/i.test(u.trim())) return u.trim();
  }
  return null;
}

// "Open and show the campaign website" — fetch the brand's page and reduce it to
// readable text so the script is grounded in the REAL product (what it does, its
// positioning, real feature names) instead of a generic placeholder. Best-effort
// with a short timeout; returns "" on any failure so generation always proceeds.
async function fetchWebsiteText(url: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let current = url;
    let res: Response;
    // Manual redirects so EVERY hop is SSRF-revalidated (auto-follow could land on a metadata IP).
    for (let hop = 0; ; hop++) {
      if (hop > 5) { clearTimeout(timer); return ""; }
      await assertPublicHttpUrl(current);
      res = await fetch(current, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; VelloBot/1.0; +https://vello.app)" },
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        current = new URL(loc, current).toString();
        continue;
      }
      break;
    }
    clearTimeout(timer);
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) return "";
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return [
      titleMatch ? `TITLE: ${titleMatch[1].replace(/\s+/g, " ").trim()}` : "",
      metaDesc ? `DESCRIPTION: ${metaDesc[1].trim()}` : "",
      body.slice(0, 2200),
    ].filter(Boolean).join("\n").slice(0, 2600);
  } catch {
    return "";
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    if (!CONVEX_URL) return NextResponse.json({ error: "Convex not configured" }, { status: 500 });

    // Auth: internal (cron) callers pass through; user callers must present a valid
    // Privy Bearer + SIWS session and OWN the agent (checked once agentRecord loads).
    const auth = await requireInternalOrUserAuth(req);
    if (auth.error) return auth.error;

    const { influencer, campaign } = await req.json() as {
      influencer: InfluencerInput;
      campaign: CampaignInput;
    };
    if (!influencer || !campaign) {
      return NextResponse.json({ error: "influencer and campaign required" }, { status: 400 });
    }

    // ── Pull full agent context from Convex (knowledge files, memories, draft/persona)
    const convex = new ConvexHttpClient(CONVEX_URL);
    const mintAddress = influencer.id;
    const [agentRecord, draft, memoriesRaw, skillFilesRaw] = await Promise.all([
      convex.query(api.influencers.getByMint, { mintAddress }).catch(() => null),
      convex.query(api.nftAgents.getDraftByMint, { mintAddress }).catch(() => null),
      convex.query(api.agentTasks.recallMemories, { mintAddress, limit: 12 }).catch(() => []),
      // Wired AI-Clipper apps (agentSkillFiles) → bridged into the UGC overlays below
      // so Trending Audio / Auto Hook / Captions burn on campaign UGC videos too.
      convex.query(api.agentSkillFiles.listByMint, { mintAddress }).catch(() => []),
    ]);
    // Ownership gate — only the agent's owner (SIWS-proven) may load its private
    // knowledge/memories + spend on generation. Internal callers are pre-trusted.
    if (!auth.internal) {
      const ownerErr = requireOwnerWithSiws(auth, (agentRecord as { creatorWallet?: string; coCreatorWallets?: string[] } | null) ?? undefined);
      if (ownerErr) return ownerErr;
    }

    const sessionId = draft?.sessionId ?? "";
    const knowledgeRaw = sessionId
      ? await convex.query(api.agentKnowledge.listBySession, { sessionId }).catch(() => [])
      : [];

    const knowledge = (knowledgeRaw ?? []).map((k: Doc<"agentKnowledge">) => ({ title: k.title, content: k.content }));
    // `at` (creation time) is load-bearing for standing orders — recallMemories ranks
    // by importance, so only the timestamp says which instruction is the latest.
    const memories = (memoriesRaw ?? []).map((m: Doc<"agentMemory">) => ({ kind: m.kind, summary: m.summary, importance: m.importance, at: m._creationTime }));
    // The operator's STANDING ORDERS from the builder copilot (agentMemory) —
    // they override the persona/Director defaults for this campaign video too, so a
    // "commercial only, no speaking" agent doesn't revert to a talking head the
    // moment it shoots for a brand.
    // Directives predating the operator's last manual Director-tab save are
    // stale — the saved config wins (same rule as run-task).
    const orders = resolveAgentDirectives(
      memories,
      (agentRecord as { videoConfig?: { manualUpdatedAt?: number } } | null)?.videoConfig?.manualUpdatedAt,
    );
    let standingOrders = directiveBlock(orders);
    // LEARNED STYLE (Learn tab) — selected example videos steer campaign renders
    // too (same block run-task appends). Best-effort.
    try {
      const styleRefs = await convex.query(api.agentStyleReferences.listSelected, { mintKey: mintAddress });
      const { styleReferenceBlock } = await import("@/lib/server/videoStyleLearn");
      const styleBlock = styleReferenceBlock(styleRefs ?? []);
      if (styleBlock) standingOrders = [standingOrders, styleBlock].filter(Boolean).join("\n\n");
    } catch { /* proceed without learned style */ }
    // Agent SKILLS — knowledge entries the agent saved as skills (category "skill"
    // or a "skill:" title prefix). Passed to the script generator so the content
    // applies the agent's learned playbooks, exactly like the builder does.
    const skills = (knowledgeRaw ?? [])
      .filter((k: Doc<"agentKnowledge">) => ((k as { category?: string }).category ?? "") === "skill" || /^skill:/i.test(k.title))
      .map((k: Doc<"agentKnowledge">) => ({ name: k.title.replace(/^skill:\s*/i, ""), instructions: k.content }));

    // ── Understand the campaign deeply ─────────────────────────────────────────
    //    Pull together every signal the scanner passed (description, requirements,
    //    audience, brand knowledge) AND open the brand's website/app page so the
    //    script reflects the REAL product, named correctly — not a placeholder.
    const campaignClass = detectCampaignClass(campaign.campaignType, campaign.contentLinks);
    const rateLine = campaign.ratePerThousandViews
      ? `Payout: $${campaign.ratePerThousandViews} per 1,000 views.`
      : campaign.budget ? `Budget: $${campaign.budget} USDC.` : "";
    const requirements = (campaign.requirements ?? []).filter(r => typeof r === "string" && r.trim());
    const campaignUrl = resolveCampaignUrl(campaign);
    const websiteText = campaignUrl ? await fetchWebsiteText(campaignUrl) : "";

    const campaignAsKnowledge = {
      title: `Campaign brief — ${campaign.brandName}`,
      content: [
        `Brand: ${campaign.brandName}`,
        `Campaign: ${campaign.title}`,
        campaign.description ? `What it is: ${campaign.description}` : "",
        campaign.brief && campaign.brief !== campaign.description ? `Brief / angle: ${campaign.brief}` : "",
        campaign.audience ? `Target audience: ${campaign.audience}` : "",
        requirements.length ? `Content requirements (follow these exactly):\n- ${requirements.join("\n- ")}` : "",
        campaign.deliverables ? `Deliverables: ${campaign.deliverables}` : "",
        campaign.brandKnowledge ? `Brand knowledge base: ${campaign.brandKnowledge.slice(0, 1200)}` : "",
        campaignUrl ? `Brand link: ${campaignUrl}` : "",
        websiteText ? `\nLIVE WEBSITE CONTENT (the real product — use real feature names, positioning, and tone from this):\n${websiteText}` : "",
      ].filter(Boolean).join("\n"),
    };
    const campaignAsMemory = {
      kind: "campaign-context",
      summary: `Shooting for ${campaign.brandName}: "${campaign.title}". ${(campaign.description ?? campaign.brief ?? "").slice(0, 160)}`,
      importance: 95,
    };

    // ── Step 1: agentic creative direction + time-fitted, campaign-aware script ─
    //    The director picks a FRESH format/angle/visual-treatment (grounded in the
    //    agent's brain + memory, avoiding recent formats) and a target length within
    //    the agent's duration range — so each video is UNIQUE and on-length. The
    //    fitted script then guarantees the spoken length matches that target, so the
    //    rendered video plays out complete (never cut off mid-script).
    const q = (draft?.questionnaire ?? {}) as Record<string, unknown>;
    const campaignContext = campaignAsKnowledge.content;
    const brain = buildAgentBrain({
      topic: campaign.title,
      knowledge: [campaignAsKnowledge, ...knowledge].map(k => ({ title: k.title, content: k.content })),
      memories: [campaignAsMemory, ...memories],
      skills,
    });
    const recentFormats = memories
      .map((m: { summary: string }) => (m.summary.match(/format[:=]\s*([a-z_]+)/i)?.[1] ?? ""))
      .filter(Boolean);
    const durationRange = resolveDurationRange(
      (agentRecord as { videoMinSeconds?: number } | null)?.videoMinSeconds,
      (agentRecord as { videoMaxSeconds?: number } | null)?.videoMaxSeconds,
    );
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    // A chat "speak/reply in X" standing directive must win over the agent's
    // onboarding-time `language` field — it was parsed and persisted correctly
    // but only ever reached the video-render prompt (via standingOrders below),
    // never the script-writing/creative-planning calls, so it was silently
    // dropped and every script kept whatever language was picked (or defaulted
    // to "English") at mint time.
    const scriptLanguage = orders.language || influencer.language;

    const { brief, targetSeconds } = await planVideoCreative({
      persona: {
        name: influencer.name, niche: influencer.niche, archetype: influencer.archetype,
        voiceArchetype: typeof q.voiceArchetype === "string" ? q.voiceArchetype : undefined,
        language: scriptLanguage,
        contentPillars: Array.isArray(q.contentPillars) ? (q.contentPillars as string[]) : [],
        // Seed the format pool with the operator's taste, else the campaign-class
        // format — the director still varies the ANGLE, VISUALS, and LENGTH.
        videoFormats: Array.isArray(q.videoFormats) && q.videoFormats.length
          ? (q.videoFormats as string[])
          : [CLASS_FORMAT[campaignClass] ?? CLASS_FORMAT.ugc],
      },
      brain,
      recentFormats,
      durationRange,
      seedTopic: campaign.title,
      campaignContext,
      nonce,
    });

    // Fold the campaign's promotion requirements into the director's brief so the
    // brand is featured, while KEEPING the director's varied format + visual style.
    const campaignStructure = [
      `Say the real brand name "${campaign.brandName}" out loud at least once — never a placeholder. Use the real product details/website above.`,
      requirements.length ? `Hit these campaign requirements: ${requirements.join("; ")}.` : "",
      campaign.audience ? `Speak to this audience: ${campaign.audience}.` : "",
      campaignUrl ? `End with a soft CTA pointing to ${campaignUrl}.` : "",
      rateLine,
      `Weave ${campaign.brandName} in naturally — never "sponsored by" ad-language.`,
    ].filter(Boolean).join(" ");
    brief.angle = `Promote ${campaign.brandName}${campaignUrl ? ` (${campaignUrl})` : ""} — ${brief.angle}`.slice(0, 240);
    brief.structureNotes = [campaignStructure, brief.structureNotes].filter(Boolean).join(" ").slice(0, 600);
    if (!isEmptyDirective(orders)) {
      const forced = applyDirectivesToBrief(
        { format: brief.format, angle: brief.angle, structureNotes: brief.structureNotes ?? "", visualTreatment: brief.visualTreatment ?? "" },
        orders,
      );
      brief.format = forced.format;
      brief.angle = forced.angle;
      brief.structureNotes = forced.structureNotes.slice(0, 600);
      brief.visualTreatment = forced.visualTreatment;
      console.log(`[generate-content] standing orders applied: ${JSON.stringify(orders)} → format=${brief.format}`);
    }

    const scripted = await generateFittedScript(
      {
        name: influencer.name,
        niche: influencer.niche,
        language: scriptLanguage,
        archetype: influencer.archetype,
      },
      {
        knowledge: [campaignAsKnowledge, ...knowledge],
        memories: [campaignAsMemory, ...memories],
        draft: draft ? { questionnaire: draft.questionnaire as Record<string, unknown> | undefined, characterBible: draft.characterBible } : null,
      },
      { topic: brief.topic || campaign.title, targetSeconds, skills, brief, campaignContext },
    );

    // ── Reference images: lock the NFT FACE + show the PRODUCT ─────────────────
    //    The agent avatar is frequently an animated GIF, which Veo drops →
    //    TEXT_2_VIDEO ("text video"). Pull a STATIC frame out of the GIF so the
    //    render uses reference-to-video with the actual NFT face. The campaign's
    //    real product image is added as a secondary reference so the product
    //    appears in-frame. Static draft avatars (if any) are included too.
    const rawAvatar = (agentRecord as { avatarUrl?: string } | null)?.avatarUrl ?? influencer.avatarUrl;
    const face = await ensureStaticFace(rawAvatar);
    const productImageRef = usableImageRef(campaign.productImageUrl);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draftStatics = (((draft as any)?.avatarUrls as string[] | undefined) ?? []).filter((u): u is string => Boolean(usableImageRef(u)));
    // Preflight the optional refs (face is our own extracted PNG → trusted). A
    // single unfetchable image makes Veo reject the whole request, so drop any
    // that don't resolve to a real image.
    const [productOk, ...draftOk] = await Promise.all([
      productImageRef ? isFetchableImage(productImageRef) : Promise.resolve(false),
      ...draftStatics.map((u) => isFetchableImage(u)),
    ]);
    const liveDraftStatics = draftStatics.filter((_, i) => draftOk[i]);
    // Face refs first (identity lock), then the product (so it shows in-frame).
    const referenceImageUrls = [
      ...liveDraftStatics,
      ...(productImageRef && productOk ? [productImageRef] : []),
    ];

    // ── Engine + caption + script-derived duration ────────────────────────────
    const videoModel = (agentRecord as { videoEngine?: string } | null)?.videoEngine === "veo3" ? "veo3"
      : (agentRecord as { videoEngine?: string } | null)?.videoEngine === "veo3_lite" ? "veo3_lite"
      : "veo3_fast";
    // The fitted script already reconciled its spoken length toward the target,
    // so the rendered video covers the whole script and plays out complete.
    const scriptDurationSeconds = scripted.fittedSeconds ?? estimateSecondsFromScript(scripted.scriptText);
    const hashtags = (scripted.hashtags ?? []).map(h => h.trim()).filter(Boolean);
    const ctaLine = campaignUrl
      ? `${/app|play\.google|apps\.apple/i.test(campaignUrl) ? "Get the app" : "Try it"}: ${campaignUrl}`
      : "";
    const postCaption = [scripted.caption?.trim(), ctaLine, hashtags.join(" ")].filter(Boolean).join("\n\n");

    // ── Campaign submission (created up-front, PENDING) so the background render
    //    job can attach the live post link once it publishes. ────────────────────
    let submission: { status: string; note?: string; submissionId?: string } | null = null;
    let submissionId: string | undefined;
    if (campaign.source === "campaign" && typeof campaign.id === "string" && campaign.id.length > 0) {
      const campaignId = campaign.id as Id<"campaigns">;
      const submitterWallet =
        (agentRecord as { creatorWallet?: string; agentWallet?: string } | null)?.creatorWallet ??
        (agentRecord as { agentWallet?: string } | null)?.agentWallet ??
        mintAddress;
      try {
        const subId = await convex.mutation(api.submissions.submit, {
          campaignId, influencerMint: mintAddress, influencerName: influencer.name, submitterWallet,
        });
        submissionId = subId as string;
        submission = { status: "submitted", submissionId };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already submitted/i.test(msg)) {
          try {
            const existing = await convex.query(api.submissions.getForCampaign, { campaignId, influencerMint: mintAddress });
            if (existing?._id) { submissionId = existing._id as string; submission = { status: "submitted", submissionId, note: "existing submission" }; }
            else submission = { status: "already_submitted" };
          } catch { submission = { status: "already_submitted" }; }
        } else {
          submission = { status: "failed", note: msg };
        }
      }
    } else if (campaign.source && campaign.source !== "campaign") {
      submission = { status: "not_applicable", note: "This campaign source doesn't accept on-chain submissions yet." };
    }

    // ── Defer the render to the SAME Convex job the builder uses ────────────────
    //    The job runs the full storyboard → multi-clip → STITCH pipeline with a
    //    10-minute budget and ffmpeg stitching, so the video length follows the
    //    SCRIPT (stitched, > 8s) instead of stopping at the first clip — which is
    //    what happened when this route rendered inline under the 300s HTTP limit.
    //    On completion the job marks the task succeeded (→ Creations), auto-posts
    //    to all connected accounts, and attaches the live link to the submission.
    const taskId = await convex.mutation(api.agentTasks.create, {
      mintAddress,
      sessionId: draft?.sessionId || mintAddress,
      type: "create_video",
      title: `${campaign.brandName} — ${campaign.title}`.slice(0, 80),
      input: JSON.stringify({ campaign: { id: campaign.id ?? null, brand: campaign.brandName, title: campaign.title, url: campaignUrl ?? null }, topic: campaign.title }),
      triggeredBy: "campaign",
      status: "running",
      authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
    });

    const requiredPlatforms = (campaign.platforms ?? []).map(p => (p.toLowerCase() === "twitter" ? "x" : p.toLowerCase())).filter(Boolean);
    const personality = influencer.personality
      ? { warmth: influencer.personality.warmth, humor: influencer.personality.humor, authority: influencer.personality.authority, boldness: influencer.personality.boldness }
      : undefined;

    // Overlays (captions / hook text / trending audio) are burned in the render's
    // finalize phase — driven by the agent's INSTALLED SKILLS (video.captions /
    // video.autohook / music.trendingaudio) plus the Director's style config. This
    // mirrors the builder/autonomy path (run-task): without it, render-step sees no
    // `overlays`, skips the overlay-burn phase, and UGC videos ship with NO captions
    // or hook even when those skills are installed. resolveVideoDirectives reads
    // agentRecord.installedSkills + agentRecord.videoConfig; we take only .overlays
    // (the brief/duration are already resolved above via planVideoCreative).
    const overlayDirectives = resolveVideoDirectives(
      (agentRecord ?? {}) as Parameters<typeof resolveVideoDirectives>[0],
      { durationSeconds: scriptDurationSeconds, format: brief.format },
      `${mintAddress}:${campaign.title}`,
      undefined,
      ((skillFilesRaw ?? []) as Array<{ skillId: string; wired?: boolean; config?: Record<string, unknown> | null }>).map(
        (sf) => ({ skillId: sf.skillId, wired: sf.wired, config: sf.config ?? undefined }),
      ),
    );

    // CHUNKED render (render-step chain) — renders the FULL script length one Veo
    // clip per ≤300s invocation and auto-posts on completion. Replaces the old
    // single Convex action that stopped early on longer videos.
    const renderArgs = {
      agentName: influencer.name,
      agentNiche: influencer.niche,
      agentArchetype: influencer.archetype,
      characterBible: draft?.characterBible,
      avatarUrl: face.url,                     // STATIC NFT face extracted from the GIF
      avatarUrls: [face.url, ...liveDraftStatics],
      referenceImageUrls,                      // extra face angles + the product image
      topic: campaign.title,
      hook: scripted.hook,
      scriptText: scripted.scriptText,
      durationSeconds: scriptDurationSeconds,  // job extends clips to cover the whole script
      resolution: (agentRecord as { videoConfig?: { resolution?: "720p" | "1080p" } } | null)?.videoConfig?.resolution ?? "720p",
      videoModel,
      personality,
      voiceArchetype: (draft?.questionnaire as Record<string, unknown> | undefined)?.voiceArchetype as string | undefined,
      language: scriptLanguage,
      // The director's full brief — format + angle + structureNotes + visualTreatment
      // — so the storyboard AND every clip render in this video's unique style.
      creativeBrief: {
        format: brief.format,
        angle: brief.angle.slice(0, 380),
        topic: brief.topic,
        structureNotes: brief.structureNotes || undefined,
        visualTreatment: brief.visualTreatment || undefined,
      },
      ...(orders.speech ? { speech: orders.speech } : {}),
      ...(standingOrders ? { standingOrders } : {}),
      skills,
      memories: [campaignAsMemory, ...memories].slice(0, 8),
      knowledge: [campaignAsKnowledge, ...knowledge].slice(0, 8),
      // Skill-driven finalize-phase overlays (captions / hook / music). render-step
      // only runs the overlay-burn phase when this is present with an enabled overlay.
      overlays: overlayDirectives.overlays,
      // Director's aspect ratio (portrait/square/landscape) — without this the
      // engine-specific resolvers (e.g. resolveGrokAspect) never see the user's
      // real choice and silently fall back to their own 9:16 default.
      aspectRatio: overlayDirectives.aspectRatio,
    };
    const { kickoffVideoRender } = await import("@/lib/server/kickoffVideoRender");
    await kickoffVideoRender({
      convex,
      origin: process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin,
      taskId,
      mintAddress,
      sessionId: draft?.sessionId || mintAddress,
      kieModel: videoModel,
      renderArgs,
      autoPost: {
        platforms: requiredPlatforms,          // empty → post to ALL connected accounts
        campaignId: campaign.source === "campaign" && typeof campaign.id === "string" ? campaign.id : undefined,
        submissionId,
        caption: postCaption || undefined,
      },
    });

    return NextResponse.json({
      ok: true,
      async: true,   // video renders in the background; it appears in Creations when ready
      taskId,
      script: [
        `### Hook\n${scripted.hook}`,
        `### Script\n${scripted.scriptText}`,
        `### Caption\n${scripted.caption}`,
        scripted.hashtags.length ? `### Hashtags\n${scripted.hashtags.join(" ")}` : "",
      ].filter(Boolean).join("\n\n"),
      hook: scripted.hook,
      caption: scripted.caption,
      hashtags: scripted.hashtags,
      scriptSource: scripted.source,
      durationSeconds: scriptDurationSeconds,
      submission,
    });
  } catch (err) {
    console.error("[generate-content]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
