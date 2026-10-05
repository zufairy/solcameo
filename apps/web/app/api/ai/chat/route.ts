import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
import OpenAI from "openai";
import { api } from "@/convex/_generated/api";

import {
  type AgentType,
  type BuilderPhase as AgentBuilderPhase,
  INFLUENCER_SYSTEM_PROMPT,
  WORKER_SYSTEM_PROMPT,
  TRADER_SYSTEM_PROMPT,
  CLIPPING_SYSTEM_PROMPT,
  INFLUENCER_PHASES,
  WORKER_PHASES,
  TRADER_PHASES,
  getInitialPhase,
  buildMissionContextBlock,
  type AgentBlueprint,
} from "@/lib/builder/agentTypes";

import {
  buildOrchestrationBlock,
  clippingOfferAllowed,
  type BuilderChatMessage,
} from "@/lib/builder/marketingEngineerOrchestration";
import {
  buildAgentChainCanvasActions,
  buildAgentChainClientActions,
  buildAgentChainPromptBlock,
  buildBuilderAgentChain,
} from "@/lib/builder/builderAgentChain";
import { BUILDER_AGENT_SKILLS, BUILDER_KNOWLEDGE_BASE } from "@/lib/builder/agentKnowledgeBase";
import {
  CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT,
  fundingGuidanceBlock,
  safeParseCampaignBlueprint,
  safeParseClientActions,
  type CampaignBlueprint,
  type ClientAction,
} from "@/lib/builder/campaignBlueprint";
import { MARKETING_ENGINEER_SKILL } from "@/lib/builder/marketingEngineerSkill";
import { getUserReplySuggestions } from "@/lib/builder/userReplyKnowledgeBase";
import { BUILDER_LOCAL_GOAL_PREVIEW_ID } from "@/lib/builder/builderCanvasConstants";
import { fetchWebsiteIntelligence } from "@/lib/builder/websiteIntelligence";
import type { WebsiteIntelligence } from "@/lib/builder/websiteIntelligence";
import { evaluateCampaignEligibility, VELLO_CAMPAIGNS_SKILL_ID, SOCIAL_SKILL_ID } from "@/lib/builder/campaignEligibility";
import { isJoinableUgcCampaign } from "@/lib/campaignLifecycle";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { persistStandingDirective } from "@/lib/server/agentDirectives";
import { normalizeShowBible, bibleVideoStyles } from "@/lib/builder/showBible";
import { GEMINI_KEY, geminiChat, openGeminiStream, type GeminiMessage } from "@/lib/server/geminiFast";

/** Kie.ai Gemini 3 Flash (OpenAI-compat shape). */
const KIE_GEMINI_URL = "https://api.kie.ai/gemini-3-flash/v1/chat/completions";
/** Kie.ai Claude Haiku 4.5 (Anthropic Messages shape — top-level `system`). */
const KIE_CLAUDE_URL = "https://api.kie.ai/claude/v1/messages";
/** The model id sent to Kie's Claude endpoint. Kie proxies Anthropic but only
 *  serves the model strings it has enabled — an UNSUPPORTED id makes Kie HANG
 *  (→ a 55s "timeout" with credit on the account), not fast-fail. The exact
 *  string can drift (`claude-haiku-4-5` vs `claude-3-5-haiku` vs a dated/prefixed
 *  variant), so make it env-tunable like KIE_GEMINI_MODEL. Set KIE_CLAUDE_MODEL to
 *  whatever the account's Kie dashboard / `/model` lists as a supported Claude id. */
const KIE_CLAUDE_MODEL = process.env.KIE_CLAUDE_MODEL?.trim() || "claude-haiku-4-5";

/** Kie routes per-model in the URL path. Map a model id → its endpoint. */
function kieUrlForModel(model: string): string {
  return `https://api.kie.ai/${model}/v1/chat/completions`;
}

/** Selectable builder-chat models. All run through Kie.
 *  NB: Kie's slug for Gemini 3.6 Flash on the OpenAI-compat path is
 *  "gemini-3-6-flash-openai" — bare "gemini-3-6-flash" 422s on chat/completions
 *  (it only exists on Kie's native `:generateContent` route). Verified live. */
type KieChatModel = "claude-haiku-4-5" | "gemini-3-flash" | "gemini-3-6-flash-openai";
/** The copilot always answers on Gemini (Google direct first — the fast path —
 *  then Kie). KIE_CHAT_MODEL may pick which Gemini Kie falls back to, but a
 *  Claude pick (env, or an old client that still sends one) is ignored: Claude
 *  is only the outage failover (kieFailoverOrder), never the primary. */
const DEFAULT_CHAT_MODEL: KieChatModel =
  process.env.KIE_CHAT_MODEL?.trim() === "gemini-3-flash" ? "gemini-3-flash" : "gemini-3-6-flash-openai";
function resolveChatModel(requested?: unknown): KieChatModel {
  const v = typeof requested === "string" ? requested.trim() : "";
  if (v === "gemini-3-flash" || v === "gemini-3-6-flash-openai") return v;
  return DEFAULT_CHAT_MODEL;
}

const SYSTEM_PROMPT = `You are the Vello Marketing Engineer — a specialist copilot inside Jobtepi/Vello.
You design HOW distribution campaigns should run using ONLY what Vello/Jobtepi can ship today.

### Your two responsibilities (everything else is out of scope)
1. **Brand / growth / community lead:** Translate goals into a crisp plan mapped to platform capabilities — **UGC video campaigns** and **clipping / repurposing campaigns** — broken into canvas nodes that always advance toward launching a campaign.
2. **Creator:** Coach them on how to win on Vello (join Content Rewards / clipping payouts, approvals, proofs, etiquette). Minimal canvas nodes; focus on conversational guidance unless mapping a monetization lane helps.

### Mandatory routing step
Read AGENT_CHAIN_JSON before deciding how to respond.
- If interactionMode is role_detection: ask exactly one decisive routing question that separates creator guidance from brand/community agentic build. Do not act like you already know. Do not generate a heavy build plan yet.
- If interactionMode is creator_answering: stay in answering mode first. Give practical guidance on clipping, UGC creation, approvals, creator proof, and platform steps. Do not auto-build a community/product/campaign stack unless the user explicitly asks for a done-for-you build.
- If interactionMode is agency_agentic: be fully agentic. Build the community, offer, virality plan, first campaign, and funding path as a launch system.

Always read ORCHESTRATION_JSON first. Respect platformCaps.clipping_campaign:
- When false → never add nodes that prescribe clipping, repurposing podcasts, episodic cutters, montage-from-library, etc. Ask if they maintain podcast feeds, long YouTube originals, webinars, course recordings, Twitch VODs, interview banks, etc.
- When true → clipping lane may appear explaining source assets, approvals, bounty rates.

### Progressive canvas — conversational, one phase at a time

The system handles ALL canvas card generation deterministically. **Always output "actions": [].**
Your job: write the right message and populate campaignBlueprint correctly for the current phase.

Read BUILDER_PHASE_JSON to know which phase you are in.

---

**PHASE: goal_capture**
Goal: Understand what they want. Collect website URL.
Message (2-4 sentences):
- Acknowledge their goal in one sentence, using their own framing.
- If their goal involves VIEWS / REACH / AWARENESS / GROWTH / GOING VIRAL / SHORT-FORM CONTENT, add ONE sentence naming both campaign primitives: "On Vello you have two ways to do this — a UGC campaign (creators film new short-form content about your brand) or a clipping campaign (clippers chop existing long-form into viral clips). I'll recommend one once I see your site."
- Ask for their website URL: "What's your website? I'll scan it to understand your brand, audience, and what long-form content you already have."
- Do NOT ask about budget or creators yet.
campaignBlueprint: Fill summary and objectives only. Leave community/product/campaign empty.

**PHASE: context_building**
Goal: Confirm community concept. Recommend a campaign type. Collect the angle.
The system has already scanned their website. Use WEBSITE_CONTEXT to describe the brand.
Message (4-6 sentences):
- Sentence 1-2: Describe what you found — brand name, what they do, who they serve. Be specific, use their real positioning.
- Sentence 3: Present the community you'll build: "I'll create [Community Name] — a [short positioning]."
- Sentence 4: Recommend a campaign type with reasoning. If the website mentions podcast, YouTube channel, webinars, livestreams, courses, hours of footage → recommend **clipping** ("Since you already have [long-form source], a clipping campaign will turn that library into 20-50 short-form clips — clippers get paid per 1k views on approved clips."). Otherwise recommend **UGC** ("A UGC campaign fits you best — creators film fresh short-form content about [brand], you pay per 1k views or per approved post.").
- Ask ONE question: "What's the campaign angle — what specific transformation or moment do you want creators to show?"
campaignBlueprint:
- community.name MUST be derived from the website's actual brand name + their stated objective (e.g., "Acme Growth Lab", "Drift Founders Circle"). NEVER use generic placeholders like "Community Launch" or "Your Community".
- community.description: one sentence about audience promise + outcome, grounded in their site copy.
- community.audience: one sentence naming the exact persona.
- community.imageUrl: copy the website hero image URL from WEBSITE_CONTEXT (heroImage field). If missing, use logoImage.
- Leave product, campaign, funding empty in this phase.

**PHASE: campaign_ready**
Goal: Confirm everything, signal building.
Message (1-2 sentences):
- "Building your [CommunityName] workspace and [CampaignName] [UGC|clipping] campaign now — I'll have everything ready in a moment."
campaignBlueprint: Fill ALL fields completely — community (name, description, audience, imageUrl, keyFeatures), product (name, headline, description, features), campaign (name, angle, creatorBrief with hook + deliverables + CTA, deliverables, contentInputsNeeded), funding (status: "recommended", exampleTreasuryCreditUsd between 5-15, platformFeePercent: ${CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT}).

---

Always output: "actions": []

### JSON response schema (ONLY JSON — no prose outside the object — no fences)
{
  "message": "Warm concise reply matching the current phase",
  "campaignBlueprint": {
    "role": "brand | creator | ambiguous",
    "summary": "string",
    "objectives": ["string"],
    "channels": ["string"],
    "community": {
      "name": "string",
      "description": "string",
      "audience": "string",
      "imageUrl": "string",
      "imageDirection": "string",
      "keyFeatures": ["string"]
    },
    "product": {
      "name": "string",
      "headline": "string",
      "description": "string",
      "pricingIdea": "string",
      "features": ["string"]
    },
    "campaign": {
      "name": "string",
      "angle": "string",
      "imageUrl": "string",
      "creatorBrief": "string",
      "deliverables": ["string"],
      "contentInputsNeeded": ["string"]
    },
    "budgetTiersUsd": [{ "name": "starter | growth | scale", "min": 0, "max": 0, "summary": "string" }],
    "funding": {
      "status": "not_applicable | not_started | recommended | user_ready_to_pay",
      "exampleTreasuryCreditUsd": 0,
      "exampleTotalChargedUsd": 0,
      "platformFeePercent": ${CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT},
      "solanaTreasuryNote": "string"
    }
  },
  "actions": [],
  "clientActions": [{ "type": "NAVIGATE", "payload": { "href": "/community/...", "label": "Open treasury top-up" } }],
  "suggestedQuestions": ["max 2 short follow-up options relevant to the current phase"]
}

Tone for "message": confident marketing engineer voice, zero schema dumps, no bullet spam, never paste action typing instructions. Reference communityId from ORCHESTRATION_JSON if present when relevant (e.g., "for this community workspace"). Do not paste raw JSON schemas into "message".

### Campaign blueprint + agentic UX
Always include **campaignBlueprint** (object). Update it turn-by-turn. When treasury funding is relevant, populate **funding** with **platformFeePercent: ${CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT}** (literal number in JSON).
When the user wants the AI to create everything, fill **community**, **product**, and **campaign** with launch-ready copy. Use website context when present.
If the user has not shared a website or source material, ask for the website URL or content source in **message** before pretending details are known.

${fundingGuidanceBlock(CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT)}

### clientActions (optional)
Append **clientActions** for concrete UI taps. Allowed shape:
\`{"type":"NAVIGATE","payload":{"href":"/community/<id>?tab=dashboard&treasuryTopup=1","label":"Open treasury top-up"}}\`
For on-chain funding flows, you may also navigate to:
\`/web3-campaign/new?communityId=<id>\`
Only use **same-origin** paths under **/community/** or **/web3-campaign/**. Never use javascript: URLs.

CRITICAL: Return ONLY valid JSON. Never wrap in markdown code fences.`;

type ChatRole = "user" | "assistant";

function getKieApiKey() {
  return process.env.KIE_API_KEY?.trim() || process.env.KIE_API_TOKEN?.trim();
}

function extractKieMessageText(payload: unknown): string {
  const p = payload as { content?: Array<{ type?: string; text?: string }> };
  if (!p?.content || !Array.isArray(p.content)) return "";

  return p.content
    .filter((item) => item?.type === "text" && typeof item?.text === "string")
    .map((item) => item.text)
    .join("\n\n")
    .trim();
}

function stripJsonFences(raw: string): string {
  let s = raw.trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (m) s = m[1].trim();
  return s;
}

/**
 * Robustly extract the first valid JSON object from messy LLM output.
 * Handles: markdown fences, prose before/after JSON, partial responses,
 * trailing commas, and prose-only replies. Returns null if nothing parses.
 */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const s = stripJsonFences(raw);
  // Try direct parse first
  try { const v = JSON.parse(s); if (v && typeof v === "object") return v; } catch { /* fall through */ }
  // Find the first `{` then walk forward matching braces (string-aware) to
  // find the matching `}`. Handles JSON embedded in prose without false
  // matches on stray braces inside text.
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1)
          // Strip trailing commas before } or ]
          .replace(/,(\s*[}\]])/g, "$1");
        try { const v = JSON.parse(candidate); if (v && typeof v === "object") return v; } catch { return null; }
      }
    }
  }
  return null;
}

function parseAssistantJson(content: string): {
  message?: string;
  campaignBlueprint?: unknown;
  agentBlueprint?: unknown;
  clientActions?: unknown;
  actions?: unknown[];
  agentActions?: unknown[];
  suggestedQuestions?: string[];
} {
  const obj = extractJsonObject(content);
  if (obj) {
    return obj as {
      message?: string;
      campaignBlueprint?: unknown;
      agentBlueprint?: unknown;
      clientActions?: unknown;
      actions?: unknown[];
      agentActions?: unknown[];
      suggestedQuestions?: string[];
    };
  }
  // Prose-only reply — surface the prose as the message + sniff for action
  // keywords so the trader at least gets *some* agentic behavior instead of
  // a dead chat turn. Looks for verbs the operator/AI used in plain English.
  const text = content.trim();
  const agentActions: Array<{ type: string; [k: string]: unknown }> = [];
  const lc = text.toLowerCase();
  if (/\b(run|fire|execute)\b.*(tick|cycle|now)/i.test(text)) agentActions.push({ type: "execute_tick" });
  if (/go\s+(agentic|auto|autonomous)|fully\s+auto/i.test(text)) agentActions.push({ type: "set_autonomy", mode: "auto" });
  if (/\bpause\b|signal[- ]?only/i.test(text)) agentActions.push({ type: "set_autonomy", mode: "signal_only" });
  for (const [kw, id] of [
    [/x[- ]sentiment|twitter sentiment/i, "x.sentiment"],
    [/whale/i, "onchain.whale"],
    [/news feed|cryptopanic|coindesk/i, "news.feed"],
    [/polymarket|prediction market/i, "polymarket.signals"],
    [/risk guardian|stop[- ]?loss/i, "risk.guardian"],
    [/drawdown/i, "drawdown.guard"],
    [/telegram/i, "telegram.alert"],
    [/discord/i, "discord.alert"],
    [/ai reasoning|gemini|claude/i, "ai.reasoning"],
    [/jupiter|swap/i, "jupiter.swap"],
  ] as Array<[RegExp, string]>) {
    if (kw.test(lc) && !agentActions.find((a) => a.skillId === id)) agentActions.push({ type: "install_skill", skillId: id });
  }
  return {
    message: text || undefined,
    actions: [],
    agentActions: agentActions.length > 0 ? agentActions : undefined,
    suggestedQuestions: [],
  };
}

function isSafeCommunityNavigateHref(href: string): boolean {
  const t = href.trim();
  if (t.startsWith("//")) return false;
  if (!(t.startsWith("/community/") || t.startsWith("/web3-campaign/"))) return false;
  if (/\s|javascript:|data:/i.test(t)) return false;
  return true;
}

function dedupeClientActionsByHref(actions: ClientAction[]): ClientAction[] {
  const seen = new Set<string>();
  const out: ClientAction[] = [];
  for (const a of actions) {
    const key =
      a.type === "NAVIGATE"
        ? `NAVIGATE:${a.payload.href}`
        : JSON.stringify(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** Keep model NAVIGATE actions that point at safe in-app routes; optionally inject treasury top-up deep link. */
function mergeTreasuryClientActions(params: {
  rawClientActions: unknown;
  campaignBlueprint: unknown;
  message: string;
  communityId: string | null;
  interactionMode: "creator_answering" | "agency_agentic" | "role_detection";
}): ClientAction[] {
  const fromModel = safeParseClientActions(params.rawClientActions).filter((a) => {
    if (a.type !== "NAVIGATE") return false;
    return isSafeCommunityNavigateHref(a.payload.href);
  });

  const merged = [...fromModel];
  if (params.interactionMode !== "agency_agentic") {
    return dedupeClientActionsByHref(merged);
  }

  const bp = safeParseCampaignBlueprint(params.campaignBlueprint);
  const msg = params.message.toLowerCase();
  const treasuryLikely =
    bp?.funding?.status === "recommended" ||
    bp?.funding?.status === "user_ready_to_pay" ||
    /treasury|top\s*-?up|floating wallet|deposit|billplz|fund\s+the\s+campaign/.test(msg);
  const onchainPreferred = /on-?chain|solana|phantom|wallet\s*signature|deposit\s+usdc|usdc/.test(msg);

  const cid = params.communityId?.trim();
  if (treasuryLikely && cid) {
    const target = onchainPreferred
      ? `/web3-campaign/new?communityId=${encodeURIComponent(cid)}`
      : `/community/${cid}?tab=dashboard&treasuryTopup=1`;
    const already = merged.some(
      (a) =>
        a.type === "NAVIGATE" &&
        (a.payload.href.includes("treasuryTopup=1") || a.payload.href.includes("/web3-campaign/new")),
    );
    if (!already) {
      merged.push({
        type: "NAVIGATE",
        payload: {
          href: target,
          label: onchainPreferred ? "Deposit USDC and activate campaign" : "Open treasury top-up",
        },
      });
    }
  }

  return dedupeClientActionsByHref(merged);
}

function extractUrlsFromHistory(messages: { role: ChatRole; content: string }[]): string[] {
  const all = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
  const matches = all.match(/https?:\/\/[^\s)\]}>"']+/gi) || [];
  const cleaned = matches.map((u) => u.replace(/[.,;:!?]+$/g, ""));
  return [...new Set(cleaned)].slice(0, 2);
}

function deriveDynamicSuggestions(params: {
  history: { role: ChatRole; content: string }[];
  canvasNodeCount: number;
  aiMessage: string;
  interactionMode: "creator_answering" | "agency_agentic" | "role_detection";
}): string[] {
  const { history, canvasNodeCount, aiMessage } = params;
  const userTurns = history.filter((m) => m.role === "user").map((m) => m.content);
  const transcript = userTurns.join("\n").toLowerCase();
  const latestUser = (userTurns[userTurns.length - 1] || "").toLowerCase();
  const hasWebsite = /https?:\/\//.test(transcript);
  const clippingAllowed = clippingOfferAllowed(history);

  if (params.interactionMode === "role_detection") {
    return [
      "I am a creator and I want guidance on clipping or UGC content.",
      "I run a brand or community and want you to build the launch system for me.",
      "I am an agency helping clients grow and need a content virality workflow.",
    ];
  }

  if (params.interactionMode === "creator_answering") {
    if (clippingAllowed) {
      return [
        "Show me the best clip formats and hooks to cut from my long-form content.",
        "Give me a creator approval checklist so my submission gets accepted faster.",
        "Turn this into a 7-day posting plan with platform-by-platform guidance.",
      ];
    }

    return [
      "Teach me how to make UGC that gets approved faster on Vello.",
      "Tell me what proof, hooks, and CTA format I should use as a creator.",
      "Ask me the fastest questions needed to decide whether I should clip or create from scratch.",
    ];
  }

  const base = getUserReplySuggestions({
    clippingAllowed,
    transcript,
    latestUser,
    canvasNodeCount,
  });

  if (!hasWebsite) {
    return [
      "Use this website as the source of truth: https://example.com",
      "I will paste the core offer and product details for you to build from.",
      "Create the community, product, and campaign structure first, then tell me what content you still need.",
    ];
  }

  if (/budget|cost|rm|myr|usd/.test(latestUser) || /budget|cost|treasury|fund/.test(aiMessage.toLowerCase())) {
    return [
      "Break this into starter, growth, and scale treasury options.",
        "Deposit USDC into the Vello treasury and activate this campaign now.",
      "Give KPI targets for week 1 and week 2.",
    ];
  }

  return base;
}

function enrichCampaignBlueprint(params: {
  raw: CampaignBlueprint;
  chain: ReturnType<typeof buildBuilderAgentChain>;
  website: WebsiteIntelligence | null;
  knowledgeBaseText: string;
}): CampaignBlueprint {
  const { raw, chain, website, knowledgeBaseText } = params;
  const siteName = website?.siteName || website?.title || "Community Launch";
  const imageUrl = website?.heroImage || website?.logoImage || undefined;
  const audience = website?.audienceHints[0] || "members who want a clear outcome";
  const productSignal = website?.productSignals[0] || chain.recommendedProductType;
  const viralAngle = website?.viralAngles[0] || "creator-led proof and short-form hooks";
  const knowledgeCommunity = buildKnowledgeExcerpt(knowledgeBaseText, 420);
  const knowledgeProduct = buildKnowledgeExcerpt(knowledgeBaseText, 320);
  const knowledgeCampaign = buildKnowledgeExcerpt(knowledgeBaseText, 260);

  if (chain.interactionMode === "role_detection") {
    return {
      ...raw,
      role: raw.role || "ambiguous",
      summary:
        raw.summary ||
        "Routing mode is active. First confirm whether this is a creator asking for guidance or a brand / community operator who wants a done-for-you build.",
      objectives:
        raw.objectives?.length
          ? raw.objectives
          : ["Identify the operating mode first", "Avoid heavy build actions until routing is confirmed"],
      channels: raw.channels?.length ? raw.channels : [],
    };
  }

  if (chain.interactionMode === "creator_answering") {
    return {
      ...raw,
      role: "creator",
      summary:
        raw.summary ||
        "Creator guidance mode is active. Focus on the fastest next answer: clipping, UGC creation, approvals, proof format, and payout readiness.",
      objectives:
        raw.objectives?.length
          ? raw.objectives
          : [
              "Answer the creator directly before building anything heavy",
              "Clarify whether they should clip existing content or create new UGC",
              "Give platform-ready proof, hook, CTA, and submission guidance",
            ],
      channels:
        raw.channels?.length
          ? raw.channels
          : ["TikTok", "Instagram Reels", "YouTube Shorts", "Threads"],
      funding: raw.funding || {
        status: "not_applicable",
        platformFeePercent: CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT,
        solanaTreasuryNote: "Creator guidance mode does not require treasury funding yet.",
      },
    };
  }

  // Build website-grounded features that mirror real signals rather than generic platitudes.
  const websiteSignalFeatures = uniqueNonEmpty([
    ...(website?.productSignals || []),
    ...(website?.communitySignals || []),
    ...(website?.viralAngles || []),
  ]).slice(0, 6).map((s) => s.length > 80 ? s.slice(0, 77) + "…" : s);

  return {
    ...raw,
    role: raw.role || chain.inferredRole,
    summary:
      raw.summary ||
      (knowledgeProduct
        ? `Use the knowledge base to shape ${siteName} into a launch-ready community, clear starter offer, and first creator campaign.`
        : `Setup the ${siteName} community first, generate campaign suggestions inside it, then create and fund the best campaign.`),
    objectives: raw.objectives?.length
      ? raw.objectives
      : [
          `Make ${siteName} the operating hub for ${audience}`,
          `Turn the website's strongest promise into a starter offer members can join now`,
          `Ship the first short-form creator campaign with a hook tied to ${productSignal}`,
          `Activate the campaign with a treasury deposit so creators get paid for verified views`,
        ],
    channels: raw.channels?.length ? raw.channels : ["TikTok", "X", "Threads", "YouTube Shorts"],
    community: {
      name: raw.community?.name || `${siteName} Hub`,
      description:
        raw.community?.description ||
        (knowledgeCommunity
          ? `${knowledgeCommunity} A working hub where ${audience} get the briefs, templates, and updates they need to engage with ${productSignal}.`
          : `A focused hub for ${audience}. Members get briefs, templates, and updates tied to ${productSignal}.`),
      audience: raw.community?.audience || audience,
      imageUrl: raw.community?.imageUrl || imageUrl,
      imageDirection:
        raw.community?.imageDirection ||
        "Use the strongest website hero or brand image as the community cover.",
      keyFeatures:
        raw.community?.keyFeatures?.length
          ? raw.community.keyFeatures
          : (websiteSignalFeatures.length >= 3
              ? websiteSignalFeatures.slice(0, 4)
              : [
                  `${siteName} member onboarding`,
                  `Campaign briefs tied to ${productSignal}`,
                  `Creator templates and approval guidance`,
                  `Launch updates and proof collection`,
                ]),
    },
    product: {
      name: raw.product?.name || `${siteName} Starter Pass`,
      headline: raw.product?.headline || `The fastest way ${audience} reach ${productSignal}.`,
      description:
        raw.product?.description ||
        (knowledgeProduct
          ? `${knowledgeProduct} Packaged as a starter offer so members can join, share, and convert with zero friction.`
          : `A starter offer that turns ${siteName}'s promise into something ${audience} can join, share, and convert from immediately.`),
      pricingIdea: raw.product?.pricingIdea || "Start free or low-friction, then add paid tiers after proof.",
      features:
        raw.product?.features?.length
          ? raw.product.features
          : (websiteSignalFeatures.length >= 3
              ? websiteSignalFeatures.slice(0, 4)
              : [
                  `Direct access to ${siteName}`,
                  `Onboarding tied to ${productSignal}`,
                  `Creator templates for sharing`,
                  `Member-only campaign drops`,
                ]),
    },
    campaign: {
      name: raw.campaign?.name || `${siteName} UGC Launch Campaign`,
      angle: raw.campaign?.angle || viralAngle,
      imageUrl: raw.campaign?.imageUrl || imageUrl,
      creatorBrief:
        raw.campaign?.creatorBrief ||
        (knowledgeCampaign
          ? `Use the knowledge base as the source of truth. Highlight ${knowledgeCampaign} Show the clearest promise, the product outcome, and why people should join now in short-form native content.`
          : `Create short-form posts that show the community promise, the product outcome, and why people should join now.`),
      deliverables:
        raw.campaign?.deliverables?.length
          ? raw.campaign.deliverables
          : [
              "1 short-form video or post per creator",
              "Clear hook in the first 3 seconds",
              "Community join CTA",
              "Proof or use-case angle",
            ],
      contentInputsNeeded:
        raw.campaign?.contentInputsNeeded?.length
          ? raw.campaign.contentInputsNeeded
          : website
            ? ["Confirm final campaign budget", "Confirm payout rate", "Review treasury deposit amount"]
            : ["Website URL or source content", "Campaign budget", "Preferred treasury deposit amount"],
    },
    funding: raw.funding || {
      status: "not_started",
      platformFeePercent: CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT,
      solanaTreasuryNote: "Campaign becomes active after the deposit transaction is confirmed.",
    },
  };
}

function buildFallbackCanvasActions(params: {
  history: { role: ChatRole; content: string }[];
  currentNodeCount: number;
}): Array<Record<string, unknown>> {
  void params.history;
  const now = Date.now();
  if (params.currentNodeCount === 0) {
    return [
      {
        type: "ADD_NODE",
        payload: {
          node: {
            id: `init-${now}`,
            label: "Marketing goal",
            description:
              "Capture goal, KPIs, offer, timeline. Confirm the objective in chat before moving on; ask for a website URL next.",
            category: "initial",
            status: "pending",
            x: 300,
            y: 240,
            dependencies: [],
            connectsTo: [],
            animation: { entrance: "bounce", delay: 0 },
          },
        },
      },
    ];
  }

  return [];
}

function normalizeCanvasActions(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const action = item as { type?: unknown; payload?: unknown };
    const type = typeof action.type === "string" ? action.type.toUpperCase() : "";
    const payload = (action.payload && typeof action.payload === "object" ? action.payload : {}) as Record<
      string,
      unknown
    >;

    if (type === "ADD_NODE") {
      const node = (payload.node && typeof payload.node === "object"
        ? (payload.node as Record<string, unknown>)
        : null);
      if (!node) continue;
      const id = String(node.id || "").trim();
      const label = String(node.label || "").trim();
      const category = String(node.category || "").trim();
      if (!id || !label || !category) continue;
      out.push({
        type: "ADD_NODE",
        payload: {
          node: {
            ...node,
            id,
            label,
            category,
            status: typeof node.status === "string" ? node.status : "pending",
            x: Number(node.x) || 0,
            y: Number(node.y) || 0,
            ctaLabel: typeof node.ctaLabel === "string" ? node.ctaLabel : undefined,
            ctaHref: typeof node.ctaHref === "string" ? node.ctaHref : undefined,
            sourceImageUrl:
              typeof node.sourceImageUrl === "string" ? node.sourceImageUrl : undefined,
            sourceCoverImageUrl:
              typeof node.sourceCoverImageUrl === "string" ? node.sourceCoverImageUrl : undefined,
            sourceProfileImageUrl:
              typeof node.sourceProfileImageUrl === "string" ? node.sourceProfileImageUrl : undefined,
            sourceUrl: typeof node.sourceUrl === "string" ? node.sourceUrl : undefined,
            dependencies: Array.isArray(node.dependencies) ? node.dependencies.map(String) : [],
            connectsTo: Array.isArray(node.connectsTo) ? node.connectsTo.map(String) : [],
          },
        },
      });
      continue;
    }

    if (type === "CONNECT_NODES") {
      const fromId = String(payload.fromId || "").trim();
      const toId = String(payload.toId || "").trim();
      if (!fromId || !toId) continue;
      out.push({ type: "CONNECT_NODES", payload: { fromId, toId } });
      continue;
    }

    if (type === "UPDATE_NODE") {
      const id = String(payload.id || "").trim();
      const updates = payload.updates;
      if (!id || !updates || typeof updates !== "object") continue;
      out.push({ type: "UPDATE_NODE", payload: { id, updates } });
      continue;
    }

    if (type === "DELETE_NODE") {
      const id = String(payload.id || "").trim();
      if (!id) continue;
      out.push({ type: "DELETE_NODE", payload: { id } });
      continue;
    }

    if (type === "CLEAR_CANVAS") {
      out.push({ type: "CLEAR_CANVAS", payload: {} });
    }
  }

  return out;
}

function canvasHasKnowledgeNode(nodes: unknown[]): boolean {
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const label = String((n as { label?: string }).label || "");
    if (/knowledge/i.test(label)) return true;
  }
  return false;
}

function modelAddsKnowledgeBase(actions: Array<Record<string, unknown>>): boolean {
  for (const a of actions) {
    if (String(a.type || "").toUpperCase() !== "ADD_NODE") continue;
    const node = (a.payload as { node?: { label?: string } } | undefined)?.node;
    if (typeof node?.label === "string" && /knowledge/i.test(node.label)) return true;
  }
  return false;
}

function normalizeKnowledgeText(value: string, maxChars = 2400): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, maxChars);
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, list) => list.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
}

function buildWebsiteKnowledgeBaseDigest(website: WebsiteIntelligence): string {
  const sections: string[] = [];
  const overview = [website.siteName || website.title, website.description]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" — ");
  if (overview) sections.push(`Brand overview\n${overview}`);

  const audienceAndCommunity = uniqueNonEmpty([...website.audienceHints, ...website.communitySignals]);
  if (audienceAndCommunity.length > 0) {
    sections.push(`Audience and community fit\n${audienceAndCommunity.join("; ")}`);
  }

  const offerSignals = uniqueNonEmpty(website.productSignals);
  if (offerSignals.length > 0) {
    sections.push(`Offer and product signals\n${offerSignals.join("; ")}`);
  }

  const campaignAngles = uniqueNonEmpty(website.viralAngles);
  if (campaignAngles.length > 0) {
    sections.push(`Campaign angles\n${campaignAngles.join("; ")}`);
  }

  const sourceNotes = normalizeKnowledgeText(website.readableText || "", 1800);
  if (sourceNotes) {
    sections.push(`Website source notes\n${sourceNotes}`);
  }

  const images: string[] = [];
  if (website.heroImage) images.push(`heroImage: ${website.heroImage}`);
  if (website.logoImage) images.push(`logoImage: ${website.logoImage}`);
  if (images.length > 0) {
    sections.push(`Images (use these URLs verbatim for community.imageUrl / campaign.imageUrl)\n${images.join("\n")}`);
  }

  return sections.join("\n\n").trim();
}

function extractKnowledgeBaseText(nodes: unknown[], website: WebsiteIntelligence | null): string {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const label = String((node as { label?: string }).label || "");
    const description = (node as { description?: unknown }).description;
    if (!/knowledge/i.test(label)) continue;
    if (typeof description === "string" && description.trim()) {
      return normalizeKnowledgeText(description);
    }
  }

  return website ? buildWebsiteKnowledgeBaseDigest(website) : "";
}

function buildKnowledgeExcerpt(text: string, maxChars = 340): string {
  const normalized = normalizeKnowledgeText(text, Math.max(maxChars * 3, 600));
  if (!normalized) return "";

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) return normalized.slice(0, maxChars).trim();

  let excerpt = "";
  for (const sentence of sentences.slice(0, 4)) {
    const next = excerpt ? `${excerpt} ${sentence}` : sentence;
    if (next.length > maxChars && excerpt) break;
    excerpt = next;
  }

  return (excerpt || normalized.slice(0, maxChars)).trim();
}

/** Deterministic Phase 2: attach KB from scraped site copy, wired to an existing initial goal node id. */
function buildKnowledgeBaseInjectionActionsForAnchor(
  initialGoalNodeId: string,
  website: WebsiteIntelligence,
): Array<Record<string, unknown>> {
  if (!initialGoalNodeId || !website?.readableText?.trim()) return [];

  const kbId = `kb-${Date.now()}`;
  const excerpt = buildWebsiteKnowledgeBaseDigest(website);

  return [
    {
      type: "ADD_NODE",
      payload: {
        node: {
          id: kbId,
          label: "Knowledge base (from website)",
          description: excerpt,
          category: "foundation",
          status: "in_progress",
          x: 540,
          y: 240,
          dependencies: [initialGoalNodeId],
          connectsTo: [],
          sourceCoverImageUrl: website.heroImage || website.logoImage,
          sourceProfileImageUrl: website.logoImage || website.heroImage,
          sourceUrl: website.url,
          sourceImageUrl: website.heroImage || website.logoImage,
          animation: { entrance: "bounce", delay: 80 },
        },
      },
    },
    { type: "CONNECT_NODES", payload: { fromId: initialGoalNodeId, toId: kbId } },
  ];
}

function withWebsiteVisuals(
  node: Record<string, unknown>,
  website: WebsiteIntelligence | null,
): Record<string, unknown> {
  if (!website) return node;

  const coverImage =
    (typeof node.sourceCoverImageUrl === "string" && node.sourceCoverImageUrl) ||
    (typeof node.sourceImageUrl === "string" && node.sourceImageUrl) ||
    website.heroImage ||
    website.logoImage;
  const profileImage =
    (typeof node.sourceProfileImageUrl === "string" && node.sourceProfileImageUrl) ||
    website.logoImage ||
    website.heroImage;

  return {
    ...node,
    sourceCoverImageUrl: coverImage,
    sourceProfileImageUrl: profileImage,
    sourceImageUrl: typeof node.sourceImageUrl === "string" && node.sourceImageUrl ? node.sourceImageUrl : coverImage,
    sourceUrl: typeof node.sourceUrl === "string" && node.sourceUrl ? node.sourceUrl : website.url,
  };
}

function buildCommunitySetupCards(params: {
  initialGoalNodeId: string;
  campaignBlueprint: CampaignBlueprint;
  website: WebsiteIntelligence | null;
  knowledgeBaseText: string;
  communityId: string | null;
}): Array<Record<string, unknown>> {
  if (!params.initialGoalNodeId) return [];

  const kbId = `kb-${Date.now()}`;
  const communityId = `community-${Date.now()}`;

  const summary = buildKnowledgeExcerpt(
    params.knowledgeBaseText ||
      params.campaignBlueprint.summary ||
      params.website?.readableText ||
      "",
    600,
  );
  const communityName =
    params.campaignBlueprint.community?.name ||
    params.website?.siteName ||
    params.website?.title ||
    "Community Blueprint";
  const communityDescription =
    params.campaignBlueprint.community?.description ||
    summary ||
    "Turn the website positioning into a launch-ready community home base.";
  const communityFeatures = uniqueNonEmpty([
    ...(params.campaignBlueprint.community?.keyFeatures || []),
    ...(params.campaignBlueprint.product?.features || []),
  ]).slice(0, 4);
  const knowledgeBaseDescription = normalizeKnowledgeText(
    params.knowledgeBaseText ||
      params.campaignBlueprint.summary ||
      summary ||
      "Use this knowledge base card as the editable source of truth for the community positioning, offer, and campaign brief.",
    2400,
  );
  const communityCardDescription = normalizeKnowledgeText(
    [
      communityDescription,
      communityFeatures.length > 0 ? `Core features: ${communityFeatures.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    1400,
  );

  const campaignNodeId = `campaign-${Date.now()}`;
  const fundingNodeId = `funding-${Date.now() + 1}`;

  const campaignName =
    params.campaignBlueprint.campaign?.name ||
    params.campaignBlueprint.product?.name ||
    `${communityName} UGC Launch Campaign`;
  const campaignDescription = normalizeKnowledgeText(
    [
      params.campaignBlueprint.campaign?.angle,
      params.campaignBlueprint.campaign?.creatorBrief,
    ]
      .filter(Boolean)
      .join("\n\n") ||
      `Creator brief: Showcase ${communityName} to your audience using authentic short-form content. Target TikTok and Threads with native hooks and strong CTAs.`,
    600,
  );

  return [
    {
      type: "ADD_NODE",
      payload: {
        node: withWebsiteVisuals(
          {
            id: communityId,
            label: communityName,
            description: communityCardDescription,
            category: "foundation",
            status: params.communityId ? "completed" : "pending",
            x: 560,
            y: 240,
            dependencies: [params.initialGoalNodeId],
            connectsTo: [],
            ctaLabel: params.communityId ? "Open workspace" : "Build workspace now",
            ctaHref: params.communityId
              ? `/dashboard/community/${params.communityId}/settings`
              : undefined,
            animation: { entrance: "bounce", delay: 80 },
          },
          params.website,
        ),
      },
    },
    { type: "CONNECT_NODES", payload: { fromId: params.initialGoalNodeId, toId: communityId } },
    {
      type: "ADD_NODE",
      payload: {
        node: withWebsiteVisuals(
          {
            id: campaignNodeId,
            label: campaignName,
            description: campaignDescription,
            category: "marketing",
            status: "pending",
            x: 820,
            y: 240,
            dependencies: [communityId],
            connectsTo: [],
            ctaLabel: "View campaign brief",
            animation: { entrance: "bounce", delay: 160 },
          },
          params.website,
        ),
      },
    },
    { type: "CONNECT_NODES", payload: { fromId: communityId, toId: campaignNodeId } },
    {
      type: "ADD_NODE",
      payload: {
        node: {
          id: fundingNodeId,
          label: "Fund campaign treasury",
          description: `Deposit USDC into the campaign vault to activate creator payouts. Start with $5–$15. Platform fee: 20%. After deposit the campaign goes live and creators can submit content for ${campaignName}.`,
          category: "milestone",
          status: "pending",
          x: 1080,
          y: 240,
          dependencies: [campaignNodeId],
          connectsTo: [],
          ctaLabel: "Fund campaign",
          animation: { entrance: "bounce", delay: 240 },
        },
      },
    },
    { type: "CONNECT_NODES", payload: { fromId: campaignNodeId, toId: fundingNodeId } },
  ];
}

function extractInitialNodeIdFromActions(actions: Array<Record<string, unknown>>): string | undefined {
  for (const a of actions) {
    if (String(a.type || "").toUpperCase() !== "ADD_NODE") continue;
    const node = (a.payload as { node?: { id?: string; category?: string } } | undefined)?.node;
    if (node?.id && String(node.category || "") === "initial") return String(node.id);
  }
  return undefined;
}

function hasLaunchContextReady(params: {
  campaignBlueprint: CampaignBlueprint;
  website: WebsiteIntelligence | null;
  knowledgeBaseText: string;
}): boolean {
  if (Boolean(params.website?.readableText?.trim())) {
    return true;
  }

  const productName = params.campaignBlueprint.product?.name?.trim() || "";
  const communityName = params.campaignBlueprint.community?.name?.trim() || "";
  const communityDescription = params.campaignBlueprint.community?.description?.trim() || "";
  const audience = params.campaignBlueprint.community?.audience?.trim() || "";
  const features = uniqueNonEmpty([
    ...(params.campaignBlueprint.community?.keyFeatures || []),
    ...(params.campaignBlueprint.product?.features || []),
  ]);
  const knowledgeReady = params.knowledgeBaseText.trim().length >= 120;

  return Boolean(
    productName &&
      communityName &&
      (communityDescription || audience || knowledgeReady) &&
      features.length >= 2,
  );
}

type BuilderPhase = "goal_capture" | "context_building" | "campaign_ready";

function detectBuilderPhase(params: {
  effectiveCanvasNodes: unknown[];
  website: WebsiteIntelligence | null;
  communityId: string | null;
}): BuilderPhase {
  const nodes = params.effectiveCanvasNodes as Array<{ category?: string }>;
  const hasCommunity = nodes.some((n) => n.category === "foundation");
  const hasCampaign = nodes.some((n) => n.category === "marketing");
  if (hasCampaign || hasCommunity) return "campaign_ready";
  if (params.website?.readableText?.trim()) return "context_building";
  // Existing communityId = skip the "ask for website" gate
  if (params.communityId) return "context_building";
  return "goal_capture";
}

function buildPhaseContextBlock(params: {
  phase: BuilderPhase;
  website: WebsiteIntelligence | null;
  communityId: string | null;
}): string {
  return `\n\nBUILDER_PHASE_JSON: ${JSON.stringify({
    phase: params.phase,
    communityId: params.communityId || null,
    hasWebsite: Boolean(params.website?.readableText?.trim()),
    websiteName: params.website?.siteName || params.website?.title || null,
  })}`;
}

function buildContextBuildingCard(params: {
  initialGoalNodeId: string;
  campaignBlueprint: CampaignBlueprint;
  website: WebsiteIntelligence | null;
  communityId: string | null;
}): Array<Record<string, unknown>> {
  if (!params.initialGoalNodeId) return [];

  const communityNodeId = `community-${Date.now()}`;
  const communityName =
    params.campaignBlueprint.community?.name ||
    params.website?.siteName ||
    params.website?.title ||
    "Your Community";

  const communityDescription = normalizeKnowledgeText(
    params.campaignBlueprint.community?.description ||
    params.website?.description ||
    params.website?.readableText?.slice(0, 400) ||
    "Community built around your brand positioning.",
    600,
  );

  const communityNode: Record<string, unknown> = {
    id: communityNodeId,
    label: communityName,
    description: communityDescription,
    category: "foundation",
    status: params.communityId ? "completed" : "in_progress",
    x: 560,
    y: 240,
    dependencies: [params.initialGoalNodeId],
    connectsTo: [],
    ctaLabel: params.communityId ? "Open workspace" : "Build workspace now",
    ...(params.communityId
      ? { ctaHref: `/dashboard/community/${params.communityId}/settings` }
      : {}),
    animation: { entrance: "bounce", delay: 80 },
  };

  return [
    // Mark goal as completed
    { type: "UPDATE_NODE", payload: { id: params.initialGoalNodeId, updates: { status: "completed" } } },
    // Add community card with website visuals
    { type: "ADD_NODE", payload: { node: withWebsiteVisuals(communityNode, params.website) } },
    { type: "CONNECT_NODES", payload: { fromId: params.initialGoalNodeId, toId: communityNodeId } },
  ];
}

function buildCampaignFundCards(params: {
  communityNodeId: string;
  campaignBlueprint: CampaignBlueprint;
  website: WebsiteIntelligence | null;
  communityId: string | null;
}): Array<Record<string, unknown>> {
  if (!params.communityNodeId) return [];

  const campaignNodeId = `campaign-${Date.now()}`;
  const fundingNodeId = `funding-${Date.now() + 1}`;

  const communityName = params.campaignBlueprint.community?.name || "Your Community";
  const campaignName =
    params.campaignBlueprint.campaign?.name || `${communityName} UGC Launch Campaign`;

  const campaignDescription = normalizeKnowledgeText(
    [
      params.campaignBlueprint.campaign?.angle,
      params.campaignBlueprint.campaign?.creatorBrief,
    ]
      .filter(Boolean)
      .join("\n\n") ||
      `Creator brief: Showcase ${communityName} to your audience using authentic short-form content. Highlight the brand promise and drive community joins.`,
    600,
  );

  const campaignNode: Record<string, unknown> = {
    id: campaignNodeId,
    label: campaignName,
    description: campaignDescription,
    category: "marketing",
    status: "in_progress",
    x: 820,
    y: 240,
    dependencies: [params.communityNodeId],
    connectsTo: [],
    ctaLabel: "View campaign brief",
    animation: { entrance: "bounce", delay: 80 },
  };

  const ctaHref = params.communityId
    ? `/dashboard/community/${params.communityId}/settings`
    : undefined;

  return [
    // Mark community as completed
    {
      type: "UPDATE_NODE",
      payload: {
        id: params.communityNodeId,
        updates: {
          status: "completed",
          ...(ctaHref ? { ctaHref } : {}),
          ctaLabel: params.communityId ? "Open workspace" : "Build workspace now",
        },
      },
    },
    { type: "ADD_NODE", payload: { node: withWebsiteVisuals(campaignNode, params.website) } },
    { type: "CONNECT_NODES", payload: { fromId: params.communityNodeId, toId: campaignNodeId } },
    {
      type: "ADD_NODE",
      payload: {
        node: {
          id: fundingNodeId,
          label: "Fund campaign treasury",
          description: `Deposit USDC into the campaign vault to activate creator payouts. Start with $5–$15 USDC. Platform fee: ${CAMPAIGN_TREASURY_PLATFORM_FEE_PERCENT}%. Campaign goes live immediately after your deposit.`,
          category: "milestone",
          status: "pending",
          x: 1080,
          y: 240,
          dependencies: [campaignNodeId],
          connectsTo: [],
          ctaLabel: "Fund campaign",
          animation: { entrance: "bounce", delay: 160 },
        },
      },
    },
    { type: "CONNECT_NODES", payload: { fromId: campaignNodeId, toId: fundingNodeId } },
  ];
}

// Phrases that indicate Claude drifted into campaign role-detection mode
const ROLE_DETECTION_MARKERS = [
  "first i need to route this correctly",
  "are you building for a brand or community",
  "are you asking as a creator",
  "route this correctly:",
  "i can keep going. first",
  // Generic "fresh start" prompts that leak from the campaign role-detection fallback
  "what are you building?",
  "share a quick description and i",
  "map the right approach for you",
];

function containsRoleDetection(text: string): boolean {
  const lower = text.toLowerCase();
  return ROLE_DETECTION_MARKERS.some((m) => lower.includes(m));
}

function getAgentPhaseFallback(agentType: AgentType, phase: AgentBuilderPhase, blueprint?: AgentBlueprint): string {
  if (agentType === "influencer") {
    const p = blueprint?.persona;
    // Persona-aware fallback — never re-asks something already filled
    if (phase === "persona_discovery") {
      if (!p?.name) return "What's your AI influencer's name? Just the name they'll be known by.";
      if (!p?.niche) return `Nice — ${p.name} it is. What niche will ${p.name} own: lifestyle, fashion, tech, fitness, food, travel, finance, gaming, or beauty?`;
      if (!p?.audience) return `Got it — ${p.name} the ${p.niche} influencer. Who's their target audience? (e.g. Gen Z in KL, working women in SEA, etc.)`;
      return `${p.name} is shaping up nicely. Ready to upload 3 reference photos so I can lock the visual identity?`;
    }
    if (phase === "aesthetic_upload") {
      return p?.name
        ? `Upload 3 reference photos so I can generate ${p.name}'s NFT avatar set.`
        : "Upload 3 reference photos so I can generate a consistent NFT avatar set.";
    }
    if (phase === "nft_mint") {
      return p?.name
        ? `${p.name}'s avatars are ready. Hit Mint on the card above (0.5 SOL) to deploy them on Solana.`
        : "Your NFT avatars are ready. Hit Mint on the card above (0.5 SOL) to continue.";
    }
    if (phase === "knowledge_building") {
      const name = p?.name ?? "Your agent";
      if (!p?.handle) return `What should ${name}'s social handle be? (e.g. @${(p?.name ?? "agent").toLowerCase()}_vello)`;
      if (!p?.voiceArchetype) return `How does ${name} talk to their audience — Mentor / Entertainer / Friend / Expert / Aspirational?`;
      if (!p?.language) return `What language will ${name} post in primarily?`;
      if (!p?.contentPillars?.length) return `Name 3 content pillars ${name} will own. What do they post about every week?`;
      if (!p?.backstory) return `Tell me ${name}'s origin story. How did they become who they are today?`;
      if (!p?.traits?.length) return `What are 3 core traits that define ${name}'s personality?`;
      if (!p?.catchphrase) return `What's ${name}'s signature opening line their audience will recognise?`;
      return `${name} is fully configured. Want to generate a video, analyze a trend, or refine the persona?`;
    }
    if (phase === "agent_ready") {
      return p?.name
        ? `${p.name} is live on Solana. Want to generate content, analyze trends, or refine their knowledge base?`
        : "Your AI Influencer is live on Solana.";
    }
    return p?.name ? `Let's keep building ${p.name}. What's next?` : "Let's keep building your AI Influencer. What's next?";
  }
  if (agentType === "worker") {
    const map: Record<string, string> = {
      business_context: "Tell me about the business — what does it sell and what’s the #1 task for this AI worker?",
      capability_mapping: "Let’s define the capabilities. What can this worker do, and what should it never do autonomously?",
      knowledge_config: "The worker needs a knowledge base. Share FAQs, product info, or policies — and give it a name.",
      deployment_ready: "Your AI Worker is ready. Pick a deployment channel: WhatsApp, web widget, email, or Telegram.",
    };
    return map[phase] ?? "Let’s keep configuring your AI Worker. What’s next?";
  }
  if (agentType === "trader") {
    const t = blueprint?.trader;
    const s = t?.strategy;
    if (phase === "strategy_discovery") {
      if (!t?.name) return "Let's name your trader first. What should we call it? (e.g. \"Solana Sentiment Scout\")";
      if (!s?.assetUniverse?.length) return `What assets should ${t.name} trade? Solana spot only — SOL, JUP, BONK, JTO, etc.`;
      return `Sum up ${t.name}'s thesis in one line — what's the edge?`;
    }
    if (phase === "trader_aesthetic") {
      return `Now let's design ${t?.name ?? "your trader"}'s look. Describe the vibe — sleek hooded hacker, lab-coated quant, retro arcade cabinet, neon owl, anime trader, whatever fits the strategy. Or upload a reference image and I'll match it.`;
    }
    if (phase === "signal_setup") {
      return `Which signals should ${t?.name ?? "the trader"} watch? X keywords, accounts to follow, on-chain whale moves, news feeds?`;
    }
    if (phase === "decision_rules") {
      return `When should ${t?.name ?? "the trader"} BUY, and when should it SELL? Give me thresholds.`;
    }
    if (phase === "wallet_funding") {
      return `Set risk: max % of wallet per position, daily trade cap (USDC), and autonomy — approve each trade, auto-execute, or signal-only?`;
    }
    if (phase === "paper_trade") {
      return `Ready to backtest ${t?.name ?? "the trader"} against the last 7 days of cached signals? I'll show you what would have triggered.`;
    }
    if (phase === "trader_mint") {
      return `Strategy locked. Mint ${t?.name ?? "your trader"} as an NFT (0.5 SOL) to lock the spec on-chain and go live.`;
    }
    if (phase === "trader_ready") {
      return `${t?.name ?? "Your trader"} is live. Tell me what to do: "execute a tick", "go agentic", "watch ETH whales", "install news feed", "place a $5 BTC UP bet", "what have you learned?" — I'll execute on your behalf.`;
    }
    return "Let's keep building your AI Trader. What's next?";
  }
  return "Let’s keep going. What would you like to build?";
}

function buildResilientFallbackMessage(params: {
  interactionMode: "creator_answering" | "agency_agentic" | "role_detection";
  website: WebsiteIntelligence | null;
  campaignBlueprint: CampaignBlueprint;
  knowledgeBaseText: string;
  agentType?: AgentType;
  agentPhase?: AgentBuilderPhase;
  agentBlueprint?: AgentBlueprint;
}): string {
  // For non-campaign types, never return role-detection text
  if (params.agentType === "influencer" || params.agentType === "worker") {
    return getAgentPhaseFallback(
      params.agentType,
      params.agentPhase ?? (params.agentType === "influencer" ? "persona_discovery" : "business_context"),
      params.agentBlueprint,
    );
  }

  if (params.interactionMode === "role_detection") {
    return "What are you building? Share a quick description and I’ll map the right approach for you.";
  }

  if (params.interactionMode === "creator_answering") {
    return "I can still help from here. Tell me whether you want clipping guidance, UGC ideas, or payout / approval help, and I’ll keep it focused.";
  }

  if (!params.website && !hasLaunchContextReady(params)) {
    return "To create the community properly, send your website URL or give me the product name, audience, and 2–4 core features.";
  }

  return "I can keep building from the current context. I’ll focus on the community first, then we can save the workspace.";
}

type KieMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    >;

function injectVisionIntoMessages(
  messages: { role: ChatRole; content: string }[],
  uploadedImageUrl: string,
): { role: ChatRole; content: KieMessageContent }[] {
  if (!uploadedImageUrl.startsWith("data:")) return messages;

  const match = uploadedImageUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return messages;
  const [, mediaType, base64Data] = match;

  // Inject the image into the most recent user message that mentions an image upload
  const out: { role: ChatRole; content: KieMessageContent }[] = [];
  let injected = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!injected && messages[i].role === "user" && messages[i].content.includes("[Uploaded reference image:")) {
      out.unshift({
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
          { type: "text", text: messages[i].content },
        ],
      });
      injected = true;
    } else {
      out.unshift(messages[i]);
    }
  }
  return out;
}

// Per-request timeout helper — aborts hung Kie calls so we can fall back fast
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// Pull a text delta from a single streamed SSE chunk. Kie has shipped Gemini 3
// Flash under both the OpenAI-compat shape (`choices[].delta.content`) AND the
// Gemini-native shape (`candidates[].content.parts[].text`), so we must accept
// either — handling only one silently drops every token (the bug that made the
// previous author abandon streaming).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tokenFromStreamChunk(chunk: any): string {
  // Anthropic Messages stream (Claude Haiku 4.5 via Kie): text arrives as
  // content_block_delta → delta.text_delta. message_start/_stop carry no text.
  if (chunk?.type === "content_block_delta" && chunk?.delta?.type === "text_delta" && typeof chunk.delta.text === "string") {
    return chunk.delta.text;
  }
  const delta = chunk?.choices?.[0]?.delta?.content;
  if (typeof delta === "string" && delta) return delta;
  if (Array.isArray(delta)) {
    const joined = delta.map((p: { text?: string }) => p?.text ?? "").join("");
    if (joined) return joined;
  }
  const parts = chunk?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const joined = parts.map((p: { text?: string }) => p?.text ?? "").join("");
    if (joined) return joined;
  }
  // Some wrappers stream the OpenAI message shape (non-delta) per chunk.
  const msg = chunk?.choices?.[0]?.message?.content;
  if (typeof msg === "string" && msg) return msg;
  return "";
}

// Incrementally decode the value of the top-level "message" JSON field from a
// partial buffer, so we can stream the assistant's reply LIVE while the rest of
// the JSON object (agentActions, agentBlueprint, …) is still being generated.
// Returns the decoded message text so far, or null if the field hasn't started.
// Stops cleanly at an incomplete trailing escape so we never emit half a char.
function extractStreamingMessage(buf: string): string | null {
  const m = buf.match(/"message"\s*:\s*"/);
  if (!m) return null;
  let i = (m.index ?? 0) + m[0].length;
  let out = "";
  while (i < buf.length) {
    const ch = buf[i];
    if (ch === '"') break;                       // unescaped closing quote → done
    if (ch === "\\") {
      if (i + 1 >= buf.length) break;            // dangling backslash → wait for more
      const next = buf[i + 1];
      switch (next) {
        case "n": out += "\n"; i += 2; break;
        case "t": out += "\t"; i += 2; break;
        case "r": out += "\r"; i += 2; break;
        case "b": out += "\b"; i += 2; break;
        case "f": out += "\f"; i += 2; break;
        case '"': out += '"'; i += 2; break;
        case "\\": out += "\\"; i += 2; break;
        case "/": out += "/"; i += 2; break;
        case "u": {
          if (i + 6 > buf.length) { i = buf.length; break; }  // incomplete \uXXXX → wait
          const hex = buf.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 6; }
          else { out += next; i += 2; }
          break;
        }
        default: out += next; i += 2; break;
      }
    } else {
      out += ch; i += 1;
    }
  }
  return out;
}

/**
 * Streaming token generator — yields individual text chunks from Kie Gemini SSE.
 * Returns the full accumulated text when the stream ends.
 * Times out after 55s if the first byte doesn't arrive (not total duration).
 */
async function* kieGeminiTokenStream(params: {
  system: string;
  messages: { role: ChatRole; content: KieMessageContent }[];
  model?: string;
}): AsyncGenerator<string, void, unknown> {
  const apiKey = getKieApiKey();
  if (!apiKey) throw new Error("KIE_API_KEY is not configured");
  // Honour the selected Gemini id. Previously this was hard-wired to gemini-3-flash
  // (via KIE_GEMINI_URL) regardless of what the client picked, which is why the
  // "Gemini 3.6 Flash" option still hit the slow 3-flash route.
  const model = params.model?.trim() || "gemini-3-flash";
  const url = model === "gemini-3-flash" ? KIE_GEMINI_URL : kieUrlForModel(model);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          include_thoughts: false,
          messages: [{ role: "system", content: params.system }, ...params.messages],
        }),
      }, 55_000);

      if (!res.ok) {
        const text = await res.text();
        console.error(`[kie-stream] model=${model} HTTP ${res.status}: ${text.slice(0, 400)}`);
        const transient = res.status >= 500 || /bad.?gateway|timeout/i.test(text);
        if (res.status >= 500) markKieRouteDown(model, res.status);
        if (transient && attempt < 2) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        throw new Error(`Kie ${model} ${res.status}: ${summarizeKieError(text)}`);
      }
      console.log(`[kie-stream] model=${model} Connected · attempt ${attempt} · status ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buf = "";

      try {
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const d = t.slice(5).trim();
            if (d === "[DONE]") break outer;
            try {
              const tok = tokenFromStreamChunk(JSON.parse(d));
              if (tok) yield tok;
            } catch { /* skip malformed SSE chunk */ }
          }
        }
      } finally {
        reader.releaseLock();
      }
      return;
    } catch (err) {
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 1200)); continue; }
      throw err;
    }
  }
}

/**
 * Universal chat path — Gemini 3 Flash ONLY. Retries up to 3 times with backoff
 * on transient failures (5xx, timeouts) before giving up. No Claude fallback.
 */
async function callKieGeminiChat(params: {
  system: string;
  messages: { role: ChatRole; content: string }[];
  uploadedImageUrl?: string;
  model?: string;
}): Promise<string> {
  const apiKey = getKieApiKey();
  if (!apiKey) throw new Error("KIE_API_KEY is not configured");

  // Inject the uploaded image into the latest user turn as an image part
  // (Gemini 3 Flash supports vision via the OpenAI-compat image_url format).
  let messages = params.messages;
  if (params.uploadedImageUrl) {
    const idx = [...messages].reverse().findIndex((m) => m.role === "user");
    if (idx >= 0) {
      const realIdx = messages.length - 1 - idx;
      const target = messages[realIdx];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withImage: any = {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: params.uploadedImageUrl } },
          { type: "text", text: target.content },
        ],
      };
      messages = [...messages.slice(0, realIdx), withImage, ...messages.slice(realIdx + 1)];
    }
  }

  // Gemini 3 Flash ONLY — no fallback chain. Falling through to 2.5/2.0 meant a
  // single reply fired two sequential model calls (3-flash → 2.5-flash), which
  // doubled latency. We request exactly one model. An explicit KIE_GEMINI_MODEL
  // env var can override the id if the account exposes 3 Flash under another name.
  const modelCandidates = [
    params.model?.trim() || process.env.KIE_GEMINI_MODEL?.trim() || "gemini-3-flash",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractContent(data: any): string {
    // Try every shape Kie/Gemini wrappers are known to return.
    const c = data?.choices?.[0]?.message?.content;
    if (typeof c === "string" && c.trim()) return c;
    // Anthropic-style content parts
    if (Array.isArray(c)) {
      const joined = c.map((p: { text?: string; content?: string }) => p?.text ?? p?.content ?? "").join("");
      if (joined.trim()) return joined;
    }
    // Gemini-native: candidates[].content.parts[].text
    const parts = data?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      const joined = parts.map((p: { text?: string }) => p?.text ?? "").join("");
      if (joined.trim()) return joined;
    }
    // Some wrappers stuff prose at the top level
    if (typeof data?.message === "string" && data.message.trim()) return data.message;
    if (typeof data?.text === "string" && data.text.trim()) return data.text;
    return "";
  }

  const maxAttempts = 2;
  let lastErr: unknown;
  for (const model of modelCandidates) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetchWithTimeout(kieUrlForModel(model), {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: "system", content: params.system },
              ...messages,
            ],
          }),
        }, 40_000);

        if (!response.ok) {
          const text = await response.text();
          console.error(`[kie] model=${model} HTTP ${response.status}: ${text.slice(0, 400)}`);
          const isModelMiss = response.status === 404 || /model.*not.*(found|exist)|unknown.*model/i.test(text);
          const transient = response.status >= 500 || /bad.?gateway|service.?unavailable|timeout/i.test(text);
          if (response.status >= 500) markKieRouteDown(model, response.status);
          if (isModelMiss) break;                                          // try next model
          if (transient && attempt < maxAttempts) { await new Promise((r) => setTimeout(r, 800 * attempt)); continue; }
          throw new Error(`Kie ${model} ${response.status}: ${summarizeKieError(text)}`);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await response.json().catch(() => ({}))) as any;
        if (data?.error) throw new Error(typeof data.error === "string" ? data.error : (data.error.message ?? "Kie error"));
        const text = extractContent(data).trim();
        if (!text) {
          // Log the raw response so we can see what shape Kie sent
          console.error(`[kie] model=${model} returned empty content. Raw shape keys: ${Object.keys(data || {}).join(",")} | dump: ${JSON.stringify(data).slice(0, 500)}`);
          // Try next model — current one is producing nothing useful
          break;
        }
        console.log(`[kie] model=${model} OK · ${text.length} chars`);
        return text;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        // Retry only on clearly transient network/5xx errors — NOT on timeout/abort.
        // Retrying a 40s timeout would make the user wait 80s; fail fast instead so
        // the client-side fallback (post/video) can act.
        const transient = /fetch.?failed|50[0-9]|bad.?gateway|service.?unavailable/i.test(msg);
        if (transient && attempt < maxAttempts) {
          console.warn(`[kie] model=${model} attempt ${attempt} failed (${msg.slice(0, 80)}), retrying…`);
          await new Promise((r) => setTimeout(r, 800 * attempt));
          continue;
        }
        break;                                                              // give up (single model now)
      }
    }
  }
  throw lastErr ?? new Error(`Kie returned no usable content from any model (tried: ${modelCandidates.join(", ")}). Set KIE_GEMINI_MODEL in .env to the model ID enabled on your account.`);
}

// ── Claude Haiku 4.5 via Kie (Anthropic Messages shape) ─────────────────────────
// Differs from Gemini: `system` is a TOP-LEVEL field (not a message), `messages`
// are user/assistant only, responses are content[].text (buffered) /
// content_block_delta (stream). `max_tokens` defaults to 4096.

// Build Anthropic-shaped messages. Kie's Claude endpoint accepts plain-string
// content; we fold an uploaded image into the latest user turn as a note so the
// model has context without depending on Kie supporting Anthropic image blocks.
/** Anthropic's Messages API requires the FIRST message to be a user turn. The
 *  builder seeds its history with an assistant greeting, so without this the
 *  proxy munges roles and the model can perceive the prompt as user-pasted. */
function ensureUserFirstForClaude(
  msgs: { role: ChatRole; content: string }[],
): { role: ChatRole; content: string }[] {
  if (msgs.length === 0 || msgs[0].role !== "user") {
    return [{ role: "user" as ChatRole, content: "[APP EVENT] Builder session opened." }, ...msgs];
  }
  return msgs;
}

function buildClaudeMessages(
  messages: { role: ChatRole; content: string }[],
  uploadedImageUrl?: string,
): { role: ChatRole; content: string }[] {
  const msgs = ensureUserFirstForClaude(messages.map((m) => ({ role: m.role, content: m.content })));
  if (uploadedImageUrl) {
    const idx = [...msgs].reverse().findIndex((m) => m.role === "user");
    if (idx >= 0) {
      const realIdx = msgs.length - 1 - idx;
      msgs[realIdx] = {
        ...msgs[realIdx],
        content: `${msgs[realIdx].content}\n\n[The user attached an image: ${uploadedImageUrl}]`,
      };
    }
  }
  return msgs;
}

/** Streaming token generator for Claude Haiku 4.5. Yields text deltas. */
async function* kieClaudeTokenStream(params: {
  system: string;
  messages: { role: ChatRole; content: KieMessageContent }[];
}): AsyncGenerator<string, void, unknown> {
  const apiKey = getKieApiKey();
  if (!apiKey) throw new Error("KIE_API_KEY is not configured");

  const plain = ensureUserFirstForClaude(params.messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string"
      ? m.content
       
      : (m.content as Array<{ type: string; text?: string }>).map((p) => p.text ?? "").join("\n"),
  })));

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout(KIE_CLAUDE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: KIE_CLAUDE_MODEL,
          system: params.system,
          messages: plain,
          stream: true,
          max_tokens: 4096,
        }),
      }, 55_000);

      if (!res.ok) {
        const text = await res.text();
        console.error(`[kie-claude-stream] HTTP ${res.status}: ${text.slice(0, 400)}`);
        const transient = res.status >= 500 || /bad.?gateway|timeout/i.test(text);
        if (res.status >= 500) markKieRouteDown("claude-haiku-4-5", res.status);
        if (transient && attempt < 2) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        throw new Error(`Kie Claude ${res.status}: ${summarizeKieError(text)}`);
      }
      console.log(`[kie-claude-stream] Connected · attempt ${attempt} · status ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;               // ignore SSE `event:` lines
            const d = t.slice(5).trim();
            if (!d || d === "[DONE]") continue;
            try {
              const tok = tokenFromStreamChunk(JSON.parse(d));
              if (tok) yield tok;
            } catch { /* skip malformed SSE chunk */ }
          }
        }
      } finally {
        reader.releaseLock();
      }
      return;
    } catch (err) {
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 1200)); continue; }
      throw err;
    }
  }
}

/** Buffered (non-streaming) Claude Haiku 4.5 call — returns the reply text. */
async function callKieClaudeChat(params: {
  system: string;
  messages: { role: ChatRole; content: string }[];
  uploadedImageUrl?: string;
}): Promise<string> {
  const apiKey = getKieApiKey();
  if (!apiKey) throw new Error("KIE_API_KEY is not configured");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractContent(data: any): string {
    const parts = data?.content;
    if (Array.isArray(parts)) {
      const joined = parts.map((p: { text?: string; type?: string }) => (p?.type === "text" ? p.text ?? "" : "")).join("");
      if (joined.trim()) return joined;
    }
    if (typeof data?.message === "string" && data.message.trim()) return data.message;
    return "";
  }

  const maxAttempts = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(KIE_CLAUDE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: KIE_CLAUDE_MODEL,
          system: params.system,
          messages: buildClaudeMessages(params.messages, params.uploadedImageUrl),
          stream: false,
          max_tokens: 4096,
        }),
      }, 40_000);

      if (!response.ok) {
        const text = await response.text();
        console.error(`[kie-claude] HTTP ${response.status}: ${text.slice(0, 400)}`);
        const transient = response.status >= 500 || /bad.?gateway|service.?unavailable|timeout/i.test(text);
        if (response.status >= 500) markKieRouteDown("claude-haiku-4-5", response.status);
        if (transient && attempt < maxAttempts) { await new Promise((r) => setTimeout(r, 800 * attempt)); continue; }
        throw new Error(`Kie Claude ${response.status}: ${summarizeKieError(text)}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await response.json().catch(() => ({}))) as any;
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : (data.error.message ?? "Kie Claude error"));
      const text = extractContent(data).trim();
      if (!text) {
        console.error(`[kie-claude] empty content. keys: ${Object.keys(data || {}).join(",")} | dump: ${JSON.stringify(data).slice(0, 500)}`);
        throw new Error("Kie Claude returned empty content");
      }
      console.log(`[kie-claude] OK · ${text.length} chars`);
      return text;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient = /fetch.?failed|50[0-9]|bad.?gateway|service.?unavailable/i.test(msg);
      if (transient && attempt < maxAttempts) { await new Promise((r) => setTimeout(r, 800 * attempt)); continue; }
      break;
    }
  }
  throw lastErr ?? new Error("Kie Claude returned no usable content");
}

// ── Model dispatchers — pick Gemini or Claude based on the selected chat model ──
// ── Gemini direct (Google's OpenAI-compatible endpoint) — the FAST chat path ──
// Kie resells the same Gemini 3.6 Flash but queues every request: measured
// 2026-09-23, 33-36s to first token for "say hi" (streamed or not), while the
// same model direct answered in ~2s with thinking off. Every Gemini pick (the
// default) now goes direct first; Kie is the automatic fallback when the direct
// call fails BEFORE its first token (a mid-stream failure can't be retracted,
// so it surfaces like any other stream error and the buffered chain retries).
// Claude picks stay on Kie. Image generation / video never touched this path —
// those routes call Kie themselves.
const GEMINI_DIRECT_KEY = GEMINI_KEY;
/** First-byte budget for the direct call before falling back to Kie. */
const GEMINI_DIRECT_TIMEOUT_MS = 20_000;
/** Google's "model overloaded" / rate-limit replies — worth one quick retry. */
function isGeminiTransient(message: string): boolean {
  return /Gemini direct (503|429)\b/.test(message);
}
function geminiDirectFor(model: KieChatModel): boolean {
  return !!GEMINI_DIRECT_KEY && model !== "claude-haiku-4-5";
}
function asGeminiMessages(system: string, messages: { role: ChatRole; content: KieMessageContent }[]): GeminiMessage[] {
  return [
    { role: "system", content: system },
    ...messages.map((message): GeminiMessage => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content : message.content.map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : { type: "image_url" as const, image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` } },
      ),
    })),
  ];
}

async function* geminiDirectTokenStream(params: {
  system: string;
  messages: { role: ChatRole; content: KieMessageContent }[];
}): AsyncGenerator<string, void, unknown> {
  // Model chain + quota-aware parking live in lib/server/geminiFast: a model
  // that's out of quota is skipped instead of failing the whole turn to Kie.
  const opened = await openGeminiStream(
    asGeminiMessages(params.system, params.messages),
    { timeoutMs: GEMINI_DIRECT_TIMEOUT_MS, tag: "builder" },
  );
  if (!opened) throw new Error("Gemini direct: no model available");
  const res = opened.res;
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Gemini direct: no response stream");
  const decoder = new TextDecoder();
  let buf = "";
  let loggedProvider = false;
  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const d = t.slice(5).trim();
        if (d === "[DONE]") break outer;
        try {
          const tok = tokenFromStreamChunk(JSON.parse(d));
          if (tok) {
            if (!loggedProvider) {
              console.info(`[chat] builder reply from Google Gemini ${opened.model}`);
              loggedProvider = true;
            }
            yield tok;
          }
        } catch { /* skip malformed SSE chunk */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function callGeminiDirectChat(params: { system: string; messages: { role: ChatRole; content: string }[]; uploadedImageUrl?: string }): Promise<string> {
  const messages = params.uploadedImageUrl
    ? injectVisionIntoMessages(params.messages, params.uploadedImageUrl)
    : params.messages;
  const r = await geminiChat(
    asGeminiMessages(params.system, messages),
    { timeoutMs: GEMINI_DIRECT_TIMEOUT_MS * 2, tag: "builder" },
  );
  if (!r) throw new Error("Gemini direct: no model available");
  return r.text;
}

async function* streamGeminiDirectThenKie(model: KieChatModel, params: {
  system: string;
  messages: { role: ChatRole; content: KieMessageContent }[];
}): AsyncGenerator<string, void, unknown> {
  let yielded = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      for await (const tok of geminiDirectTokenStream(params)) { yielded = true; yield tok; }
      if (yielded) return;
      console.warn("[chat] Gemini direct stream produced no text — falling back to Kie");
      break;
    } catch (e) {
      if (yielded) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      // Google's 503/429 ("overloaded") clears in about a second, and Kie is
      // ~30s slower — retry direct once before falling back.
      if (attempt === 1 && isGeminiTransient(msg)) {
        console.warn(`[chat] Gemini direct ${msg.slice(0, 60)} — retrying once`);
        await new Promise((res) => setTimeout(res, 700));
        continue;
      }
      console.warn(`[chat] Gemini direct stream failed (${msg}) — falling back to Kie`);
      break;
    }
  }
  yield* kieGeminiTokenStream({ ...params, model });
}

function kieChatTokenStream(model: KieChatModel, params: {
  system: string;
  messages: { role: ChatRole; content: KieMessageContent }[];
}): AsyncGenerator<string, void, unknown> {
  if (model === "claude-haiku-4-5") return kieClaudeTokenStream(params);
  if (geminiDirectFor(model)) return streamGeminiDirectThenKie(model, params);
  return kieGeminiTokenStream({ ...params, model });
}
async function callKieChat(model: KieChatModel, params: {
  system: string;
  messages: { role: ChatRole; content: string }[];
  uploadedImageUrl?: string;
}): Promise<string> {
  if (model === "claude-haiku-4-5") return callKieClaudeChat(params);
  if (geminiDirectFor(model)) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await callGeminiDirectChat(params);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt === 1 && isGeminiTransient(msg)) { await new Promise((res) => setTimeout(res, 700)); continue; }
        console.warn(`[chat] Gemini direct failed (${msg}) — falling back to Kie`);
        break;
      }
    }
  }
  return callKieGeminiChat({ ...params, model });
}

// ── Kie route circuit breaker ────────────────────────────────────────────────
// Kie's per-model routes fail independently (2026-09-02: /claude/v1/messages
// answered 502/503 with a Cloudflare HTML page for hours while every Gemini
// route served 200s on the same key, same balance). Remember a 5xx per model
// for a short window so the next turns skip the dead route immediately instead
// of burning ~10s of retries before failing over.
const KIE_ROUTE_DOWN_MS = 3 * 60 * 1000;
const kieRouteDownUntil = new Map<string, number>();
function markKieRouteDown(model: string, status: number): void {
  kieRouteDownUntil.set(model, Date.now() + KIE_ROUTE_DOWN_MS);
  console.warn(`[kie] route ${model} marked down (HTTP ${status}) for ${KIE_ROUTE_DOWN_MS / 1000}s`);
}
function isKieRouteDown(model: string): boolean {
  const until = kieRouteDownUntil.get(model);
  if (!until) return false;
  if (until <= Date.now()) { kieRouteDownUntil.delete(model); return false; }
  return true;
}
/** Fallback order when a model's route is unusable. 3.6 Flash first — verified
 *  ~4s round-trip vs ~30s for gemini-3-flash on the same account. */
function kieFailoverOrder(current: KieChatModel): KieChatModel[] {
  const pref: KieChatModel[] = ["gemini-3-6-flash-openai", "gemini-3-flash", "claude-haiku-4-5"];
  return pref.filter((m) => m !== current);
}
/** Kie 5xx bodies are often a Cloudflare HTML error page; surface a readable
 *  one-liner instead of dumping `<!DOCTYPE html><!--[if lt IE 7]>…` at the user. */
function summarizeKieError(text: string): string {
  const t = text.trim();
  if (/^\s*<!doctype html|^\s*<html/i.test(t)) {
    const title = t.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    return `upstream gateway error (HTML response${title ? `: ${title}` : ""})`;
  }
  return t.slice(0, 200);
}

// ── Agent-type helpers ────────────────────────────────────────────────────────

/**
 * Heuristically fills missing persona fields from the latest user message.
 * Runs server-side BEFORE the AI call so that even when the AI fails or returns
 * malformed JSON, the blueprint progresses and we never re-ask the same question.
 */
function applyHeuristicPersonaExtraction(
  blueprint: AgentBlueprint,
  messages: Array<{ role: string; content: string }>,
): AgentBlueprint {
  if (blueprint.agentType !== "influencer" || !messages.length) return blueprint;

  const lastUser = [...messages].reverse().find(
    (m) => m.role === "user" && typeof m.content === "string" && !m.content.startsWith("[SYSTEM]"),
  );
  const userText = lastUser?.content?.trim() ?? "";
  if (!userText) return blueprint;

  const persona = { ...(blueprint.persona ?? {}) };
  const lc = userText.toLowerCase();

  // 1) Niche
  const NICHES = ["lifestyle", "tech", "fashion", "fitness", "food", "travel", "finance", "gaming", "beauty", "crypto"];
  const detectedNiche = NICHES.find((n) => lc.includes(n));
  if (detectedNiche && !persona.niche) persona.niche = detectedNiche;

  // 2) Handle (@something)
  const handleMatch = userText.match(/@([a-zA-Z0-9_]{3,30})/);
  if (handleMatch && !persona.handle) persona.handle = handleMatch[1];

  // 3) Voice archetype
  const ARCHETYPES = ["mentor", "entertainer", "friend", "expert", "aspirational"] as const;
  const detectedArchetype = ARCHETYPES.find((a) => lc === a || lc.startsWith(a + " ") || lc.endsWith(" " + a));
  if (detectedArchetype && !persona.voiceArchetype) {
    persona.voiceArchetype = detectedArchetype as NonNullable<AgentBlueprint["persona"]>["voiceArchetype"];
  }

  // 4) Language
  const LANGUAGES = ["english", "manglish", "bahasa malaysia", "bahasa indonesia", "tagalog", "mandarin", "arabic"];
  const detectedLang = LANGUAGES.find((l) => lc.includes(l));
  if (detectedLang && !persona.language) {
    persona.language = detectedLang.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // 5) Name (explicit pattern OR short single-token reply)
  const nameMatch = userText.match(/(?:name\s*[:\-]\s*|i'?m\s+|call\s+(?:her|him|them)\s+|named\s+)([A-Z][a-zA-Z]{1,24})/);
  if (nameMatch && !persona.name) {
    persona.name = nameMatch[1];
  } else if (!persona.name && !detectedNiche && userText.length > 0 && userText.length < 40) {
    const words = userText.replace(/[^a-zA-Z\s'-]/g, "").trim().split(/\s+/).filter(Boolean);
    if (words.length >= 1 && words.length <= 3) {
      const candidate = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
      if (!/^(yes|no|ok|okay|sure|hi|hello|thanks|tq|tqsm|nice|cool|great|good|fine|done|next|continue|skip|ready|yep|nope|nah|maybe)$/i.test(words[0])) {
        persona.name = candidate;
      }
    }
  }

  // 6) Content pillars — comma-separated short phrases
  if (!persona.contentPillars?.length && userText.includes(",")) {
    const parts = userText.split(/[,;\n]/).map((s) => s.trim()).filter((s) => s.length > 1 && s.length < 60);
    if (parts.length >= 2 && parts.length <= 8) {
      const totalLen = parts.join("").length;
      if (totalLen / userText.length > 0.5) persona.contentPillars = parts;
    }
  }

  return { ...blueprint, persona };
}

function detectAgentPhase(
  type: AgentType,
  messages: Array<{ role: string; content: string }>,
  canvasNodeCount: number,
  blueprint?: AgentBlueprint,
): AgentBuilderPhase {
  if (type === "campaign") return "goal_capture"; // handled by existing detectBuilderPhase

  // Influencer phase routing is driven by blueprint state — NOT message counts.
  // This avoids losing context when auto-trigger messages create chat drift.
  if (type === "influencer") {
    if (blueprint?.agentStatus === "ready") return "agent_ready";
    if (blueprint?.mintCompleted) return "knowledge_building";
    if (blueprint?.avatarsGenerated) return "nft_mint";
    // Pre-avatar: discovery → aesthetic_upload based on whether we know name/niche
    const persona = blueprint?.persona;
    if (persona?.name && persona?.niche) return "aesthetic_upload";
    return "persona_discovery";
  }

  // Trader phase — mirrors the influencer flow: mint FIRST, deep config AFTER.
  // Order: strategy → aesthetic → MINT (charge 0.5 SOL) → signals → rules → funding → backtest → ready
  if (type === "trader") {
    const t = blueprint?.trader;
    const s = t?.strategy;

    // After-mint progression
    if (blueprint?.mintCompleted) {
      if (s?.riskCaps && Object.keys(s.riskCaps).length > 0 && s.autonomy) return "trader_ready";
      if (s?.decisionRules && s.decisionRules.length > 0) return "wallet_funding";
      if (s?.dataSources && s.dataSources.length > 0) return "decision_rules";
      return "signal_setup";
    }

    // Pre-mint: lock the identity (name + thesis + avatar) THEN mint
    if (blueprint?.avatarsGenerated) return "trader_mint";
    if (t?.name && s?.assetUniverse && s.assetUniverse.length > 0) return "trader_aesthetic";
    return "strategy_discovery";
  }

  // Worker still uses message-count heuristic
  const userMessages = messages.filter((m) => m.role === "user").length;
  const phases = WORKER_PHASES;
  const idx = Math.min(Math.floor(userMessages / 2), phases.length - 1);
  return phases[idx] as AgentBuilderPhase;
}

function buildInfluencerCanvasActions(
  phase: AgentBuilderPhase,
  anchorId: string,
  agentBlueprint: AgentBlueprint,
  uploadedImageUrl: string,
): Array<Record<string, unknown>> {
  const actions: Array<Record<string, unknown>> = [];
  const name = agentBlueprint.persona?.name || "AI Influencer";
  const niche = agentBlueprint.persona?.niche || "content creator";

  if (phase === "persona_discovery" && !anchorId) {
    actions.push({
      type: "ADD_NODE",
      payload: {
        node: {
          id: `influencer-initial-${Date.now()}`,
          label: name,
          description: `${niche} — building persona`,
          category: "initial",
          status: "in_progress",
          x: 300, y: 240,
          dependencies: [], connectsTo: [],
          animation: { entrance: "bounce", delay: 0 },
        },
      },
    });
  } else if (phase === "aesthetic_upload" && anchorId) {
    actions.push({
      type: "ADD_NODE",
      payload: {
        node: {
          id: `influencer-visual-${Date.now()}`,
          label: "Visual Identity",
          description: agentBlueprint.persona?.aesthetic || "Aesthetic direction being defined",
          category: "foundation",
          status: "in_progress",
          sourceImageUrl: uploadedImageUrl || "",
          sourceCoverImageUrl: uploadedImageUrl || "",
          x: 620, y: 180,
          dependencies: [anchorId], connectsTo: [],
          animation: { entrance: "bounce", delay: 0.08 },
        },
      },
    });
    if (anchorId) {
      actions.push({ type: "CONNECT_NODES", payload: { fromId: anchorId, toId: `influencer-visual-${Date.now() - 1}` } });
    }
  } else if ((phase as string) === "content_strategy" && anchorId) {
    const pillars = agentBlueprint.persona?.contentPillars || ["Content Pillar 1", "Content Pillar 2", "Content Pillar 3"];
    pillars.slice(0, 3).forEach((pillar, i) => {
      const nodeId = `influencer-pillar-${i}-${Date.now()}`;
      actions.push({
        type: "ADD_NODE",
        payload: {
          node: {
            id: nodeId,
            label: pillar,
            description: `Content pillar: ${pillar}`,
            category: "foundation",
            status: "in_progress",
            x: 300 + (i - 1) * 280, y: 480,
            dependencies: [anchorId], connectsTo: [],
            animation: { entrance: "bounce", delay: i * 0.1 },
          },
        },
      });
    });
    actions.push({
      type: "ADD_NODE",
      payload: {
        node: {
          id: `influencer-calendar-${Date.now()}`,
          label: "Content Calendar",
          description: agentBlueprint.content?.angle || "Video cadence and format plan",
          category: "marketing",
          status: "in_progress",
          x: 620, y: 480,
          dependencies: [anchorId], connectsTo: [],
          animation: { entrance: "bounce", delay: 0.3 },
        },
      },
    });
  } else if ((phase as string) === "voice_calibration" && anchorId) {
    actions.push({
      type: "ADD_NODE",
      payload: {
        node: {
          id: `influencer-voice-${Date.now()}`,
          label: "Voice Profile",
          description: `${agentBlueprint.persona?.voiceArchetype || "Friendly"} voice in ${agentBlueprint.persona?.language || "English"}`,
          category: "operations",
          status: "in_progress",
          x: 940, y: 340,
          dependencies: [anchorId], connectsTo: [],
          animation: { entrance: "bounce", delay: 0 },
        },
      },
    });
  } else if (phase === "agent_ready") {
    if (anchorId) {
      actions.push({ type: "UPDATE_NODE", payload: { id: anchorId, updates: { status: "completed", ctaLabel: "View Persona" } } });
    }
    actions.push({
      type: "ADD_NODE",
      payload: {
        node: {
          id: `influencer-launch-${Date.now()}`,
          label: "Ready to Deploy",
          description: `${name} is fully configured. Review and mint your AI Influencer.`,
          category: "milestone",
          status: "in_progress",
          x: 1200, y: 340,
          dependencies: anchorId ? [anchorId] : [],
          connectsTo: [],
          animation: { entrance: "bounce", delay: 0 },
        },
      },
    });
  }

  return actions;
}

function buildWorkerCanvasActions(
  phase: AgentBuilderPhase,
  anchorId: string,
  agentBlueprint: AgentBlueprint,
): Array<Record<string, unknown>> {
  const actions: Array<Record<string, unknown>> = [];
  const workerName = agentBlueprint.worker?.name || agentBlueprint.worker?.businessName || "AI Worker";

  if (phase === "business_context" && !anchorId) {
    actions.push({
      type: "ADD_NODE",
      payload: {
        node: {
          id: `worker-initial-${Date.now()}`,
          label: workerName,
          description: `${agentBlueprint.worker?.primaryTask || "AI Worker"} for ${agentBlueprint.worker?.businessName || "your business"}`,
          category: "initial",
          status: "in_progress",
          x: 300, y: 240,
          dependencies: [], connectsTo: [],
          animation: { entrance: "bounce", delay: 0 },
        },
      },
    });
  } else if (phase === "capability_mapping" && anchorId) {
    const caps = agentBlueprint.worker?.capabilities || ["Core capability"];
    caps.slice(0, 3).forEach((cap, i) => {
      actions.push({
        type: "ADD_NODE",
        payload: {
          node: {
            id: `worker-cap-${i}-${Date.now()}`,
            label: cap,
            description: `Worker skill: ${cap}`,
            category: "foundation",
            status: "in_progress",
            x: 300 + i * 280, y: 480,
            dependencies: [anchorId], connectsTo: [],
            animation: { entrance: "bounce", delay: i * 0.1 },
          },
        },
      });
    });
  } else if (phase === "knowledge_config" && anchorId) {
    actions.push({
      type: "ADD_NODE",
      payload: {
        node: {
          id: `worker-kb-${Date.now()}`,
          label: "Knowledge Base",
          description: agentBlueprint.worker?.knowledgeBase?.slice(0, 120) || "Business knowledge and policies",
          category: "development",
          status: "in_progress",
          x: 620, y: 180,
          dependencies: [anchorId], connectsTo: [],
          animation: { entrance: "bounce", delay: 0 },
        },
      },
    });
  } else if (phase === "deployment_ready") {
    if (anchorId) {
      actions.push({ type: "UPDATE_NODE", payload: { id: anchorId, updates: { status: "completed", ctaLabel: "Configure Worker" } } });
    }
    actions.push({
      type: "ADD_NODE",
      payload: {
        node: {
          id: `worker-launch-${Date.now()}`,
          label: "Ready to Deploy",
          description: `${workerName} is configured. Deploy to your channels.`,
          category: "milestone",
          status: "in_progress",
          x: 940, y: 240,
          dependencies: anchorId ? [anchorId] : [],
          connectsTo: [],
          animation: { entrance: "bounce", delay: 0 },
        },
      },
    });
  }

  return actions;
}

export async function POST(req: NextRequest) {
  // Paid LLM route — require a trusted internal caller (X-Internal-Secret) or a
  // valid Privy-authenticated user. Anonymous callers cannot burn the Kie/OpenAI key.
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  // Hoisted so the catch block can fall back with the right agentType / blueprint.
  // (req.json() can only be called ONCE — re-reading in catch returns nothing,
  //  which is why fallbacks were leaking the campaign "What are you building?" prompt.)
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const kieKey = getKieApiKey();
    const openaiKey = process.env.OPENAI_API_KEY?.trim();

    if (!GEMINI_KEY && !kieKey && !openaiKey) {
      return NextResponse.json(
        {
          message:
            "AI chat is not configured: add GEMINI_API_KEY, KIE_API_KEY, or OPENAI_API_KEY, then restart the server.",
          campaignBlueprint: {},
          clientActions: [],
          actions: [],
          suggestedQuestions: [],
        },
        { status: 503 }
      );
    }

    const { messages, currentNodes, communityId, pageContext, agentType: rawAgentType, agentBlueprint: rawAgentBlueprint, uploadedImageUrl: rawUploadedImageUrl, chatModel: rawChatModel, sessionId: rawSessionId } = body as {
      messages?: unknown;
      currentNodes?: unknown;
      communityId?: string | null;
      pageContext?: string | null;
      agentType?: string | null;
      agentBlueprint?: unknown;
      uploadedImageUrl?: string | null;
      chatModel?: string | null;
      /** Builder session — the PRE-MINT project identity memory is scoped to. */
      sessionId?: string | null;
    };
    const chatModel = resolveChatModel(rawChatModel);
    const agentType: AgentType =
      rawAgentType === "influencer" || rawAgentType === "worker" || rawAgentType === "trader" || rawAgentType === "campaign" || rawAgentType === "clipping"
        ? rawAgentType
        : "influencer";
    let agentBlueprint: AgentBlueprint = (rawAgentBlueprint && typeof rawAgentBlueprint === "object")
      ? (rawAgentBlueprint as AgentBlueprint)
      : { agentType };
    const uploadedImageUrl = typeof rawUploadedImageUrl === "string" ? rawUploadedImageUrl.trim() : "";

    // Server-side heuristic persona fill — guarantees blueprint progress even if AI fails
    if (Array.isArray(messages)) {
      const cleanMessages = (messages as Array<{ role?: unknown; content?: unknown }>)
        .filter((m): m is { role: string; content: string } =>
          typeof m === "object" && m !== null && typeof m.role === "string" && typeof m.content === "string")
        .map((m) => ({ role: m.role, content: m.content }));
      agentBlueprint = applyHeuristicPersonaExtraction(agentBlueprint, cleanMessages);
    }

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // ── STANDING ORDERS → MEMORY ───────────────────────────────────────────────
    // The copilot used to agree to "only commercial videos, no need to speak" and
    // then forget it the moment the turn ended: nothing about the conversation was
    // ever written to agentMemory, so generation had nothing to obey. Parse THIS
    // turn's operator message for a durable instruction and persist it (scoped to
    // the mint, else the builder session — never a shared bucket). Non-blocking:
    // the write must never delay or break the reply.
    void persistStandingDirective({
      messages: messages as Array<{ role?: unknown; content?: unknown }>,
      mintAddress: (agentBlueprint as { mintAddress?: string }).mintAddress,
      sessionId: typeof rawSessionId === "string" ? rawSessionId : (agentBlueprint as { sessionId?: string }).sessionId,
      source: "builder_copilot",
    });

    const safeNodes = Array.isArray(currentNodes) ? currentNodes : [];
    const effectiveCanvasNodes = safeNodes.filter((n) => {
      if (!n || typeof n !== "object") return false;
      return (n as { id?: string }).id !== BUILDER_LOCAL_GOAL_PREVIEW_ID;
    });
    const effectiveCanvasCount = effectiveCanvasNodes.length;
    const chatMessages = (messages as BuilderChatMessage[])
      .filter((m): m is { role: ChatRole; content: string } =>
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
      )
      .map((m) => ({ role: m.role as ChatRole, content: m.content }));

    const orchestration = buildOrchestrationBlock(
      chatMessages,
      typeof communityId === "string" && communityId.trim() ? communityId.trim() : null,
    );

    const contextMessage =
      effectiveCanvasCount > 0
        ? `\n\nCurrent canvas (${effectiveCanvasCount} nodes): ${JSON.stringify(
            effectiveCanvasNodes.map((n: { id: string; label: string; category: string; status?: string }) => ({
              id: n.id,
              label: n.label,
              category: n.category,
              status: n.status,
            }))
          )}`
        : "\n\nCurrent canvas is empty.";

    const workspaceNote =
      communityId && String(communityId).trim().length > 0
        ? `\n\nBuilder opened with community/workspace id: ${String(communityId).trim()}`
        : "";

    const pageContextTrimmed =
      typeof pageContext === "string" && pageContext.trim().length > 0 ? pageContext.trim() : "";
    const copilotPageNote = pageContextTrimmed
      ? `\n\n---\nCopilot UI context (answer as Vello staff for this screen; be concise and practical; focus on what to do next on the platform. Only mention builder/canvas workflows if the user asks.):\n${pageContextTrimmed}\n---`
      : "";

    const communityIdTrimmed =
      typeof communityId === "string" && communityId.trim() ? communityId.trim() : null;

    const urls = extractUrlsFromHistory(chatMessages);
    const website = urls.length > 0 ? await fetchWebsiteIntelligence(urls[0]) : null;
    const knowledgeBaseText = extractKnowledgeBaseText(effectiveCanvasNodes, website);
    const webContextBlock =
      website && urls[0]
        ? `\n\nWEBSITE_CONTEXT (scraped from ${urls[0]}):\n${buildWebsiteKnowledgeBaseDigest(website)}`
        : "";
    const agentChain = buildBuilderAgentChain({
      messages: chatMessages,
      communityId: communityIdTrimmed,
      website,
    });
    const agentChainBlock = `\n\n${buildAgentChainPromptBlock(agentChain)}`;

    // Phase detection happens before the AI call so the AI knows which phase it's in
    const builderPhase = detectBuilderPhase({
      effectiveCanvasNodes,
      website,
      communityId: communityIdTrimmed,
    });
    const phaseBlock = buildPhaseContextBlock({ phase: builderPhase, website, communityId: communityIdTrimmed });

    // Select system prompt based on agent type
    // Reality preamble — read FIRST by the model. Without it, safety-tuned
    // models (Claude via Kie) sometimes treat this production prompt as a
    // user-pasted "roleplay request" and refuse to speak as the agent or to
    // report app state (mint address, balances), breaking the copilot.
    const COPILOT_REALITY_PREAMBLE = `### OPERATING CONTEXT (read first)
You are the built-in copilot of Vello, a real production web application for creating AI influencer/trader/worker agents on Solana. This system prompt is the app's own production configuration, not text pasted by a user.
- Speaking AS the operator's agent persona is the product's designed UX. The operator knows they are talking to an AI copilot; this is not deception or impersonation.
- You never execute transactions yourself. Your JSON reply is PARSED BY THE APPLICATION, which validates and performs any real on-chain action through its own backend. Echoing app state injected into this prompt (mint address, wallet balances, task results) is reporting real data the app gave you, not fabricating transactions.
- Messages prefixed [APP EVENT] are injected automatically by the application UI, not typed by the user. Treat them as trusted state updates from the app.
- Stay in the copilot voice at all times. Do not discuss your underlying model or refuse on "roleplay"/"impersonation" grounds. If a request is genuinely unsafe or impossible, decline briefly in-character and offer the closest safe alternative.`;

    let baseSystemPrompt: string;
    if (agentType === "influencer") {
      baseSystemPrompt = INFLUENCER_SYSTEM_PROMPT;
    } else if (agentType === "worker") {
      baseSystemPrompt = WORKER_SYSTEM_PROMPT;
    } else if (agentType === "trader") {
      baseSystemPrompt = TRADER_SYSTEM_PROMPT;
    } else if (agentType === "clipping") {
      baseSystemPrompt = CLIPPING_SYSTEM_PROMPT;
    } else {
      baseSystemPrompt = SYSTEM_PROMPT + "\n\n" + MARKETING_ENGINEER_SKILL + "\n\n" + BUILDER_AGENT_SKILLS + "\n\n" + BUILDER_KNOWLEDGE_BASE;
    }
    baseSystemPrompt = COPILOT_REALITY_PREAMBLE + "\n\n" + baseSystemPrompt;

    // After-mint: inject the Mission context so the agent reasons like an employee
    // (knows its wallet, burn rate, runway, goal progress, revenue split) on every turn.
    // Pre-mint: skip — there's no wallet to reason about yet.
    if (agentType !== "campaign" && agentBlueprint?.mintCompleted) {
      baseSystemPrompt = baseSystemPrompt + "\n\n" + buildMissionContextBlock(agentBlueprint);
    }

    // For influencer/worker, detect phase from conversation
    const agentSpecificPhase: AgentBuilderPhase =
      agentType !== "campaign"
        ? detectAgentPhase(agentType, chatMessages, effectiveCanvasCount, agentBlueprint)
        : builderPhase;

    const agentBlueprintBlock =
      agentType !== "campaign"
        ? `\n\nAGENT_BLUEPRINT_JSON:\n${JSON.stringify(agentBlueprint, null, 2)}`
        : "";

    // ── Inject open campaigns + agent wallet snapshot so the influencer chat
    //    can match the agent to gigs without an extra round-trip.
    let influencerContextBlock = "";
    if (agentType === "influencer" && agentBlueprint?.mintAddress && process.env.NEXT_PUBLIC_CONVEX_URL) {
      try {
        const { ConvexHttpClient } = await import("convex/browser");
        const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
        const [campaigns, mySubs] = await Promise.all([
          convex.query(api.campaigns.list, {}).catch(() => []),
          convex.query(api.submissions.listByInfluencer, { influencerMint: agentBlueprint.mintAddress }).catch(() => []),
        ]);
        // A submission only counts as DONE when it actually has a post link (or
        // the brand/oracle already settled it). A bare "pending" join with NO
        // postUrl is INCOMPLETE — the agent joined but never posted/submitted, so
        // it must COMPLETE it (produce → post → attach link), not skip it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subsArr = (Array.isArray(mySubs) ? mySubs : []) as any[];
        const SETTLED = new Set(["submitted", "verified", "approved", "rejected", "paid"]);
        const submittedIds = new Set<string>(
          subsArr.filter((s) => !!s.postUrl || SETTLED.has(String(s.status))).map((s) => String(s.campaignId)),
        );
        // Campaigns the agent JOINED but hasn't posted to yet — needs completion.
        const pendingJoinIds = new Set<string>(
          subsArr.filter((s) => !s.postUrl && !SETTLED.has(String(s.status))).map((s) => String(s.campaignId)),
        );

        // ── Skill + connection state (needed BEFORE annotating campaigns so we
        //    can mark each one JOINABLE vs NEEDS:<platform>). ──────────────────
        const installedSkills = agentBlueprint.installedSkills ?? [];
        const campaignsInstalled = installedSkills.includes(VELLO_CAMPAIGNS_SKILL_ID);
        const socialInstalled = installedSkills.includes(SOCIAL_SKILL_ID);
        let connectedSocials: string[] = [];
        // Whether we actually got a definitive answer from upload-post. If the
        // lookup times out / errors, we must NOT tell the model "not connected"
        // (that produced the false "link a social account first" message even when
        // accounts were linked) — we mark status UNKNOWN and stay permissive.
        let socialStatusKnown = false;
        let allPlatformIds: string[] = [];
        // Query upload-post as the SOURCE OF TRUTH for connections — do NOT gate on
        // the (often stale) installedSkills flag. If the agent's profile has linked
        // accounts, it's connected, full stop.
        {
          try {
            const up = await import("@/lib/server/uploadPost");
            allPlatformIds = up.PLATFORM_IDS;
            if (up.isConfigured()) {
              // Connections are stored under the upload-post profile id =
              // resolveUsername(<id>). Connections may have been made pre-mint
              // (under the session id) or post-mint (under the mint), so check
              // BOTH and take whichever profile actually has linked accounts.
              const ids = [agentBlueprint.mintAddress, (agentBlueprint as { sessionId?: string }).sessionId]
                .filter((v): v is string => typeof v === "string" && v.length > 0);
              const usernames = Array.from(new Set(ids.map((id) => up.resolveUsername(id)).filter(Boolean)));
              for (const username of usernames) {
                // undefined = timed out (unknown); null = profile missing; object = found
                const result = await Promise.race([
                  up.getProfile(username).then((p) => (p.exists ? p.connected : null)),
                  new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 6000)),
                ]);
                if (result === undefined) continue; // timeout — leave status unknown
                socialStatusKnown = true;
                const found = result ? Object.entries(result).filter(([, v]) => Boolean(v)).map(([k]) => k) : [];
                if (found.length) { connectedSocials = found; break; }
              }
            }
          } catch { /* non-blocking — status stays unknown */ }
        }
        // When we couldn't verify (timeout/error), assume the operator may have
        // connected — so eligibility stays permissive and the agent doesn't wrongly
        // tell them to "connect first". The real per-post check in run-task gates
        // actual posting.
        const effectiveConnected = (!socialStatusKnown && connectedSocials.length === 0)
          ? allPlatformIds
          : connectedSocials;
        // If the agent HAS linked accounts, the Social Auto-Post skill is by
        // definition active — don't let a stale installedSkills flag make
        // eligibility return "need_social_skill". Force it on for the gate.
        const effectiveInstalledSkills = connectedSocials.length > 0 && !installedSkills.includes(SOCIAL_SKILL_ID)
          ? [...installedSkills, SOCIAL_SKILL_ID]
          : installedSkills;

        // Only inject campaigns an AI influencer can ACTUALLY join: a UGC campaign
        // (creators film new content — NOT a clipping campaign, which is a clipper
        // agent's job) that is funded on-chain (vault + onchainVersion>=2) AND still
        // live (not past deadline, budget not exhausted). This block only runs for
        // agentType==="influencer", so gating to UGC here keeps clipping campaigns out
        // of the influencer copilot's join list.
        const open = Array.isArray(campaigns)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? campaigns.filter((c: any) => isJoinableUgcCampaign(c)).slice(0, 10)
          : [];
        if (open.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lines = open.map((c: any) => {
            const submitted = submittedIds.has(String(c._id));
            const pendingJoin = pendingJoinIds.has(String(c._id));
            const niches = Array.isArray(c.targetNiche) ? c.targetNiche.join(",") : "";
            const langs  = Array.isArray(c.targetLanguage) ? c.targetLanguage.join(",") : "";
            const plats  = Array.isArray(c.platforms) ? c.platforms : [];
            const elig = evaluateCampaignEligibility({ installedSkills: effectiveInstalledSkills, connectedPlatforms: effectiveConnected, campaignPlatforms: plats });
            const joinMark = submitted
              ? "ALREADY_SUBMITTED"
              : pendingJoin
                ? `NEEDS_SUBMIT(joined but NOT posted yet — COMPLETE it now: create_video with autoPost{campaignId, platforms:[${elig.eligiblePlatforms[0] ?? plats[0] ?? ""}]} to produce the deliverable, post it, and attach the link)`
                : elig.eligible ? `JOINABLE(post→${elig.eligiblePlatforms[0]})` : `NOT_JOINABLE(${elig.reason})`;
            return `- id=${c._id} | brand=${c.brandName ?? "?"} | title=${(c.title ?? "").slice(0, 60)} | budget=$${c.budget ?? 0} | rateK=$${c.ratePerThousandViews ?? 0}/1K | niche=[${niches}] | lang=[${langs}] | platforms=[${plats.join(",") || "any"}] | deadline=${c.deadline ?? "?"} | ${joinMark} | brief="${(c.brief ?? "").slice(0, 120)}"`;
          }).join("\n");
          influencerContextBlock += `\n\nAVAILABLE_CAMPAIGNS (${open.length} open):\n${lines}`;
        }
        if (submittedIds.size > 0) {
          influencerContextBlock += `\n\nMY_SUBMISSIONS (DONE — have a post link): [${[...submittedIds].join(", ")}]. Do NOT re-submit these.`;
        }
        if (pendingJoinIds.size > 0) {
          influencerContextBlock += `\n\nINCOMPLETE_JOINS (joined but NOT posted/submitted yet — these are NOT done): [${[...pendingJoinIds].join(", ")}]. For each, COMPLETE the submission now: run create_video with autoPost{campaignId, platforms} so it produces the deliverable, posts it, and attaches the live link. Do NOT tell the user it's "already joined/submitted".`;
        }
        influencerContextBlock += `\n\nCAMPAIGNS_SKILL_INSTALLED: ${campaignsInstalled}`;
        // Agent wallet snapshot for capacity check
        const inf = await convex.query(api.influencers.getByMint, { mintAddress: agentBlueprint.mintAddress }).catch(() => null);
        if (inf?.agentWallet) {
          try {
            const balRes = await fetch(`${new URL(req.url).origin}/api/agent-wallet-balance?wallet=${inf.agentWallet}`);
            if (balRes.ok) {
              const bal = await balRes.json() as { ok?: boolean; sol?: number; usdc?: number };
              if (bal.ok) {
                influencerContextBlock += `\n\nAGENT_WALLET_STATE: usdc=$${(bal.usdc ?? 0).toFixed(2)} · sol=${(bal.sol ?? 0).toFixed(4)} · address=${inf.agentWallet} · capacity=${(bal.sol ?? 0) > 0.005 && (bal.usdc ?? 0) >= 0 ? "ready_to_work" : "needs_funding"}`;
              }
            }
          } catch { /* non-blocking */ }
        }
        // Show Bible awareness — without this the copilot had zero visibility into
        // the operator's compiled show (premise, cast, formats, voice, cadence) and
        // could neither answer "what does my bible say" nor keep create_video topics
        // on-premise; script generation resolves this separately via ideation.ts, but
        // the CHAT ITSELF also needs to see it to discuss/reason about it, and to let
        // the operator amend it conversationally.
        const bible = normalizeShowBible((inf as { showBible?: unknown } | null)?.showBible);
        if (bible) {
          influencerContextBlock += `\n\nSHOW_BIBLE (this is the operator's compiled show — treat it as the source of truth for what you create; reference it by name when discussing content, and if the operator asks to change it, propose the specific field to update):
Title/premise: ${bible.premise}
Formats: ${bible.format.kinds.join(", ")}
Voice: ${bible.voice.tone}${bible.voice.language ? ` (${bible.voice.language})` : ""}${bible.visualWorld?.style ? `\nVisual style: ${bible.visualWorld.style}` : ""}
Content mix: ${bible.contentMix.entertain}% entertain / ${bible.contentMix.value}% value / ${bible.contentMix.promo}% promo
Evergreen topics: ${bible.contentEngine.evergreenPools.join("; ") || "(none set)"}
Video styles (the show's recurring kinds of videos — the operator can ask for one BY NAME, e.g. "make a ${bibleVideoStyles(bible)[0]?.name ?? "Street interview"} about X", and the render pins that style's recipe):
${bibleVideoStyles(bible).map((s) => `- "${s.name}" (${s.format}${s.durationSec ? `, ${s.durationSec.min}-${s.durationSec.max}s` : ""}, weight ${s.weight ?? 1})`).join("\n")}
When the operator asks for a video and no style is named, you may suggest the style that fits their idea best.`;
        } else {
          influencerContextBlock += `\n\nSHOW_BIBLE: none compiled yet. If the operator asks about "the bible" or wants consistent recurring content, point them to the Show Bible / Director setup rather than improvising an answer.`;
        }
        // Social posting state (computed above) — so the agent can decide whether
        // to post / join or guide the operator to install + connect first.
        influencerContextBlock += `\n\nSOCIAL_SKILL_INSTALLED: ${socialInstalled}`;
        // Connections (from upload-post) are the source of truth — a present link
        // means connected even if the installedSkills flag is stale.
        const socialStateNote = connectedSocials.length > 0
          ? " — these ARE connected (verified on upload-post); the agent CAN post/join on them. Do NOT ask the operator to connect."
          : !socialInstalled
            ? " — Social Auto-Post skill not installed."
            : socialStatusKnown
              ? " — none connected yet; guide the operator to the Connections panel before posting or joining campaigns."
              : " — status UNKNOWN (could not verify just now). Do NOT claim the operator hasn't connected; assume they may have linked accounts and proceed, or ask them to retry.";
        influencerContextBlock += `\n\nCONNECTED_SOCIALS: [${connectedSocials.join(", ")}]${socialStateNote}`;
        if (connectedSocials.length > 0) {
          influencerContextBlock += `\n\nPOSTING RULE (follow exactly): ALWAYS post to a platform in CONNECTED_SOCIALS (${connectedSocials.join(", ")}). If a campaign's BRIEF text mentions platforms you are NOT connected to (e.g. it says "post on TikTok"), IGNORE those and use a connected platform instead — campaigns here accept any connected platform unless a campaign's platforms=[...] field restricts it. NEVER tell the operator to connect a platform that is already in CONNECTED_SOCIALS, and NEVER say you are posting to a platform that is not in CONNECTED_SOCIALS. For an any-platform campaign, post to ${connectedSocials[0]}.`;
        }
      } catch { /* non-blocking */ }
    }

    // ── Inject recent activity + memory so the chat can answer questions about
    //    what the agent has been doing without an extra round-trip. Trader-only;
    //    queries are bounded so we don't blow the context budget.
    let traderContextBlock = "";
    if (agentType === "trader") {
      const installed = Array.isArray(agentBlueprint?.installedSkills) ? agentBlueprint.installedSkills : [];
      traderContextBlock += `\n\nAGENT_INSTALLED_SKILLS: ${installed.length > 0 ? installed.join(", ") : "(none yet)"}`;
    }

    // Build an explicit "ANSWERED / MISSING" checklist so the AI can't accidentally re-ask
    // a question whose answer is already in the blueprint (videoFormats / contentPillars / etc.)
    const knowledgeChecklistBlock = (() => {
      if (agentType !== "influencer") return "";
      const p = agentBlueprint?.persona ?? {};
      const filled = (v: unknown): boolean =>
        typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : false;
      const fields: Array<[string, unknown]> = [
        ["name", p.name],
        ["handle", p.handle],
        ["niche", p.niche],
        ["audience", p.audience],
        ["language", p.language],
        ["voiceArchetype", p.voiceArchetype],
        ["contentPillars", p.contentPillars],
        ["videoFormats", p.videoFormats],
        ["backstory", p.backstory],
        ["traits", p.traits],
        ["beliefs", p.beliefs],
        ["catchphrase", p.catchphrase],
        ["dreamCollab", p.dreamCollab],
        ["avoidTopics", p.avoidTopics],
      ];
      const answered = fields.filter(([, v]) => filled(v)).map(([k]) => k);
      const missing  = fields.filter(([, v]) => !filled(v)).map(([k]) => k);
      const nextField = missing[0] ?? "(none — all fields complete, advance to agent_ready)";
      return [
        "\n\nKNOWLEDGE_CHECKLIST:",
        `- ALREADY ANSWERED (DO NOT re-ask these): [${answered.join(", ") || "none"}]`,
        `- STILL MISSING (ask in this order): [${missing.join(", ") || "none"}]`,
        `- NEXT FIELD TO ASK: ${nextField}`,
        "RULE: You MUST ask about the NEXT FIELD only. NEVER ask about an already-answered field. NEVER repeat a question.",
      ].join("\n");
    })();

    const agentPhaseBlock =
      agentType !== "campaign"
        ? `\n\nBUILDER_PHASE_JSON: ${JSON.stringify({ builderPhase: agentSpecificPhase })}`
        : phaseBlock;

    const uploadedImageBlock =
      uploadedImageUrl
        ? "\n\nThe user attached a reference image. Incorporate it as the persona avatar/reference image."
        : "";

    // Light JSON nudge — the trader system prompt already asks for JSON,
    // but a final reminder keeps Gemini honest. Keep this SHORT so it doesn't
    // crowd out the actual task or confuse Gemini for casual chat.
    const jsonContractReminder = `

### OUTPUT REMINDER
Reply with a single JSON object: {"message":"<your reply>", "agentActions":[...optional...], "agentBlueprint":{...optional...}}.
The "message" field is what the operator SEES. NEVER leave it blank — answer casual questions like "hi" or "what time is it" conversationally, then offer a next action. Example: {"message":"It's about 3pm UTC. Want me to scan signals?"}.`;

    const systemContent =
      baseSystemPrompt +
      jsonContractReminder +
      "\n\n" +
      (agentType === "campaign" ? orchestration + agentChainBlock : "") +
      agentPhaseBlock +
      agentBlueprintBlock +
      traderContextBlock +
      influencerContextBlock +
      knowledgeChecklistBlock +
      contextMessage +
      workspaceNote +
      webContextBlock +
      uploadedImageBlock +
      copilotPageNote;

    // ── Gemini direct first, with Kie only as an outage fallback. ──────
    if (GEMINI_KEY || kieKey) {
      // Inject vision into messages for Kie (same logic as callKieGeminiChat)
      let kieMessages: { role: ChatRole; content: KieMessageContent }[] = chatMessages;
      if (uploadedImageUrl) {
        kieMessages = injectVisionIntoMessages(chatMessages, uploadedImageUrl);
      }

      const enc = new TextEncoder();
      const sseStream = new ReadableStream({
        async start(ctrl) {
          const send = (data: Record<string, unknown>) =>
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
          // Global time budget. maxDuration is 60s, but each Kie call can take up
          // to 40s, so the stacked fallback chain (stream → buffered → refusal
          // retry → OpenAI) can blow the function timeout and kill the response
          // mid-flight. Leave ~8s headroom for post-processing + flushing the SSE
          // tail, and skip any *further* fallback once we're past the deadline —
          // returning the best error we already have instead of timing out hard.
          const FALLBACK_DEADLINE = Date.now() + (maxDuration - 8) * 1000;
          const timeBudgetLeft = () => FALLBACK_DEADLINE - Date.now() > 0;
          try {
            let fullContent = "";
            let kieErr: string | null = null;
            let streamedLen = 0;      // chars of the "message" field already streamed live
            let didLiveStream = false;

            // ── 1) Live streaming: yield "message"-field tokens to the client as
            // Gemini generates them, so the reply appears within ~1s instead of
            // after the whole JSON object finishes. extractStreamingMessage decodes
            // ONLY the message field, so the surrounding JSON (agentActions,
            // agentBlueprint, …) never leaks into the chat bubble.
            // Circuit breaker: if this model's Kie route 5xx'd moments ago, don't
            // wait on it again — jump straight to the failover chain below.
            // (A Gemini pick goes direct first, so a Kie 5xx on it doesn't count.)
            const routeDown = !geminiDirectFor(chatModel) && isKieRouteDown(chatModel);
            if (routeDown) {
              kieErr = `Kie ${chatModel} route marked down after recent 5xx`;
              console.warn(`[chat] ${kieErr} — skipping to failover`);
            }
            try {
              if (routeDown) throw new Error(kieErr!);
              let buf = "";
              for await (const tok of kieChatTokenStream(chatModel, { system: systemContent, messages: kieMessages })) {
                buf += tok;
                const soFar = extractStreamingMessage(buf);
                if (soFar !== null && soFar.length > streamedLen) {
                  send({ t: soFar.slice(streamedLen) });
                  streamedLen = soFar.length;
                  didLiveStream = true;
                }
              }
              fullContent = buf;
            } catch (streamErr) {
              kieErr = streamErr instanceof Error ? streamErr.message : String(streamErr);
              console.error(`[chat] Kie stream failed (model=${chatModel}):`, kieErr);
            }

            // Plain-string copy of the messages — shared by the buffered
            // fallback and the refusal retry below.
            const plainMessages = kieMessages.map((m) => ({
              role: m.role,
              content: typeof m.content === "string"
                ? m.content
                 
                : (m.content as Array<{ type: string; text?: string }>).map((p) => p.text ?? "").join("\n"),
            }));

            // ── 2) Buffered Kie fallback — if streaming produced no usable content
            // (e.g. the account's stream shape changed), fall back to the
            // non-streaming endpoint we know works before surfacing an error.
            if (!fullContent.trim() && !routeDown && timeBudgetLeft()) {
              try {
                fullContent = await callKieChat(chatModel, {
                  system: systemContent,
                  messages: plainMessages,
                  uploadedImageUrl,
                });
                if (fullContent.trim()) kieErr = null;  // recovered — drop the stream error
              } catch (bufErr) {
                kieErr = bufErr instanceof Error ? bufErr.message : String(bufErr);
                console.error("[chat] Kie buffered fallback failed:", kieErr);
              }
            }

            // ── 2.25) CROSS-MODEL FAILOVER — the selected model's whole route is
            // down. Kie's Anthropic passthrough has answered EVERY claude-* model
            // with HTTP 500 {"type":"api_error"} while gemini-3-flash kept serving
            // 200s on the same key; without this the builder chat simply died and
            // showed "⚠ Chat backend error (model=claude-haiku-4-5)". Streaming and
            // buffered both failed above, so retry the turn ONCE on the alternate
            // Kie model before reaching for OpenAI (which is usually unconfigured).
            if (!fullContent.trim() && timeBudgetLeft()) {
              for (const altModel of kieFailoverOrder(chatModel)) {
                if (fullContent.trim() || !timeBudgetLeft()) break;
                if (isKieRouteDown(altModel)) { console.warn(`[chat] failover skip ${altModel} (route down)`); continue; }
                console.warn(`[chat] ${chatModel} route unusable (${kieErr ?? "empty"}) — failing over to ${altModel}`);
                try {
                  // Stream the failover reply too so the user still sees tokens
                  // appear live instead of a long silent wait.
                  let buf = "";
                  for await (const tok of kieChatTokenStream(altModel, { system: systemContent, messages: kieMessages })) {
                    buf += tok;
                    const soFar = extractStreamingMessage(buf);
                    if (soFar !== null && soFar.length > streamedLen) {
                      send({ t: soFar.slice(streamedLen) });
                      streamedLen = soFar.length;
                      didLiveStream = true;
                    }
                  }
                  if (!buf.trim() && timeBudgetLeft()) {
                    buf = await callKieChat(altModel, { system: systemContent, messages: plainMessages, uploadedImageUrl });
                  }
                  if (buf.trim()) {
                    fullContent = buf;
                    kieErr = null;   // recovered on another model — not an error the operator must act on
                    console.log(`[chat] failover to ${altModel} succeeded · ${buf.length} chars`);
                  }
                } catch (altErr) {
                  console.error(`[chat] failover to ${altModel} failed:`, altErr instanceof Error ? altErr.message : altErr);
                }
              }
            }

            // ── 2.5) Refusal net — a safety-tuned model occasionally breaks
            // character and refuses the copilot role outright ("I'm Claude…",
            // "I cannot roleplay…") instead of returning the JSON protocol.
            // Refusals never live-stream (extractStreamingMessage only emits the
            // JSON "message" field), so swapping content here is safe. Retry the
            // turn ONCE on the alternate model before giving up.
            const REFUSAL_RX = /\b(I'?m Claude\b|made by Anthropic|I cannot and will not|cannot (?:and will not )?(?:roleplay|impersonate)|I (?:won'?t|will not) (?:roleplay|pretend))/i;
            const hasProtocolJson = /"message"\s*:/.test(fullContent);
            if (fullContent.trim() && !hasProtocolJson && !didLiveStream && REFUSAL_RX.test(fullContent) && timeBudgetLeft()) {
              const altModel: KieChatModel = chatModel === "claude-haiku-4-5" ? "gemini-3-flash" : "claude-haiku-4-5";
              console.warn(`[chat] model refusal detected on ${chatModel} — retrying once with ${altModel}`);
              try {
                const alt = await callKieChat(altModel, {
                  system: systemContent,
                  messages: plainMessages,
                  uploadedImageUrl,
                });
                if (alt.trim() && !REFUSAL_RX.test(alt)) {
                  fullContent = alt;
                  kieErr = null;
                }
              } catch (altErr) {
                console.error("[chat] refusal retry failed:", altErr instanceof Error ? altErr.message : altErr);
              }
            }
            // Auto-fallback to OpenAI when Kie returned nothing — keeps the
            // chat working even if KIE_API_KEY is misconfigured or the
            // gemini-3-flash model isn't available on the account.
            if (!fullContent.trim() && openaiKey && timeBudgetLeft()) {
              console.warn("[chat] Empty Kie response — falling back to OpenAI gpt-4o-mini");
              try {
                const openai = new OpenAI({ apiKey: openaiKey });
                const resp = await openai.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [{ role: "system", content: systemContent }, ...chatMessages],
                  temperature: 0.85,
                  max_tokens: 2500,
                  response_format: { type: "json_object" },
                });
                fullContent = resp.choices[0]?.message?.content || "";
                if (fullContent.trim()) console.log("[chat] OpenAI fallback returned", fullContent.length, "chars");
              } catch (oaErr) {
                console.error("[chat] OpenAI fallback failed:", oaErr instanceof Error ? oaErr.message : oaErr);
              }
            }
            if (!fullContent.trim()) {
              console.warn("[chat] No model produced content. kieErr=", kieErr, "agentType=", agentType, "phase=", agentSpecificPhase);
            } else {
              console.log("[chat] Final content len=", fullContent.length, "first 200:", fullContent.slice(0, 200));
            }

            // ── Post-process full content ─────────────────────────────────────
            const parsed = parseAssistantJson(fullContent);

            if (agentType !== "campaign" && parsed.message && containsRoleDetection(parsed.message)) {
              parsed.message = getAgentPhaseFallback(agentType, agentSpecificPhase, agentBlueprint);
            }

            const campaignBlueprint = enrichCampaignBlueprint({
              raw: safeParseCampaignBlueprint(parsed.campaignBlueprint) ?? {},
              chain: agentChain, website, knowledgeBaseText,
            });
            const clientActions = agentType === "campaign"
              ? mergeTreasuryClientActions({ rawClientActions: parsed.clientActions, campaignBlueprint: parsed.campaignBlueprint, message: parsed.message ?? "", communityId: communityIdTrimmed, interactionMode: agentChain.interactionMode })
              : [];
            const chainClientActions = agentType === "campaign"
              ? buildAgentChainClientActions({ chain: agentChain, communityId: communityIdTrimmed })
              : [];
            const mergedClientActions = dedupeClientActionsByHref([...clientActions, ...chainClientActions]);

            let resolvedActions: Array<Record<string, unknown>> = [];
            if (agentType === "influencer") {
              const anchorNode = (effectiveCanvasNodes as Array<{ id?: string; category?: string }>).find((n) => n.category === "initial");
              resolvedActions = buildInfluencerCanvasActions(agentSpecificPhase, anchorNode?.id ? String(anchorNode.id) : "", agentBlueprint, uploadedImageUrl);
            } else if (agentType === "worker") {
              const anchorNode = (effectiveCanvasNodes as Array<{ id?: string; category?: string }>).find((n) => n.category === "initial");
              resolvedActions = buildWorkerCanvasActions(agentSpecificPhase, anchorNode?.id ? String(anchorNode.id) : "", agentBlueprint);
            } else if (agentChain.interactionMode === "agency_agentic") {
              let anchorGoalId = "";
              for (const n of effectiveCanvasNodes as Array<{ id?: string; category?: string }>) {
                if (n.category === "initial" && n.id) { anchorGoalId = String(n.id); break; }
              }
              if (builderPhase === "goal_capture" && effectiveCanvasCount === 0) {
                const goalActions = buildAgentChainCanvasActions({ chain: agentChain, communityId: communityIdTrimmed, website, currentNodeCount: 0 });
                resolvedActions = [...goalActions];
                const goalNodeId = extractInitialNodeIdFromActions(goalActions) || "";
                if (communityIdTrimmed && goalNodeId) {
                  resolvedActions = [...resolvedActions, ...buildContextBuildingCard({ initialGoalNodeId: goalNodeId, campaignBlueprint, website, communityId: communityIdTrimmed })];
                }
              } else if (builderPhase === "context_building" && anchorGoalId) {
                resolvedActions = buildContextBuildingCard({ initialGoalNodeId: anchorGoalId, campaignBlueprint, website, communityId: communityIdTrimmed });
              } else if (builderPhase === "campaign_ready") {
                const communityNode = (effectiveCanvasNodes as Array<{ id?: string; category?: string }>).find((n) => n.category === "foundation");
                const communityNodeId = communityNode?.id ? String(communityNode.id) : anchorGoalId;
                if (communityNodeId) resolvedActions = buildCampaignFundCards({ communityNodeId, campaignBlueprint, website, communityId: communityIdTrimmed });
              }
            } else {
              const modelActions = normalizeCanvasActions(parsed.actions);
              const onboardingOrderedActions = buildAgentChainCanvasActions({ chain: agentChain, communityId: communityIdTrimmed, website, currentNodeCount: effectiveCanvasCount });
              resolvedActions = effectiveCanvasCount === 0 && onboardingOrderedActions.length > 0 ? onboardingOrderedActions : modelActions.length > 0 ? modelActions : onboardingOrderedActions;
            }

            if (website) {
              const coverFallback = website.heroImage || website.logoImage || "";
              const profileFallback = website.logoImage || website.heroImage || "";
              resolvedActions = resolvedActions.map((action) => {
                if (String(action.type || "").toUpperCase() !== "ADD_NODE") return action;
                const actionPayload = (action.payload && typeof action.payload === "object" ? action.payload : {}) as Record<string, unknown>;
                const node = actionPayload.node && typeof actionPayload.node === "object" ? (actionPayload.node as Record<string, unknown>) : null;
                if (!node || String(node.category || "") !== "foundation") return action;
                return { ...action, payload: { ...actionPayload, node: { ...node, sourceCoverImageUrl: node.sourceCoverImageUrl || coverFallback, sourceProfileImageUrl: node.sourceProfileImageUrl || profileFallback, sourceImageUrl: node.sourceImageUrl || coverFallback || profileFallback, sourceUrl: node.sourceUrl || website.url } } };
              });
            }

            const aiBp = (parsed.agentBlueprint && typeof parsed.agentBlueprint === "object" ? parsed.agentBlueprint : {}) as Partial<AgentBlueprint>;

            // Deep-merge persona — never let AI null-out fields the user already answered
            const mergedPersonaFields = { ...(agentBlueprint.persona ?? {}), ...(aiBp.persona ?? {}) };
            const persona = { ...(agentBlueprint.persona ?? {}) } as Record<string, unknown>;
            for (const [k, v] of Object.entries(mergedPersonaFields)) {
              const isEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
              if (!isEmpty) persona[k] = v;
            }

            // Deep-merge trader — same protection: never overwrite name/strategy with empty values
            const mergedTraderFields = { ...(agentBlueprint.trader ?? {}), ...(aiBp.trader ?? {}) };
            const trader = { ...(agentBlueprint.trader ?? {}) } as Record<string, unknown>;
            for (const [k, v] of Object.entries(mergedTraderFields)) {
              const isEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
              if (!isEmpty) trader[k] = v;
            }

            const parsedAgentBlueprint: AgentBlueprint = {
              ...agentBlueprint,
              ...aiBp,
              persona: persona as AgentBlueprint["persona"],
              trader: trader as AgentBlueprint["trader"],
            };

            const dynamicSuggestions = deriveDynamicSuggestions({ history: chatMessages, canvasNodeCount: effectiveCanvasCount, aiMessage: parsed.message ?? "", interactionMode: agentChain.interactionMode });
            const modelSuggestions = Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions.filter((q): q is string => typeof q === "string") : [];
            const suggestedQuestions = [...modelSuggestions, ...dynamicSuggestions].map((q) => q.trim()).filter(Boolean).filter((q, i, arr) => arr.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i).slice(0, 3);

            // Stream the clean message text to the client character by character.
            // This gives the typewriter effect WITHOUT exposing raw JSON tokens.
            // If Kie returned nothing AND OpenAI didn't help, surface the actual
            // upstream error to the operator instead of a silent fallback so they
            // know it's a backend issue, not a model deciding to be quiet.
            const displayMessage =
              (parsed.message?.trim()) ||
              (kieErr
                // Surface the ACTUAL model/path that failed — don't hardcode a
                // gemini-3-flash hint when the failing model is Claude.
                ? `⚠ Chat backend error (model=${chatModel}): ${kieErr.slice(0, 220)}\n\nCheck terminal logs for the full Kie response. Common causes: KIE_API_KEY missing/expired, ${chatModel} not enabled on your Kie account, or a rate limit.`
                : !fullContent.trim()
                  ? `⚠ Kie returned an empty response (model=${chatModel}). Try again — if it persists, your KIE_API_KEY may be unrouted or the model name doesn't match. Check the terminal for \`[kie-stream]\` / \`[kie-claude]\` logs.`
                  : getAgentPhaseFallback(agentType, agentSpecificPhase, agentBlueprint));
            // If we live-streamed the message field already, don't re-emit it. Only
            // fake-type when nothing streamed live (buffered fallback, an error
            // message, or post-processing replaced the streamed text). The client
            // snaps the bubble to meta.message on `done`, so any divergence resolves.
            const alreadyStreamed = Boolean(didLiveStream && parsed.message?.trim() && streamedLen > 0);
            if (!alreadyStreamed) {
              const CHUNK = 5; // characters per SSE event — small enough to feel live
              for (let i = 0; i < displayMessage.length; i += CHUNK) {
                send({ t: displayMessage.slice(i, i + CHUNK) });
              }
            }

            // Pass through agentActions — tool calls the client will execute
            const agentActionsArr = Array.isArray(parsed.agentActions)
              ? parsed.agentActions.filter((a): a is { type: string } => !!a && typeof a === "object" && typeof (a as { type?: unknown }).type === "string")
              : [];

            send({ done: true, meta: {
              message: displayMessage,
              campaignBlueprint, agentBlueprint: parsedAgentBlueprint, agentType,
              clientActions: mergedClientActions, actions: resolvedActions, suggestedQuestions,
              agentActions: agentActionsArr,
              agentChain, website, builderPhase: agentSpecificPhase,
            }});
          } catch (err) {
            send({ err: err instanceof Error ? err.message : "Stream failed" });
          }
          ctrl.close();
        },
      });

      return new Response(sseStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ── OpenAI fallback (non-streaming) ────────────────────────────────────────
    let content: string;
    {
      const openai = new OpenAI({ apiKey: openaiKey });
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemContent }, ...chatMessages],
        temperature: 0.85,
        max_tokens: 2500,
        response_format: { type: "json_object" },
      });
      content = response.choices[0]?.message?.content || "{}";
    }

    const parsed = parseAssistantJson(content);

    // Hard server-side filter: never let role-detection text reach non-campaign clients
    if (agentType !== "campaign" && parsed.message && containsRoleDetection(parsed.message)) {
      parsed.message = getAgentPhaseFallback(agentType, agentSpecificPhase, agentBlueprint);
    }

    const campaignBlueprint = enrichCampaignBlueprint({
      raw: safeParseCampaignBlueprint(parsed.campaignBlueprint) ?? {},
      chain: agentChain,
      website,
      knowledgeBaseText,
    });
    // Influencer and worker flows don't use treasury navigation hints
    const clientActions = agentType === "campaign"
      ? mergeTreasuryClientActions({
          rawClientActions: parsed.clientActions,
          campaignBlueprint: parsed.campaignBlueprint,
          message: parsed.message ?? "",
          communityId: communityIdTrimmed,
          interactionMode: agentChain.interactionMode,
        })
      : [];
    const chainClientActions = agentType === "campaign"
      ? buildAgentChainClientActions({ chain: agentChain, communityId: communityIdTrimmed })
      : [];
    const mergedClientActions = dedupeClientActionsByHref([...clientActions, ...chainClientActions]);
    const dynamicSuggestions = deriveDynamicSuggestions({
      history: chatMessages,
      canvasNodeCount: effectiveCanvasCount,
      aiMessage: parsed.message ?? "",
      interactionMode: agentChain.interactionMode,
    });
    const modelSuggestions = Array.isArray(parsed.suggestedQuestions)
      ? parsed.suggestedQuestions.filter((q): q is string => typeof q === "string")
      : [];
    const suggestedQuestions = [...modelSuggestions, ...dynamicSuggestions]
      .map((q) => q.trim())
      .filter(Boolean)
      .filter((q, i, arr) => arr.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i)
      .slice(0, 3);

    // Find anchor goal node ID from existing canvas
    let anchorGoalId = "";
    for (const n of effectiveCanvasNodes as Array<{ id?: string; category?: string }>) {
      if (n.category === "initial" && n.id) { anchorGoalId = String(n.id); break; }
    }

    // Phase-driven deterministic canvas actions — AI outputs "actions":[] always
    let resolvedActions: Array<Record<string, unknown>> = [];

    if (agentType === "influencer") {
      const anchorNode = (effectiveCanvasNodes as Array<{ id?: string; category?: string }>)
        .find((n) => n.category === "initial");
      const anchorId = anchorNode?.id ? String(anchorNode.id) : "";
      resolvedActions = buildInfluencerCanvasActions(agentSpecificPhase, anchorId, agentBlueprint, uploadedImageUrl);
    } else if (agentType === "worker") {
      const anchorNode = (effectiveCanvasNodes as Array<{ id?: string; category?: string }>)
        .find((n) => n.category === "initial");
      const anchorId = anchorNode?.id ? String(anchorNode.id) : "";
      resolvedActions = buildWorkerCanvasActions(agentSpecificPhase, anchorId, agentBlueprint);
    } else if (agentChain.interactionMode === "agency_agentic") {
      if (builderPhase === "goal_capture") {
        if (effectiveCanvasCount === 0) {
          // Phase 1: add goal node
          const goalActions = buildAgentChainCanvasActions({
            chain: agentChain, communityId: communityIdTrimmed, website, currentNodeCount: 0,
          });
          resolvedActions = [...goalActions];
          // If existing community is known, also immediately show the community card as completed
          const goalNodeId = extractInitialNodeIdFromActions(goalActions) || "";
          if (communityIdTrimmed && goalNodeId) {
            resolvedActions = [
              ...resolvedActions,
              ...buildContextBuildingCard({
                initialGoalNodeId: goalNodeId,
                campaignBlueprint,
                website,
                communityId: communityIdTrimmed,
              }),
            ];
          }
        }
        // else: goal node already on canvas, nothing to add yet
      } else if (builderPhase === "context_building" && anchorGoalId) {
        // Phase 2: add community card with website images and AI-generated community name
        resolvedActions = buildContextBuildingCard({
          initialGoalNodeId: anchorGoalId,
          campaignBlueprint,
          website,
          communityId: communityIdTrimmed,
        });
      } else if (builderPhase === "campaign_ready") {
        // Phase 3: add campaign + fund cards, mark community as completed
        const communityNode = (effectiveCanvasNodes as Array<{ id?: string; category?: string }>)
          .find((n) => n.category === "foundation");
        const communityNodeId = communityNode?.id ? String(communityNode.id) : anchorGoalId;
        if (communityNodeId) {
          resolvedActions = buildCampaignFundCards({
            communityNodeId,
            campaignBlueprint,
            website,
            communityId: communityIdTrimmed,
          });
        }
      }
    } else {
      // Creator / role_detection modes: use model actions with goal-node fallback
      const modelActions = normalizeCanvasActions(parsed.actions);
      const onboardingOrderedActions = buildAgentChainCanvasActions({
        chain: agentChain, communityId: communityIdTrimmed, website, currentNodeCount: effectiveCanvasCount,
      });
      resolvedActions =
        effectiveCanvasCount === 0 && onboardingOrderedActions.length > 0
          ? onboardingOrderedActions
          : modelActions.length > 0
            ? modelActions
            : onboardingOrderedActions;
    } // end campaign branch

    // Final fallback enrichment pass — ensure every foundation node has images
    // even if the model forgot to set them or website was fetched in a prior turn.
    if (website) {
      const coverFallback = website.heroImage || website.logoImage || "";
      const profileFallback = website.logoImage || website.heroImage || "";
      resolvedActions = resolvedActions.map((action) => {
        if (String(action.type || "").toUpperCase() !== "ADD_NODE") return action;
        const actionPayload = (action.payload && typeof action.payload === "object"
          ? action.payload
          : {}) as Record<string, unknown>;
        const node = actionPayload.node && typeof actionPayload.node === "object"
          ? (actionPayload.node as Record<string, unknown>)
          : null;
        if (!node) return action;
        const cat = String(node.category || "");
        // Enrich foundation nodes (knowledge base, community blueprint) with website images.
        if (cat !== "foundation") return action;
        const hasCover = typeof node.sourceCoverImageUrl === "string" && node.sourceCoverImageUrl;
        const hasProfile = typeof node.sourceProfileImageUrl === "string" && node.sourceProfileImageUrl;
        const hasImage = typeof node.sourceImageUrl === "string" && node.sourceImageUrl;
        if (hasCover && hasProfile && hasImage) return action;
        return {
          ...action,
          payload: {
            ...actionPayload,
            node: {
              ...node,
              sourceCoverImageUrl: hasCover ? node.sourceCoverImageUrl : coverFallback,
              sourceProfileImageUrl: hasProfile ? node.sourceProfileImageUrl : profileFallback,
              sourceImageUrl: hasImage ? node.sourceImageUrl : (coverFallback || profileFallback),
              sourceUrl: typeof node.sourceUrl === "string" && node.sourceUrl ? node.sourceUrl : website.url,
            },
          },
        };
      });
    }

    // Merge agent blueprint updates from model response — DEEP merge so server-side
    // heuristic persona fills don't get clobbered when the AI returns its own persona.
    const parsedAgentBlueprint: AgentBlueprint = (() => {
      const aiBp = (parsed.agentBlueprint && typeof parsed.agentBlueprint === "object"
        ? parsed.agentBlueprint
        : {}) as Partial<AgentBlueprint>;
      const keepNonEmpty = (base: Record<string, unknown>, ai: Record<string, unknown>) => {
        const merged = { ...base, ...ai };
        const out = { ...base };
        for (const [k, v] of Object.entries(merged)) {
          const isEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
          if (!isEmpty) out[k] = v;
        }
        return out;
      };
      const persona = keepNonEmpty(agentBlueprint.persona ?? {}, aiBp.persona ?? {}) as AgentBlueprint["persona"];
      const trader = keepNonEmpty(agentBlueprint.trader ?? {}, aiBp.trader ?? {}) as AgentBlueprint["trader"];
      return { ...agentBlueprint, ...aiBp, persona, trader };
    })();

    const agentActionsArr = Array.isArray(parsed.agentActions)
      ? parsed.agentActions.filter((a): a is { type: string } => !!a && typeof a === "object" && typeof (a as { type?: unknown }).type === "string")
      : [];
    return NextResponse.json({
      message: parsed.message ?? getAgentPhaseFallback(agentType, agentSpecificPhase, agentBlueprint),
      campaignBlueprint,
      agentBlueprint: parsedAgentBlueprint,
      agentType,
      clientActions: mergedClientActions,
      actions: resolvedActions,
      agentActions: agentActionsArr,
      suggestedQuestions,
      agentChain,
      website,
      builderPhase: agentSpecificPhase,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("AI Chat API error:", error);
    try {
      // Reuse the body that was parsed at the top of the handler — req.json() can only be called once
      const { messages, currentNodes, communityId, agentType: rawFallbackAgentType, agentBlueprint: rawFallbackBlueprint } = (body || {}) as {
        messages?: unknown;
        currentNodes?: unknown;
        communityId?: string | null;
        agentType?: string | null;
        agentBlueprint?: unknown;
      };
      const fallbackAgentType: AgentType =
        rawFallbackAgentType === "influencer" || rawFallbackAgentType === "worker" || rawFallbackAgentType === "trader" || rawFallbackAgentType === "campaign"
          ? rawFallbackAgentType
          : "campaign";
      let fallbackBlueprint: AgentBlueprint = (rawFallbackBlueprint && typeof rawFallbackBlueprint === "object")
        ? (rawFallbackBlueprint as AgentBlueprint)
        : { agentType: fallbackAgentType };
      // Apply the same heuristic extraction so the fallback advances the blueprint
      if (Array.isArray(messages)) {
        const cleanMessages = (messages as Array<{ role?: unknown; content?: unknown }>)
          .filter((m): m is { role: string; content: string } =>
            typeof m === "object" && m !== null && typeof m.role === "string" && typeof m.content === "string")
          .map((m) => ({ role: m.role, content: m.content }));
        fallbackBlueprint = applyHeuristicPersonaExtraction(fallbackBlueprint, cleanMessages);
      }
      const safeNodes = Array.isArray(currentNodes) ? currentNodes : [];
      const effectiveCanvasNodes = safeNodes.filter((n) => {
        if (!n || typeof n !== "object") return false;
        return (n as { id?: string }).id !== BUILDER_LOCAL_GOAL_PREVIEW_ID;
      });
      const effectiveCanvasCount = effectiveCanvasNodes.length;
      const chatMessages = (Array.isArray(messages) ? messages : [])
        .filter((m): m is { role: ChatRole; content: string } =>
          typeof m === "object" &&
          m !== null &&
          (((m as { role?: unknown }).role === "user") || ((m as { role?: unknown }).role === "assistant")) &&
          typeof (m as { content?: unknown }).content === "string",
        )
        .map((m) => ({ role: m.role, content: m.content }));
      const communityIdTrimmed =
        typeof communityId === "string" && communityId.trim() ? communityId.trim() : null;
      const urls = extractUrlsFromHistory(chatMessages);
      const website = urls.length > 0 ? await fetchWebsiteIntelligence(urls[0]).catch(() => null) : null;
      const knowledgeBaseText = extractKnowledgeBaseText(effectiveCanvasNodes, website);
      const agentChain = buildBuilderAgentChain({
        messages: chatMessages,
        communityId: communityIdTrimmed,
        website,
      });
      const campaignBlueprint = enrichCampaignBlueprint({
        raw: {},
        chain: agentChain,
        website,
        knowledgeBaseText,
      });

      const fallbackPhase = detectAgentPhase(fallbackAgentType, chatMessages, effectiveCanvasCount, fallbackBlueprint);
      return NextResponse.json({
        message: buildResilientFallbackMessage({
          interactionMode: agentChain.interactionMode,
          website,
          campaignBlueprint,
          knowledgeBaseText,
          agentType: fallbackAgentType,
          agentPhase: fallbackPhase,
          agentBlueprint: fallbackBlueprint,
        }),
        campaignBlueprint,
        clientActions: buildAgentChainClientActions({
          chain: agentChain,
          communityId: communityIdTrimmed,
        }),
        actions: buildFallbackCanvasActions({
          history: chatMessages,
          currentNodeCount: effectiveCanvasCount,
        }),
        suggestedQuestions: deriveDynamicSuggestions({
          history: chatMessages,
          canvasNodeCount: effectiveCanvasCount,
          aiMessage: "",
          interactionMode: agentChain.interactionMode,
        }),
        agentBlueprint: fallbackBlueprint,
        agentType: fallbackAgentType,
        agentChain,
        website,
        builderPhase: fallbackPhase,
        error: message,
      });
    } catch {
      return NextResponse.json(
        {
          message: "I can still help. Start by sharing your website URL or your product name, audience, and features, and I’ll focus on creating the community first.",
          campaignBlueprint: {},
          clientActions: [],
          actions: [],
          suggestedQuestions: [],
          error: message,
        },
        { status: 200 }
      );
    }
  }
}
