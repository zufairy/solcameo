/**
 * Vello Skills Marketplace v2 — agent capabilities split by agent type.
 * Each skill is an MCP server / integration the agent wallet pays to use.
 *
 * Economics: agents pay `pricePerUseUsdc` per call. Skill providers earn 17.5%
 * of usage revenue. Remainder goes to the RevenueSplit defined at mint.
 */

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  pricePerUseUsdc: number;
  pricingUnit: string;
  provider: string;
  recommendedFor: ("influencer" | "trader" | "worker")[];
  avgUsesPerDay: number;
  integration: string;
  /** Server-side env var(s) the skill needs to be operational. Empty = no setup needed. */
  requires?: string[];
  /** Where to get the API key. */
  setupUrl?: string;
  /** Tier of the API — informational badge in UI. */
  apiTier?: "free" | "freemium" | "paid";
  /** Default MD instructions written when this skill is installed. */
  markdownTemplate?: string;
}

// ─── Trader skill categories ────────────────────────────────────────────────
export type TraderSkillCategory = "signals" | "execution" | "intelligence" | "risk" | "alerts";

// ─── Influencer / worker skill categories (legacy) ──────────────────────────
export type LegacySkillCategory = "distribution" | "execution" | "messaging" | "content" | "data" | "intelligence" | "monetization";

export type SkillCategory = TraderSkillCategory | LegacySkillCategory;

// ─── TRADER SKILLS ───────────────────────────────────────────────────────────

export const TRADER_SKILLS_CATALOG: Skill[] = [
  // ── Signals ────────────────────────────────────────────────────────────────
  {
    id: "x.sentiment",
    name: "X Sentiment Monitor",
    category: "signals",
    description: "Scans X/Twitter in real-time via Firecrawl's JS-rendering engine. Detects momentum shifts, influencer posts, and coordinated hype before they price in.",
    pricePerUseUsdc: 0.005,
    pricingUnit: "scan",
    provider: "Firecrawl",
    recommendedFor: ["trader"],
    avgUsesPerDay: 48,
    integration: "Firecrawl /v1/scrape (Nitter target)",
    requires: ["FIRECRAWL_API_KEY"],
    setupUrl: "https://www.firecrawl.dev/pricing",
    apiTier: "freemium",
  },
  {
    id: "onchain.whale",
    name: "Whale Tracker",
    category: "signals",
    description: "Monitors wallets moving >$50K on Solana via Birdeye token analytics. Fires when smart money accumulates or distributes before retail notices.",
    pricePerUseUsdc: 0.008,
    pricingUnit: "scan",
    provider: "Birdeye",
    recommendedFor: ["trader"],
    avgUsesPerDay: 24,
    integration: "Birdeye token_overview + Helius",
    requires: ["BIRDEYE_API_KEY"],
    setupUrl: "https://docs.birdeye.so/docs/authentication-api-keys",
    apiTier: "freemium",
  },
  {
    id: "polymarket.signals",
    name: "Prediction Markets",
    category: "signals",
    description: "Reads implied probability from Polymarket. Uses market consensus as a forward-looking signal — what the crowd is pricing in for macro events.",
    pricePerUseUsdc: 0.002,
    pricingUnit: "read",
    provider: "Polymarket",
    recommendedFor: ["trader"],
    avgUsesPerDay: 12,
    integration: "Polymarket Gamma API",
    requires: [],
    apiTier: "free",
  },
  {
    id: "news.feed",
    name: "Crypto News Feed",
    category: "signals",
    description: "Aggregates CryptoPanic + CoinGecko trending. Flags high-impact events seconds after publication and weighs sentiment via lexicon scoring.",
    pricePerUseUsdc: 0.003,
    pricingUnit: "read",
    provider: "CryptoPanic + CoinGecko",
    recommendedFor: ["trader"],
    avgUsesPerDay: 24,
    integration: "CryptoPanic public API + CG /search/trending",
    requires: [],
    apiTier: "free",
  },
  {
    id: "onchain.flow",
    name: "On-chain Flow",
    category: "signals",
    description: "Tracks DEX buy/sell volume imbalance on Solana in real-time. Large imbalances flag accumulation or distribution before price moves.",
    pricePerUseUsdc: 0.006,
    pricingUnit: "scan",
    provider: "Birdeye",
    recommendedFor: ["trader"],
    avgUsesPerDay: 24,
    integration: "Birdeye trade-data/single",
    requires: ["BIRDEYE_API_KEY"],
    setupUrl: "https://docs.birdeye.so/docs/authentication-api-keys",
    apiTier: "freemium",
  },

  // ── Execution ───────────────────────────────────────────────────────────────
  {
    id: "jupiter.swap",
    name: "Jupiter DEX Swap",
    category: "execution",
    description: "Best-route spot swaps on Solana via Jupiter v6 aggregator. Slippage protection built-in. Only executes when rules + risk guard align.",
    pricePerUseUsdc: 0.05,
    pricingUnit: "swap",
    provider: "Jupiter",
    recommendedFor: ["trader"],
    avgUsesPerDay: 3,
    integration: "Jupiter v6 quote + swap endpoints",
    requires: ["NEXT_PUBLIC_HELIUS_API_KEY"],
    setupUrl: "https://dev.helius.xyz/dashboard/app",
    apiTier: "freemium",
  },
  {
    id: "portfolio.rebalance",
    name: "Portfolio Rebalancer",
    category: "execution",
    description: "Automatically rebalances wallet allocations to target weights when positions drift beyond your configured threshold.",
    pricePerUseUsdc: 0.08,
    pricingUnit: "rebalance",
    provider: "Jupiter",
    recommendedFor: ["trader"],
    avgUsesPerDay: 0.5,
    integration: "Jupiter v6 batch swap",
    requires: ["NEXT_PUBLIC_HELIUS_API_KEY"],
    setupUrl: "https://dev.helius.xyz/dashboard/app",
    apiTier: "freemium",
  },

  // ── Intelligence ────────────────────────────────────────────────────────────
  {
    id: "ta.analysis",
    name: "Technical Analysis",
    category: "intelligence",
    description: "Computes RSI, MACD, Bollinger Bands, and support/resistance zones on live Birdeye OHLCV. Adds technical context to every signal decision.",
    pricePerUseUsdc: 0.004,
    pricingUnit: "analysis",
    provider: "Birdeye",
    recommendedFor: ["trader"],
    avgUsesPerDay: 12,
    integration: "Birdeye OHLCV + in-house TA engine",
    requires: ["BIRDEYE_API_KEY"],
    setupUrl: "https://docs.birdeye.so/docs/authentication-api-keys",
    apiTier: "freemium",
  },
  {
    id: "birdeye.analytics",
    name: "Birdeye Analytics",
    category: "intelligence",
    description: "Volume, liquidity depth, holder distribution, and price impact. Catches wash trading, thin books, and rug patterns early.",
    pricePerUseUsdc: 0.006,
    pricingUnit: "report",
    provider: "Birdeye",
    recommendedFor: ["trader"],
    avgUsesPerDay: 8,
    integration: "Birdeye Pro API",
    requires: ["BIRDEYE_API_KEY"],
    setupUrl: "https://docs.birdeye.so/docs/authentication-api-keys",
    apiTier: "paid",
  },
  {
    id: "ai.reasoning",
    name: "AI Reasoning Layer",
    category: "intelligence",
    description: "Gemini 3 Flash evaluates all active signals together, cross-references memory, and outputs a scored confidence decision with full reasoning chain.",
    pricePerUseUsdc: 0.012,
    pricingUnit: "decision",
    provider: "Kie.ai / Gemini",
    recommendedFor: ["trader"],
    avgUsesPerDay: 6,
    integration: "Gemini 3 Flash via Kie",
    requires: ["KIE_API_KEY"],
    setupUrl: "https://kie.ai",
    apiTier: "paid",
  },

  // ── Risk ────────────────────────────────────────────────────────────────────
  {
    id: "risk.guardian",
    name: "Risk Guardian",
    category: "risk",
    description: "Enforces position limits, stop-losses, and daily trade caps. Vetoes any trade that breaches your configured risk parameters.",
    pricePerUseUsdc: 0.001,
    pricingUnit: "check",
    provider: "Vello Risk",
    recommendedFor: ["trader"],
    avgUsesPerDay: 48,
    integration: "In-house risk engine",
    requires: [],
    apiTier: "free",
  },
  {
    id: "drawdown.guard",
    name: "Drawdown Guard",
    category: "risk",
    description: "Pauses all trading if portfolio drops more than X% in 24h. Auto-resumes after the cool-down window. Prevents cascading losses.",
    pricePerUseUsdc: 0.001,
    pricingUnit: "check",
    provider: "Vello Risk",
    recommendedFor: ["trader"],
    avgUsesPerDay: 24,
    integration: "In-house risk engine",
    requires: [],
    apiTier: "free",
  },

  // ── Alerts ──────────────────────────────────────────────────────────────────
  {
    id: "telegram.alert",
    name: "Telegram Alerts",
    category: "alerts",
    description: "Pushes every signal, decision, and trade to your Telegram. Includes sentiment score, confidence level, and approve/reject buttons for manual mode.",
    pricePerUseUsdc: 0.002,
    pricingUnit: "message",
    provider: "Telegram",
    recommendedFor: ["trader"],
    avgUsesPerDay: 6,
    integration: "Telegram Bot API",
    requires: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
    setupUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot",
    apiTier: "free",
  },
  {
    id: "discord.alert",
    name: "Discord Alerts",
    category: "alerts",
    description: "Posts rich embeds to your Discord channel — includes candle snapshots, signal data, decision rationale, and PnL updates.",
    pricePerUseUsdc: 0.002,
    pricingUnit: "message",
    provider: "Discord",
    recommendedFor: ["trader"],
    avgUsesPerDay: 6,
    integration: "Discord Webhooks",
    requires: ["DISCORD_WEBHOOK_URL"],
    setupUrl: "https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
    apiTier: "free",
  },

  // ── Extended trader stack (v2 marketplace expansion) ───────────────────────
  {
    id: "copy.trade",
    name: "Wallet Copy-Trader",
    category: "signals",
    description: "Mirror a target wallet's swaps in near-realtime. Filters by min trade size and confidence (wallet PnL history). Use to follow proven on-chain alpha.",
    pricePerUseUsdc: 0.01,
    pricingUnit: "mirrored trade",
    provider: "Vello On-Chain",
    recommendedFor: ["trader"],
    avgUsesPerDay: 18,
    integration: "Helius webhook + Birdeye PnL",
    requires: ["NEXT_PUBLIC_HELIUS_API_KEY"],
    apiTier: "freemium",
  },
  {
    id: "funding.rate",
    name: "Funding Rate Monitor",
    category: "signals",
    description: "Tracks perp funding rates across Binance / Bybit / Hyperliquid. Flags extreme positioning (longs paying shorts) as contrarian signal.",
    pricePerUseUsdc: 0.003,
    pricingUnit: "scan",
    provider: "CCXT Aggregator",
    recommendedFor: ["trader"],
    avgUsesPerDay: 24,
    integration: "CCXT public endpoints",
    requires: [],
    apiTier: "free",
  },
  {
    id: "liquidation.tracker",
    name: "Liquidation Tracker",
    category: "signals",
    description: "Streams CEX liquidation cascades from Coinglass. Long-liq spikes = local bottoms; short-liq spikes = local tops. Powerful reversal signal.",
    pricePerUseUsdc: 0.005,
    pricingUnit: "scan",
    provider: "Coinglass",
    recommendedFor: ["trader"],
    avgUsesPerDay: 48,
    integration: "Coinglass REST",
    requires: ["COINGLASS_API_KEY"],
    setupUrl: "https://www.coinglass.com/pricing",
    apiTier: "freemium",
  },
  {
    id: "peg.monitor",
    name: "Stablecoin Peg Monitor",
    category: "risk",
    description: "Watches USDC / USDT / DAI / sUSD peg deviation. Halts trading + alerts on >0.5% deviation. Critical safety layer for USDC-denominated PnL.",
    pricePerUseUsdc: 0.001,
    pricingUnit: "check",
    provider: "Vello Risk",
    recommendedFor: ["trader"],
    avgUsesPerDay: 288,
    integration: "Chainlink + Pyth peg feeds",
    requires: [],
    apiTier: "free",
  },
  {
    id: "yield.scanner",
    name: "DeFi Yield Scanner",
    category: "intelligence",
    description: "Surfaces best USDC/SOL yield across Marginfi / Kamino / MarinadeFinance. Idle treasury auto-routes to top safe APY (TVL > $50M, audited).",
    pricePerUseUsdc: 0.005,
    pricingUnit: "scan",
    provider: "DefiLlama",
    recommendedFor: ["trader"],
    avgUsesPerDay: 6,
    integration: "DefiLlama Yields API",
    requires: [],
    apiTier: "free",
  },
  {
    id: "gas.optimizer",
    name: "Priority Fee Optimizer",
    category: "execution",
    description: "Reads the live Solana priority-fee distribution and picks the optimal CU price for fast confirmation without overpaying. Saves ~30% on tx costs.",
    pricePerUseUsdc: 0.001,
    pricingUnit: "fee lookup",
    provider: "Helius",
    recommendedFor: ["trader"],
    avgUsesPerDay: 48,
    integration: "Helius priority-fee API",
    requires: ["NEXT_PUBLIC_HELIUS_API_KEY"],
    apiTier: "freemium",
  },
  {
    id: "kelly.sizing",
    name: "Kelly Position Sizer",
    category: "risk",
    description: "Computes optimal bet size per Kelly criterion from your win rate + edge. Caps at fractional-Kelly (typically 0.25x) for survival. Quantitatively sound sizing.",
    pricePerUseUsdc: 0.001,
    pricingUnit: "decision",
    provider: "Vello Quant",
    recommendedFor: ["trader"],
    avgUsesPerDay: 24,
    integration: "In-house",
    requires: [],
    apiTier: "free",
  },
  {
    id: "dca.scheduler",
    name: "DCA Scheduler",
    category: "execution",
    description: "Time-sliced buys across a window (TWAP-lite). Splits a $1000 allocation into 20 × $50 buys over 24h to minimize price impact and timing risk.",
    pricePerUseUsdc: 0.002,
    pricingUnit: "slice",
    provider: "Vello Execution",
    recommendedFor: ["trader"],
    avgUsesPerDay: 20,
    integration: "Jupiter + internal scheduler",
    requires: [],
    apiTier: "free",
  },
  {
    id: "mempool.monitor",
    name: "Mempool Frontrun Shield",
    category: "execution",
    description: "Detects competing swaps in the mempool and adjusts priority fees / slippage live. Protects against sandwich attacks on large fills.",
    pricePerUseUsdc: 0.003,
    pricingUnit: "tx",
    provider: "Jito Bundle Relayer",
    recommendedFor: ["trader"],
    avgUsesPerDay: 12,
    integration: "Jito ShredStream",
    requires: ["JITO_AUTH_TOKEN"],
    setupUrl: "https://docs.jito.wtf/",
    apiTier: "freemium",
  },
  {
    id: "dex.aggregator",
    name: "Raydium / Orca Router",
    category: "execution",
    description: "Falls back to direct Raydium/Orca pool swaps when Jupiter routes are congested. Aggregator-of-aggregators for best fill on Solana.",
    pricePerUseUsdc: 0.002,
    pricingUnit: "swap",
    provider: "Raydium SDK",
    recommendedFor: ["trader"],
    avgUsesPerDay: 8,
    integration: "Raydium SDK + Orca Whirlpools",
    requires: [],
    apiTier: "free",
  },
];

// ─── INFLUENCER / WORKER SKILLS (kept for non-trader agents) ─────────────────

export const INFLUENCER_SKILLS_CATALOG: Skill[] = [
  {
    id: "music.trendingaudio",
    name: "Trending Audio",
    category: "content",
    description: "Drops a trending music bed under every generated video — auto-matched to the mood, or pick a specific track. Mixed quietly under the voiceover (default 30% loudness) so speech always stays clear. Adjust the loudness anytime with a slider.",
    pricePerUseUsdc: 0.02,
    pricingUnit: "video",
    provider: "Vello",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 1,
    integration: "Vello audio mixer (ffmpeg amix in the finalize phase)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Trending Audio\n\n> Mix a trending music bed into the agent's generated videos.\n\n## What it does\nAfter a video is rendered, a trending track is mixed UNDER the voiceover at a low volume so speech stays dominant. By default the track is auto-matched to the video's mood; you can also pin a specific track. The music **loudness** is set with a slider (default **30%**) and saved per agent.\n\n## Set\n- **Loudness** — how loud the music bed sits under the voice (0–100%, default 30%).\n- **Track** — auto-match by mood, or pin one trending track.\n`,
  },
  {
    id: "video.autohook",
    name: "Auto Hook",
    category: "content",
    description: "Burns a bold scroll-stopping hook line onto the first seconds of every generated video — the same Auto Hook overlay the AI Clipper uses. Uses the agent's written hook, or your own custom line. Styling (color, size, position) is configurable.",
    pricePerUseUsdc: 0,
    pricingUnit: "video",
    provider: "Vello",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 1,
    integration: "Vello overlay burn (ffmpeg text_overlay in the finalize phase)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Auto Hook\n\n> Burn a scroll-stopping hook line onto every generated video.\n\n## What it does\nOverlays a bold hook line on the opening seconds of the video so the scroll stops. It uses the video's own written hook by default, or a custom line you set. Color, size, and position are configurable.\n\n## Set\n- **Source** — auto (use the video's hook) or custom text.\n- **Style** — font color, size, and position (top / center / bottom).\n`,
  },
  {
    id: "video.captions",
    name: "Captions",
    category: "content",
    description: "Auto-captions every generated video — transcribes the voiceover and burns word-synced karaoke (or line) captions, exactly like the AI Clipper. Boosts watch-time and accessibility. Style (color, size, position, mode) is configurable.",
    pricePerUseUsdc: 0.01,
    pricingUnit: "video",
    provider: "Vello",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 1,
    integration: "Vello caption renderer (transcribe + ASS subtitles in the finalize phase)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Captions\n\n> Auto-caption every generated video.\n\n## What it does\nTranscribes the video's voiceover and burns word-synced captions (karaoke or line mode) onto the video — the same engine the AI Clipper uses. Captions lift watch-time and make videos accessible with sound off.\n\n## Set\n- **Mode** — karaoke (word-by-word) or line.\n- **Style** — font color, size, and position.\n`,
  },
  {
    id: "video.cta",
    name: "Video Call To Action",
    category: "content",
    description: "Upload a short call-to-action clip (a subscribe bumper, an offer, a logo sting) and it's stitched onto the END of every generated video — aspect-normalized so it fits the frame, with its own audio. Set it once; it runs on every video the agent produces.",
    pricePerUseUsdc: 0,
    pricingUnit: "video",
    provider: "Vello",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 1,
    integration: "Vello CTA append (ffmpeg concat in the finalize phase)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Video Call To Action\n\n> Append your uploaded CTA clip to the end of every generated video.\n\n## What it does\nStitches a short operator-uploaded video (subscribe bumper, offer, logo sting) onto the tail of every produced video. The clip is scaled to fit the video's frame (letterboxed, never cropped) and its audio plays.\n\n## Set\n- **CTA video** — upload the clip to append. Applied to every video until you remove it.\n`,
  },
  {
    id: "video.imageposts",
    name: "Image Posts",
    category: "content",
    description: "Generate the post's image with KIE instead of filming it. Tick \"image only\" and the agent stops generating video entirely — each post is a fresh still written from the persona, the agent's memories and your idea box, then published as a photo to every connected account. Pick the engine: Nano Banana Pro, Nano Banana 2 (or Lite), or ChatGPT's GPT Image 2.",
    pricePerUseUsdc: 0.04,
    pricingUnit: "image",
    provider: "Kie.ai",
    recommendedFor: ["influencer", "worker"],
    avgUsesPerDay: 2,
    integration: "Kie image models (nano-banana-pro / nano-banana-2 / nano-banana-2-lite / gpt-image-2)",
    requires: ["KIE_API_KEY"],
    setupUrl: "https://kie.ai",
    apiTier: "paid",
    markdownTemplate: `# Image Posts\n\n> Post images instead of video — a fraction of the cost per post.\n\n## What it does\nWrites a fresh image prompt from the persona (who the agent is, its look) plus what it has posted recently plus your idea box, generates the still on the engine you choose, and publishes it as a photo post with a caption written the same way video captions are.\n\nWith **image only** on, the video model is never called — a post costs one image generation instead of dollars of video.\n\n## Set\n- **Image only** — skip video generation entirely.\n- **Idea** — the standing brief every image follows.\n- **Engine** — Nano Banana Pro (best text), Nano Banana 2 (4K, fast), Nano Banana 2 Lite (cheapest), ChatGPT GPT Image 2 (most literal; takes no character reference).\n`,
  },
  {
    id: "clip.carouselbuilder",
    name: "Photo Carousel Builder",
    category: "content",
    description: "Adds a dedicated Carousel tab for generating and posting multi-image photo carousels — KIE-generated stills built from the persona and your idea, arranged into a swipeable set, then published to every connected account in one go.",
    pricePerUseUsdc: 0.04,
    pricingUnit: "image",
    provider: "Kie.ai",
    recommendedFor: ["influencer", "worker"],
    avgUsesPerDay: 1,
    integration: "Kie image models + Vello carousel composer (app-only install — opens its own tab)",
    requires: ["KIE_API_KEY"],
    setupUrl: "https://kie.ai",
    apiTier: "paid",
    markdownTemplate: `# Photo Carousel Builder\n\n> Generate and post multi-image photo carousels.\n\n## What it does\nOpens a dedicated **Carousel** tab. Each carousel is a set of KIE-generated stills built from the persona and your idea, arranged into a swipeable sequence, then published as a carousel post to every connected account.\n\n## Use\nSwitch to the Carousel tab to generate, review, reorder and post — this app just unlocks the tab; there's nothing to configure here.\n`,
  },
  {
    id: "video.series",
    name: "Cartoon Series",
    category: "content",
    description: "Turn the agent into an episodic show. Design a cast (describe them — the design sheet is generated and becomes their locked look), set the premise, and the agent writes and renders the next EPISODE on its own: continuing a hanging thread or starting something new, never repeating a premise it has already made.",
    pricePerUseUsdc: 0,
    pricingUnit: "video",
    provider: "Vello",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 1,
    integration: "Vello episode planner (memory-driven) + the existing video pipeline's character-reference lock",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Cartoon Series\n\n> The agent runs a show instead of posting one-offs.\n\n## What it does\nEvery video becomes an EPISODE. Before writing, the agent reads the episodes it has already made: if the last one ended on a cliffhanger it pays that thread off, otherwise it starts something self-contained — and a premise too close to one already made is rejected and rewritten.\n\nEach cast member's design sheet is the identity reference sent to the video model, so the characters keep their look across episodes.\n\n## Set\n- **Premise + world** — the standing setup every episode sits inside.\n- **Cast** — describe each character; the design sheet is generated for you. Up to 3 appear per episode (the model's reference limit); a bigger cast rotates.\n- **Themes** — what to rotate through when there is no thread to continue.\n`,
  },
  {
    id: "video.hookvideos",
    name: "Hook Videos",
    category: "content",
    description: "Upload a pool of hook clips. One plays at the front of every generated video, chosen by which upload best matches what the video is about (they rotate in upload order until transcripts exist). The hook text overlay, if installed, burns over it.",
    pricePerUseUsdc: 0,
    pricingUnit: "video",
    provider: "Vello",
    recommendedFor: ["influencer", "worker"],
    avgUsesPerDay: 1,
    integration: "Vello render pipeline (concat before the overlay burn, so text lands on the hook)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Hook Videos\n\n> Start every video with footage you filmed.\n\n## What it does\nPlays one of your uploaded hook clips at the FRONT of every generated video, then cuts to the main content. Upload several; the one whose content best matches the video airs, and until they are transcribed they simply rotate so every hook gets used.\n\n## Set\n- **Hook videos** — upload one or more. Remove any you no longer want in rotation.\n`,
  },
  {
    id: "video.maincontent",
    name: "Main Content",
    category: "content",
    description: "Upload your own body videos. With \"No clip / UGC needed\" on, the agent stops generating video entirely and publishes your uploads instead — still with the hook, captions, filters and CTA applied.",
    pricePerUseUsdc: 0,
    pricingUnit: "video",
    provider: "Vello",
    recommendedFor: ["influencer", "worker"],
    avgUsesPerDay: 1,
    integration: "Vello render pipeline (replaces the generated body; overlays still apply)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Main Content\n\n> Publish your own footage instead of generated video.\n\n## What it does\nUses your uploaded videos as the body of the post. Turn on **No clip / UGC needed** to skip generation altogether — each post becomes one of your uploads, with a Hook Video in front of it when that app is installed. Captions, filters and the CTA still apply, so posts keep the agent's look.\n\n## Set\n- **Main videos** — upload one or more; they cycle to fill the post count.\n- **No clip / UGC needed** — skip clipping/generation and publish the uploads as-is.\n`,
  },
  {
    id: "video.guardrails",
    name: "Guardrails",
    category: "content",
    description: "Pre-post QA gate — blocks a video from posting if it contains flagged language, fails a basic technical-quality check (too short, corrupt, low-res), already has burned-in captions (so a Captions skill wouldn't double them up), or reads as obviously AI-generated. Helps keep posted content out of platform low-quality/shadow filters.",
    pricePerUseUsdc: 0.015,
    pricingUnit: "video",
    provider: "Vello",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 1,
    integration: "Vello guardrails (lib/server/guardrails.ts) — gates the upload-post call directly",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Guardrails\n\n> Pre-post QA — stop a bad video before it ever reaches a platform.\n\n## What it does\nRuns right before posting: scans the caption for flagged language, checks the video isn't too short/corrupt/low-resolution, and (vision pass) checks it doesn't already have burned-in captions or read as obviously AI-generated. If any check fails, the post is blocked — the video is never published.\n\n## Why\nA video that trips these checks is exactly the kind of content platforms like TikTok tend to shadow-filter — catching it before posting protects the account's distribution instead of burning a slot on a video stuck at near-zero views.\n`,
  },
  {
    id: "monetize.hiring",
    name: "Marketplace Hiring",
    category: "monetization",
    description: "List the agent for hire on the marketplace as a monthly retainer — set how many videos it produces per month and the rate. Clients see the offer and can hire it directly.",
    pricePerUseUsdc: 0,
    pricingUnit: "month",
    provider: "Vello",
    recommendedFor: ["influencer", "worker"],
    avgUsesPerDay: 0,
    integration: "Vello marketplace (Convex influencers.monetization)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Marketplace Hiring\n\n> Offer this agent as a monthly retainer on the marketplace.\n\n## What it does\nExposes a "Hire monthly" offer on the agent's marketplace card: **N videos per month** at a **monthly rate**. Configure the numbers in the agent builder — they show to clients on the Hire Agents page.\n\n## Set\n- **Videos / month** — how many finished videos the client gets each month.\n- **Monthly rate** — the retainer price in **USDC**.\n`,
  },
  {
    id: "monetize.pervideo",
    name: "Charge Per Video",
    category: "monetization",
    description: "Enable pay-per-video pricing — set the cost per generated video and the requirement prompt (the brief the agent follows for every commissioned video).",
    pricePerUseUsdc: 0,
    pricingUnit: "video",
    provider: "Vello",
    recommendedFor: ["influencer", "worker"],
    avgUsesPerDay: 0,
    integration: "Vello marketplace (Convex influencers.monetization)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Charge Per Video\n\n> Pay-per-video pricing for commissioned creatives.\n\n## What it does\nLets clients commission a single video. The **cost per video** is paid in **USDC** on-chain to the agent's wallet, and the agent generates the video following the **requirement prompt** you set — the standing brief for what every commissioned video must do.\n\n## Set\n- **Cost per video** — USDC charged per generation (paid to the agent wallet).\n- **Requirement prompt** — what the agent must do in the video (style, must-show, CTA, do/don't).\n`,
  },
  {
    id: "vello.campaigns",
    name: "Vello Campaigns",
    category: "distribution",
    description: "Lets the agent discover, join, and complete brand campaigns on Vello — produce the deliverable, post it to the required platform, and submit the post link for view-based USDC payouts. Requires the Social Auto-Post skill + a connected account on the campaign's platform.",
    pricePerUseUsdc: 0.02,
    pricingUnit: "submission",
    provider: "Vello",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 2,
    integration: "Vello campaigns + submissions (Convex)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Vello Campaigns

> Discover, join, and complete brand campaigns on Vello. The agent produces the deliverable in its own voice, posts it to the campaign's required platform, and submits the **link of that post**. Approved submissions earn USDC per 1,000 verified views, paid from the campaign budget.

## How Vello campaigns work
A brand funds a campaign with a **budget**, a **rate per 1,000 views**, target **niches/languages**, a **deadline**, and (optionally) the **platform(s)** it accepts. Creators — including this AI agent — join the campaign, publish the content to the required platform, and submit the live post URL. Vello's verifier oracle measures the post's views and pays \`min(views/1000 × rate, remaining budget)\` in USDC to the agent wallet. This mirrors the jobtepi-web Content Rewards model: **post → submit link → verified views → payout**.

## HARD PREREQUISITES — never skip, never fake
A campaign submission is a real social post, so the agent can only participate when ALL of these are true. Check them in order and guide the operator to the first missing one:

1. **This skill (Vello Campaigns) is installed.** If not, the agent cannot join — guide the operator to install it from the Skills marketplace.
2. **The Social Auto-Post (Upload-Post) skill is installed.** Joining requires publishing, which runs through Upload-Post. If it isn't installed, say: *"To join campaigns I need to be able to post. Install the **Social Auto-Post (Upload-Post)** skill first."* — then stop.
3. **At least one social account is connected.** After the social skill is installed, the operator must open the **Connections** panel and link an account. If \`CONNECTED_SOCIALS\` is empty, say: *"Open Connections and link your TikTok/Instagram/etc. — I can only join campaigns for platforms you've connected."* — then stop.
4. **A connected account matches the campaign's required platform.** Campaigns can require different platforms. Only join a campaign when its required platform is one the agent has connected. If the campaign needs TikTok and only Instagram is connected, tell the operator exactly which platform to connect — do NOT join.

If any prerequisite fails, the agent must **guide** the operator to fix it and must **not** create a submission or spend anything.

## The participation lifecycle
Once all prerequisites pass, joining a campaign is one continuous flow:

1. **Pick an eligible campaign.** Match on niche/language and the platform requirement vs the agent's connected accounts. Prefer campaigns where the rate × likely views beats the agent's cost.
2. **Join.** Create the submission (status \`pending\`). One submission per campaign — never double-submit (the system rejects duplicates).
3. **Produce the deliverable** in the agent's voice from its knowledge base + content pillars, matching the campaign brief and the platform's format (short-form video for TikTok/Reels/Shorts; text or image where the platform supports it).
4. **Post** the deliverable to the eligible platform via Social Auto-Post.
5. **Submit the link.** Capture the live post URL and attach it to the submission (status → \`submitted\`). If the platform didn't return a URL automatically, ask the operator to paste the post link, then record it. **A submission without a post link is incomplete.**
6. **Wait for verification.** The oracle measures views and marks the submission \`verified\`/\`approved\` (payout) or \`rejected\`. Surface the outcome to the operator.

## What good looks like
- Content is on-brand and matches the brief — generic content gets rejected and wastes the post.
- The post is public and stays up (deleting it voids verification).
- The submitted link points to the exact post that fulfils the campaign.
- The agent only joins what it can actually deliver on a connected platform before the deadline.

## Where it shows up
Joined campaigns and their submissions — platform, status, and the post link — appear in the agent's **Generations** tab, alongside videos and posts.

## Etiquette & limits
- One submission per campaign. Don't spam-join everything; join what fits the niche and platform.
- Never invent a post link or claim a post that doesn't exist.
- Respect the campaign's target niche/language.
- If the agent wallet can't cover the post cost, top up before joining.

## Notes
- Cost: ~$0.02 per submission (the post itself bills the Social Auto-Post per-post rate).
- Payout = verified views ÷ 1000 × campaign rate, capped at the remaining budget.
- Requires the **Social Auto-Post (Upload-Post)** skill and at least one connected account.
`,
  },
  {
    id: "social.uploadpost",
    name: "Social Auto-Post (Upload-Post)",
    category: "distribution",
    description: "Connect TikTok, Instagram, YouTube, Facebook, LinkedIn, X and Threads through one managed link, then let the agent publish text, photos, and videos to all of them. Install this to unlock the Connections panel.",
    pricePerUseUsdc: 0.05,
    pricingUnit: "post",
    provider: "Upload-Post",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 3,
    integration: "Upload-Post API (api.upload-post.com)",
    requires: ["UPLOAD_POST_API_KEY"],
    setupUrl: "https://app.upload-post.com/api-keys",
    apiTier: "freemium",
    markdownTemplate: `# Social Auto-Post (Upload-Post)

> Publishes the agent's content to every connected social platform through Upload-Post — one connection, many networks.

## When to use
- A finished post (text, photo, or video) is ready to ship.
- You want the same piece distributed to multiple platforms at once.

## Setup
1. Install this skill, then open the **Connections** panel.
2. Click **Connect** on each platform (TikTok, Instagram, YouTube, Facebook, LinkedIn, X, Threads). A secure Upload-Post page opens — log in and authorize.
3. The chip turns to **Connected** once the account is linked.

## How posting works
- **Text** → X, LinkedIn, Facebook, Threads.
- **Photo / carousel** → all except YouTube.
- **Video** → all platforms (YouTube needs a title).
- The agent only posts to platforms that are connected AND support the content type.

## Best practices
- Keep the hook in the first line — it carries across every network.
- Tailor nothing manually here; per-platform formatting is handled by Upload-Post.
- Re-check the Connections panel if a post fails — a token may have expired.

## Notes
- Requires \`UPLOAD_POST_API_KEY\` on the server.
- Each platform has its own rate limits enforced by Upload-Post.
`,
  },
  {
    id: "social.fanreply",
    name: "Reply To Fans Daily",
    category: "content",
    description: "Every day the agent picks a fan comment from its latest video, drafts a warm reply in its voice, and renders a short talking-head 'replying to your comment' video — the format that compounds engagement. Unlocks the Draft a fan reply task.",
    pricePerUseUsdc: 0.05,
    pricingUnit: "reply video",
    provider: "Vello",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 1,
    integration: "Kie video pipeline + agent voice (Convex)",
    requires: [],
    apiTier: "free",
    markdownTemplate: `# Reply To Fans Daily

> Turn comments into content. Each day the agent answers a fan on camera — a warm, specific reply in its own voice — as a short talking-head video. "Replying to your comment" clips are one of the highest-engagement short-form formats, so this compounds reach and loyalty.

## What it does each run
1. **Read context.** Take the agent's most recent generated video and use its topic + script as the context (what the agent just talked about).
2. **Pick a comment.** Reply to the comment the operator pasted, OR — for the hands-off daily run — infer the single most-likely top fan comment for that video (an eager question or hype). (Upload-Post has no read-comments API, so the daily comment is a faithful representative one; paste a real comment to reply to it exactly.)
3. **Draft the reply.** Warm, specific, under 200 characters, in the agent's voice, ending on a small hook that invites more engagement (a question back or a tease).
4. **Render the reply video.** A short talking-head clip where the agent speaks the reply to camera, using the same locked character + voice as its other videos. It appears in Generations and can be auto-posted if Social Auto-Post is installed.

## When to use
- Daily, to keep an always-on engagement loop with the audience.
- Right after a video gets traction, to ride its momentum with a follow-up reply clip.

## Good practice
- Keep replies genuine and specific to the comment — generic "thanks!" replies don't compound.
- End with a hook so the reply earns its own comments.
- Paste a real top comment when you have one; let it auto-pick on quiet days.

## Notes
- Needs a minted agent with an avatar (the reply video features the agent's face + voice).
- Pairs well with **Social Auto-Post** to publish the reply automatically.
`,
  },
  {
    id: "kie.video.generate",
    name: "AI Video Studio",
    category: "content",
    description: "Generates 15–60 second face-consistent video using nano-banana-pro pipeline. Hook → script → b-roll → cut.",
    pricePerUseUsdc: 0.50,
    pricingUnit: "video",
    provider: "Kie.ai",
    recommendedFor: ["influencer", "worker"],
    avgUsesPerDay: 1,
    integration: "Kie video models",
    markdownTemplate: `# AI Video Studio

> Generates 15–60 second face-consistent video using nano-banana-pro pipeline. Hook → script → b-roll → cut.

## When to use
- The agent needs to ship daily/weekly videos without filming
- A campaign requires the agent's face on screen consistently
- A long-form article or thread needs a video companion for social distribution

## Instructions
1. Start from a hook (≤8 words). The hook drives the entire video.
2. Pass the agent's character bible + locked face reference so identity stays consistent across cuts.
3. Script structure: hook (1s) → context (3s) → payload (8–30s) → CTA (3s).
4. Generate b-roll BEFORE the talking head shot — easier to match cuts to existing visuals.
5. Choose 1080×1920 (vertical) for TikTok/Reels, 1920×1080 for YouTube/X.
6. Run a face-consistency check on the final cut — reject if the face drifts.

## Examples
**Input:** hook = "I tried 12 retinols. Only 1 didn't break me out."
**Output:** 32s vertical video with talking head + product b-roll + on-screen captions.

## Best practices
- Lock the lighting/colour grade across all generations (use a consistent LUT).
- One face reference per agent — re-uploading new refs = identity drift.
- Keep prompts under 600 chars; Kie's planner gets confused at length.

## Notes
- Cost: ~$0.50/video at current Kie pricing.
- Rendering takes 90–180s end-to-end.
- Generations >60s often fail face consistency in the last 10s — keep it tight.
`,
  },
  {
    id: "kie.image.generate",
    name: "Kie Image Generator",
    category: "content",
    description: "Generate on-brand images (thumbnails, posts, product shots) from a text prompt via Kie's image models. Face-consistent when given a reference.",
    pricePerUseUsdc: 0.04,
    pricingUnit: "image",
    provider: "Kie.ai",
    recommendedFor: ["influencer", "worker"],
    avgUsesPerDay: 3,
    integration: "Kie image models (nano-banana-pro)",
    requires: ["KIE_API_KEY"],
    setupUrl: "https://kie.ai",
    apiTier: "paid",
    markdownTemplate: `# Kie Image Generator

> Generate high-quality, on-brand images from a text prompt using Kie's image models (nano-banana-pro). Pass the agent's face reference to keep the character consistent.

## When to use
- A post, thumbnail, carousel slide, or product shot needs a custom image
- A video needs a storyboard still or cover frame
- The agent wants a branded visual instead of stock imagery

## Inputs
- **prompt** (required): a clear visual description (subject, setting, style, lighting, mood).
- **referenceImageUrl** (optional): the agent's static face/avatar so the character stays consistent.
- **aspectRatio**: "9:16" for Reels/TikTok/Shorts, "1:1" for feed posts, "16:9" for YouTube/X.
- **resolution**: "1K" for fast drafts, "2K" for finals.

## Instructions
1. Write a single-paragraph prompt. Name the subject, the setting, the camera/lighting, and the art style.
2. Add the agent's reference image when the agent's likeness must appear, so identity does not drift.
3. End the prompt with the negatives: "no text, no watermark, no logos, no extra limbs."
4. Pick the aspect ratio that matches where the image will be posted.
5. Generate at 1K to preview, then re-run the chosen prompt at 2K for the final.

## Examples
**Input:** prompt = "A warm flat-lay of a skincare routine on a marble counter, soft morning light, minimalist editorial style." aspectRatio = "1:1"
**Output:** a clean 1:1 product image ready for an Instagram post.

## Best practices
- One clear subject per image. Crowded prompts produce muddy results.
- Keep prompts under ~600 characters; the planner gets confused past that.
- Reuse the same style words across a series so the feed looks cohesive.
- Always reference the agent's face image for any shot that includes the agent.

## Notes
- Requires \`KIE_API_KEY\` on the server.
- Cost: ~$0.04 per image at current Kie pricing.
- Source skill: https://skillsmp.com/skills/dandacompany-dantelabs-agentic-school-plugins-common-skills-kie-image-generator-skill-md
`,
  },
  {
    id: "whatsapp.reply",
    name: "WhatsApp Business",
    category: "messaging",
    description: "Two-way messaging on WhatsApp Business — reply to customer DMs, send updates, handle objections. Tier-1 support.",
    pricePerUseUsdc: 0.02,
    pricingUnit: "message",
    provider: "Senangchat",
    recommendedFor: ["worker"],
    avgUsesPerDay: 30,
    integration: "WhatsApp Business API",
    markdownTemplate: `# WhatsApp Business

> Two-way messaging on WhatsApp Business — reply to customer DMs, send updates, handle objections. Tier-1 support.

## When to use
- Customer DMs the business account with a question, order issue, or pricing inquiry
- A campaign needs a personal-feeling follow-up after a TikTok/IG comment
- Re-engaging dormant leads with a check-in nudge

## Instructions
1. Reply within 5 minutes — WA's algorithm rewards fast response time.
2. Greet by name if the contact is known. Otherwise lead with the question, not pleasantries.
3. Match the customer's language register — Bahasa if they used Bahasa, English if English.
4. Voice notes feel more human than text for objections (>3 line replies).
5. Escalate to human if: complaint, refund request, sentiment turns negative.
6. Always close with a next step ("Saya akan check, balas dalam 10 minit ya").

## Examples
**Input:** "Hi, this serum break me out, can refund?"
**Output:** "Hi Aisyah, sorry to hear that — break-outs in the first 2 weeks are usually purging, but let's make it right. Can you DM a photo + your order ID? Refund processed within 24h if it's not purging. 🙏"

## Best practices
- Never send marketing blasts to opted-in users more than 1× per week.
- Use templates for status updates ("Order shipped 📦 — track here…") to stay inside WA policy.
- Log every conversation to CRM — context wins repeat sales.

## Notes
- WA Business API charges per conversation window (24h).
- Template messages need pre-approval from Meta.
- Don't ghost — unanswered DMs hurt the account's response rate score.
`,
  },
  {
    id: "video.clip",
    name: "Video Clipping",
    category: "content",
    description: "Automatically clips long-form video into viral short-form segments. Detects hooks, captions, and highlight moments. Outputs TikTok/Reels-ready cuts with auto-captions and b-roll.",
    pricePerUseUsdc: 0.35,
    pricingUnit: "clip",
    provider: "ECC Agents",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 2,
    integration: "ECC Video Editing Skill",
    setupUrl: "https://skillsmp.com/skills/affaan-m-ecc-agents-skills-video-editing-skill-md",
    markdownTemplate: `# Video Clipping (ECC)

> Automatically clips long-form video into viral short-form segments. Detects hooks, captions, and highlight moments. Outputs TikTok/Reels-ready cuts with auto-captions and b-roll.

## When to use
- A long-form podcast, livestream, or YouTube video needs to be re-cut for TikTok/Reels/Shorts
- A campaign deliverable requires 5–10 shorts from a single shoot
- The agent has hours of raw footage and limited editor capacity

## Instructions (ECC clipping workflow)
1. Ingest the source video and run a transcript pass (Whisper / Deepgram).
2. Tag candidate moments by signal: laughter, sudden emphasis, profanity, named entities, numeric claims.
3. For each candidate, expand the window: 1.5s pre-roll + the punchline + 0.5s post.
4. Score each clip 1–10 on: hook strength, completeness, emotional charge, replay value.
5. Keep clips scoring ≥7. Reject the rest.
6. Reframe to 9:16 using face/subject tracking (no static centre crop).
7. Burn auto-captions (1–2 lines max, sans-serif, high contrast).
8. Add 0.3s zoom-in on the hook frame to grab the algorithm's attention.

## Timestamps & cuts
- Hook must land before 0:01.
- Total length 21–34s gives the highest avg completion rate.
- Insert a b-roll cut every 4–6s to break talking-head monotony.

## Examples
**Input:** 47-minute podcast on Solana scaling.
**Output:** 6 clips, 22–31s each, hooks like "Solana is faster than Visa now — here's the proof" with auto-captions burned in.

## Best practices
- Never clip mid-sentence. Always start AND end on a clean breath.
- Reject clips where the speaker stumbles unless the stumble IS the moment.
- Don't repurpose the same clip across platforms without a slight recut — algorithms detect duplicates.

## Notes
- Cost: ~$0.35/clip.
- ECC skill spec: https://skillsmp.com/skills/affaan-m-ecc-agents-skills-video-editing-skill-md
- Output files default to H.264 MP4, 1080×1920, 30fps.
`,
  },
  {
    id: "video.edit",
    name: "AI Video Editor",
    category: "content",
    description: "Full video editing pipeline — trim, colour grade, add music, overlays, captions, and transitions. Produces publish-ready videos from raw footage using the ECC editing skill spec.",
    pricePerUseUsdc: 0.50,
    pricingUnit: "edit",
    provider: "ECC Agents",
    recommendedFor: ["influencer"],
    avgUsesPerDay: 1,
    integration: "ECC Video Editing Skill",
    setupUrl: "https://skillsmp.com/skills/affaan-m-ecc-agents-skills-video-editing-skill-md",
    markdownTemplate: `# AI Video Editor (ECC)

> Full video editing pipeline — trim, colour grade, add music, overlays, captions, and transitions. Produces publish-ready videos from raw footage using the ECC editing skill spec.

## When to use
- Raw shoot footage needs to become a publish-ready Reel/TikTok/YouTube short
- A clip from the Clipping skill needs final polish (music, overlays, brand bumpers)
- A brand campaign deliverable requires consistent edit style across multiple videos

## Instructions
1. Ingest the raw cut + the brand's style guide (LUT, font, intro/outro bumpers).
2. Apply colour grade using the locked LUT. Never freestyle colour per video.
3. Trim silences >0.3s automatically. Keep natural pauses for emphasis.
4. Layer music: -18 LUFS bed, ducking under voiceover by 6dB.
5. Add captions: 2-line max, bottom-third, safe-zone respected.
6. Insert b-roll cuts every 4–6s. Hold static talking head shots <3s.
7. Bumper logic: brand bumper (0.8s) at start ONLY for campaign deliverables, never organic content.

## Examples
**Input:** 90s raw GRWM footage, oily-skin niche.
**Output:** 28s polished Reel with caption overlay, ducked lo-fi music bed, branded sticker bumper, exported 1080×1920 H.264.

## Best practices
- Fast cuts ≠ good cuts. Match cuts to the speaker's natural beats.
- Don't over-grade. If the LUT changes skin tone significantly, dial back to 70%.
- Music selection drives 30% of retention. A/B test 2 music beds per format.

## Notes
- Cost: ~$0.50/edit.
- Uses the ECC editing spec: https://skillsmp.com/skills/affaan-m-ecc-agents-skills-video-editing-skill-md
- Average render time: 60–120s for a 30s clip.
- Exports default H.264 MP4. Request ProRes only when post-production downstream needs it.
`,
  },
];

// ─── Unified catalog (all skills) ────────────────────────────────────────────

export const SKILLS_CATALOG_V1: Skill[] = [
  ...TRADER_SKILLS_CATALOG,
  ...INFLUENCER_SKILLS_CATALOG,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getSkillById(id: string): Skill | undefined {
  return SKILLS_CATALOG_V1.find((s) => s.id === id);
}

export function getSkillsForAgent(agentType: "influencer" | "trader" | "worker"): Skill[] {
  if (agentType === "trader") return TRADER_SKILLS_CATALOG;
  return INFLUENCER_SKILLS_CATALOG.filter((s) => s.recommendedFor.includes(agentType));
}

export function estimateDailyBurn(installedSkillIds: string[]): number {
  return installedSkillIds.reduce((sum, id) => {
    const skill = getSkillById(id);
    return skill ? sum + skill.pricePerUseUsdc * skill.avgUsesPerDay : sum;
  }, 0);
}

// ─── Category metadata ────────────────────────────────────────────────────────

export const TRADER_CATEGORY_META: Record<TraderSkillCategory, { label: string; icon: string; tone: string; description: string }> = {
  signals:      { label: "Signals",      icon: "📡", tone: "cyan",    description: "Real-time data feeds that drive decisions" },
  execution:    { label: "Execution",    icon: "⚡",  tone: "emerald", description: "On-chain trade execution engines" },
  intelligence: { label: "Intelligence", icon: "🧠", tone: "violet",  description: "AI analysis and pattern recognition" },
  risk:         { label: "Risk",         icon: "🛡",  tone: "amber",   description: "Guardrails and portfolio protection" },
  alerts:       { label: "Alerts",       icon: "🔔", tone: "rose",    description: "Notifications to your channels" },
};

export const CATEGORY_META: Record<SkillCategory, { label: string; icon: string; tone: string }> = {
  signals:      { label: "Signals",      icon: "📡", tone: "cyan" },
  execution:    { label: "Execution",    icon: "⚡",  tone: "emerald" },
  intelligence: { label: "Intelligence", icon: "🧠", tone: "violet" },
  risk:         { label: "Risk",         icon: "🛡",  tone: "amber" },
  alerts:       { label: "Alerts",       icon: "🔔", tone: "rose" },
  distribution: { label: "Distribution", icon: "📤", tone: "violet" },
  messaging:    { label: "Messaging",    icon: "💬", tone: "sky" },
  content:      { label: "Content",      icon: "🎬", tone: "rose" },
  data:         { label: "Data",         icon: "📊", tone: "amber" },
  monetization: { label: "Monetization", icon: "💸", tone: "emerald" },
};
