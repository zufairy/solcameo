type SuggestionContext = {
  clippingAllowed: boolean;
  transcript: string;
  latestUser: string;
  canvasNodeCount: number;
};

const BRAND_REPLY_PACK = [
  "I am a brand. Build a complete UGC campaign plan for this month.",
  "Create the campaign on the canvas with milestones and launch checklist.",
  "Give me starter, growth, and scale budget options with KPI targets.",
];

const CREATOR_REPLY_PACK = [
  "I am a creator. Give me a 7-day content plan to get approved faster.",
  "Show me exactly what proof format gets accepted for payouts.",
  "Help me optimize hooks and CTAs for higher approval rate.",
];

const CLIPPING_REPLY_PACK = [
  "I have long-form content. Build a clipping campaign lane with payout rates.",
  "Design clip formats and posting cadence for Threads, X, TikTok, and YouTube.",
  "Map asset sourcing, approvals, and clipper briefing as canvas steps.",
];

const FUNDING_REPLY_PACK = [
  "Deposit USDC into the Vello treasury and activate this campaign now.",
  "Open the treasury top-up flow and show the recommended USDC amount.",
  "Prepare the campaign so I can deposit and launch immediately.",
];

export function getUserReplySuggestions(ctx: SuggestionContext): string[] {
  const t = ctx.transcript;
  const latest = ctx.latestUser;

  if (/creator|ugc creator|clipper|influencer/.test(t)) {
    return CREATOR_REPLY_PACK;
  }

  if (/budget|cost|usd|myr|treasury|fund|deposit|topup|top-up|sol|onchain|on-chain/.test(latest)) {
    return FUNDING_REPLY_PACK;
  }

  if (ctx.clippingAllowed || /podcast|webinar|long video|youtube long|vod/.test(t)) {
    return CLIPPING_REPLY_PACK;
  }

  if (ctx.canvasNodeCount < 3) {
    return BRAND_REPLY_PACK;
  }

  return [
    "Refine this campaign into a week-by-week execution plan.",
    "List risks and blockers, then add mitigation steps on the canvas.",
    "Finalize this and prepare the launch-ready campaign setup.",
  ];
}
