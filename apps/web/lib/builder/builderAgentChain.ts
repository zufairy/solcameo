import type { ClientAction } from "@/lib/builder/campaignBlueprint";
import type { WebsiteIntelligence } from "@/lib/builder/websiteIntelligence";

type ChatRole = "user" | "assistant";

export type BuilderInteractionMode =
  | "creator_answering"
  | "agency_agentic"
  | "role_detection";

type BuilderAgent = {
  id: string;
  label: string;
  mission: string;
  findings: string[];
  nextMove: string;
};

export type BuilderAgentChain = {
  inferredRole: "brand" | "creator" | "ambiguous";
  interactionMode: BuilderInteractionMode;
  roleRoutingReason: string;
  isWeb3Native: boolean;
  goal: string;
  priorities: string[];
  recommendedProductType: string;
  wantsCommunity: boolean;
  wantsProducts: boolean;
  wantsFunding: boolean;
  prefersOnchain: boolean;
  agents: BuilderAgent[];
};

function inferRole(transcript: string): "brand" | "creator" | "ambiguous" {
  const creator =
    /\b(creator|ugc|clipper|influencer|content creator|how do i clip|how to clip|how do i create|submit content|get approved|creator payouts?)\b/i.test(
      transcript,
    );
  const brand =
    /\b(brand|company|startup|community|product|campaign|sell|launch|agency|client|protocol|dao|token|nft|web3|crypto|defi|blockchain|build|create|bounty|reward|fund|hire|operator|workspace|setup|agentic)\b/i.test(
      transcript,
    );
  if (brand && !creator) return "brand";
  if (creator && !brand) return "creator";
  // If ambiguous but contains strong build/launch signals, treat as brand
  if (/\b(build|create|launch|setup|campaign|bounty|fund|workspace)\b/i.test(transcript)) return "brand";
  return "ambiguous";
}

function detectInteractionMode(params: {
  inferredRole: "brand" | "creator" | "ambiguous";
  transcript: string;
  communityId: string | null;
}): {
  interactionMode: BuilderInteractionMode;
  roleRoutingReason: string;
  isWeb3Native: boolean;
} {
  const isWeb3Native =
    /\b(web3|crypto|token|solana|dao|nft|defi|on-chain|onchain|phantom|wallet|treasury)\b/i.test(
      params.transcript,
    );

  if (params.inferredRole === "creator") {
    return {
      interactionMode: "creator_answering",
      roleRoutingReason:
        "Transcript sounds like a creator asking for guidance on clipping, creation, approvals, or payouts, so default to direct answering mode before any workspace build.",
      isWeb3Native,
    };
  }

  if (params.inferredRole === "brand" || params.communityId) {
    return {
      interactionMode: "agency_agentic",
      roleRoutingReason:
        params.communityId || isWeb3Native
          ? "Transcript points to a brand, agency, or web3 community operator who needs an agentic launch path with virality, workspace setup, and campaign execution."
          : "Transcript points to a brand or operator who needs a done-for-you community and campaign build path.",
      isWeb3Native,
    };
  }

  return {
    interactionMode: "role_detection",
    roleRoutingReason:
      "User intent is still mixed, so first ask one decisive routing question to separate creator guidance from brand/community build mode.",
    isWeb3Native,
  };
}

function lastUserMessage(messages: { role: ChatRole; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

export function buildBuilderAgentChain(params: {
  messages: { role: ChatRole; content: string }[];
  communityId: string | null;
  website: WebsiteIntelligence | null;
}): BuilderAgentChain {
  const transcript = params.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  const latest = lastUserMessage(params.messages);
  const inferredRole = inferRole(transcript);
  const routing = detectInteractionMode({
    inferredRole,
    transcript,
    communityId: params.communityId,
  });
  const wantsCommunity =
    Boolean(params.communityId) ||
    /\bcommunity|membership|members|audience|group|hub\b/i.test(transcript);
  const wantsProducts = /\bproduct|offer|pricing|bundle|service|course|digital\b/i.test(transcript);
  const wantsFunding =
    /\bfund|deposit|topup|top-up|treasury|wallet|phantom|sol|on-chain|onchain\b/i.test(transcript);
  const prefersOnchain = /\bphantom|sol|on-chain|onchain|wallet\b/i.test(transcript);

  const websiteAudience = params.website?.audienceHints[0] || "buyers looking for a concrete outcome";
  const websiteProduct = params.website?.productSignals[0] || "turn the main promise into a flagship product";
  const viralAngle = params.website?.viralAngles[0] || "use creator-led proof and short-form hooks";
  const recommendedProductType =
    params.website && /membership|community|academy|program/i.test(params.website.readableText)
      ? "membership-led flagship offer"
      : wantsProducts
        ? "productized offer with a clear CTA"
        : "community-led offer";

  const priorities =
    routing.interactionMode === "creator_answering"
      ? [
          "identify whether the creator needs clipping guidance, UGC guidance, or payout / approval guidance",
          "answer directly with practical next steps before proposing any heavy build flow",
          "only move into a build or workspace plan if the creator explicitly asks for done-for-you setup",
        ]
      : routing.interactionMode === "role_detection"
        ? [
            "ask one decisive routing question first: creator guidance or brand/community build mode",
            "do not pretend the role is known until the user answers",
            "avoid heavy build actions until routing is confirmed",
          ]
        : [
            "understand the current business situation before prescribing channels",
            "make the offer specific enough that creators can sell it",
            "show the exact next card to create community, product, campaign, and funding flow",
          ];

  if (params.website?.title) {
    priorities.push(`ground the plan in the website positioning from ${params.website.title}`);
  }

  const goal =
    latest.trim() ||
    "Build a launch-ready community, product, and campaign plan that can be funded and activated.";

  return {
    inferredRole,
    interactionMode: routing.interactionMode,
    roleRoutingReason: routing.roleRoutingReason,
    isWeb3Native: routing.isWeb3Native,
    goal,
    priorities,
    recommendedProductType,
    wantsCommunity,
    wantsProducts,
    wantsFunding,
    prefersOnchain,
    agents: [
      ...(routing.interactionMode === "creator_answering"
        ? [
            {
              id: "creator_success_coach",
              label: "Creator Success Coach",
              mission: "Answers creator questions directly and gets them to the next practical move fast.",
              findings: [
                `Primary audience signal: ${websiteAudience}.`,
                `Goal framing: ${goal}.`,
                routing.isWeb3Native
                  ? "Creator context touches web3, so keep examples relevant to web3 communities and on-chain payout trust."
                  : "Focus on creator execution rather than building a full brand workspace.",
              ],
              nextMove: "Answer the creator directly with the next best proof, clip, or creation move.",
            },
            {
              id: "clip_strategy_guide",
              label: "Clip Strategy Guide",
              mission: "Turns vague creator goals into clipping formats, hook angles, and posting guidance.",
              findings: [
                `Viral angle: ${viralAngle}.`,
                "If the creator has long-form sources, teach them how to turn those into clip-ready assets.",
                "If they do not, guide them toward UGC creation, portfolio proof, and approval-friendly content.",
              ],
              nextMove: "Clarify whether the creator wants clipping, UGC creation, or payout guidance next.",
            },
          ]
        : routing.interactionMode === "role_detection"
          ? [
              {
                id: "role_router",
                label: "Role Router",
                mission: "Separates creators seeking guidance from brands or communities seeking a build.",
                findings: [
                  `Goal framing: ${goal}.`,
                  routing.roleRoutingReason,
                  params.website?.description
                    ? `Website promise: ${params.website.description}.`
                    : "No website description found, so rely on the user transcript.",
                ],
                nextMove: "Ask one decisive question to identify creator guidance mode versus agency agentic mode.",
              },
            ]
          : [
              {
                id: "situation_analyst",
                label: "Situation Analyst",
                mission: "Understands the business context and the fastest credible path to launch.",
                findings: [
                  `Primary audience signal: ${websiteAudience}.`,
                  `Goal framing: ${goal}.`,
                  params.website?.description
                    ? `Website promise: ${params.website.description}.`
                    : "No website description found, so rely on the user transcript.",
                ],
                nextMove: "Map the shortest end-to-end path from positioning to launch card.",
              },
              {
                id: "offer_architect",
                label: "Offer Architect",
                mission: "Turns the situation into a product and community structure that converts.",
                findings: [
                  `Recommended offer shape: ${recommendedProductType}.`,
                  `Product signal: ${websiteProduct}.`,
                  wantsCommunity
                    ? "Community should be part of the core funnel, not a side note."
                    : "Community can still be introduced as the retention and proof layer.",
                ],
                nextMove: "Create community and product cards with clear conversion language.",
              },
              {
                id: "viral_growth_operator",
                label: "Viral Growth Operator",
                mission: "Designs the creator and campaign mechanics that maximize shareability and conversion.",
                findings: [
                  `Viral angle: ${viralAngle}.`,
                  prefersOnchain
                    ? "User is already asking for wallet-aware execution, so keep the launch flow agentic."
                    : "Funding should stay available but not block strategy creation.",
                  "Campaign should end in a real funding or activation step, not just planning.",
                ],
                nextMove: "Add campaign and treasury cards that can open the right UI flow.",
              },
            ]),
    ],
  };
}

export function buildAgentChainPromptBlock(chain: BuilderAgentChain): string {
  return `AGENT_CHAIN_JSON:\n${JSON.stringify(chain)}\n`;
}

function makeNodeId(prefix: string, seed: string) {
  return `${prefix}-${seed}`;
}

export function buildAgentChainCanvasActions(params: {
  chain: BuilderAgentChain;
  communityId: string | null;
  website: WebsiteIntelligence | null;
  currentNodeCount: number;
}): Array<Record<string, unknown>> {
  if (params.currentNodeCount > 0) return [];

  const now = Date.now().toString();
  const imageUrl = params.website?.heroImage || params.website?.logoImage;
  const coverImageUrl = params.website?.heroImage || params.website?.logoImage;
  const profileImageUrl = params.website?.logoImage || params.website?.heroImage;
  const sourceUrl = params.website?.url;
  const initialId = makeNodeId("goal", now);

  const shared =
    imageUrl || sourceUrl
      ? {
          ...(imageUrl ? { sourceImageUrl: imageUrl } : {}),
          ...(coverImageUrl ? { sourceCoverImageUrl: coverImageUrl } : {}),
          ...(profileImageUrl ? { sourceProfileImageUrl: profileImageUrl } : {}),
          ...(sourceUrl ? { sourceUrl } : {}),
        }
      : {};

  const goalText = params.chain.goal.trim();
  const shortGoal = goalText.length > 140 ? goalText.slice(0, 140) + "…" : goalText;

  const label =
    params.chain.interactionMode === "creator_answering"
      ? "Creator goal"
      : "Your campaign goal";

  const description =
    params.chain.interactionMode === "creator_answering"
      ? shortGoal || "Creator guidance and next steps."
      : shortGoal || "Build a launch-ready community, product, and campaign.";

  return [
    {
      type: "ADD_NODE",
      payload: {
        node: {
          id: initialId,
          label,
          description,
          category: "initial",
          status: "in_progress",
          x: 300,
          y: 240,
          dependencies: [],
          connectsTo: [],
          animation: { entrance: "bounce", delay: 0 },
          ...shared,
        },
      },
    },
  ];
}

export function buildAgentChainClientActions(params: {
  chain: BuilderAgentChain;
  communityId: string | null;
}): ClientAction[] {
  if (params.chain.interactionMode !== "agency_agentic") {
    return [];
  }

  const actions: ClientAction[] = [];

  actions.push({
    type: "NAVIGATE",
    payload: {
      href: params.communityId
        ? `/dashboard/community/${params.communityId}/settings`
        : "/seller-onboarding",
      label: params.communityId ? "Open community workspace" : "Create community",
    },
  });

  actions.push({
    type: "NAVIGATE",
    payload: {
      href: "/create",
      label: "Create product",
    },
  });

  if (params.communityId) {
    actions.push({
      type: "NAVIGATE",
      payload: {
        href: `/web3-campaign/new?communityId=${encodeURIComponent(params.communityId)}`,
        label: params.chain.prefersOnchain ? "Deposit USDC with Phantom" : "Open campaign funding",
      },
    });
  }

  return actions;
}
