export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "list"; items: string[] }
  | { type: "links"; items: { label: string; href: string }[] };

export type BlogFaq = { q: string; a: string };

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  /** Short label shown on the cover and in the index. */
  category: "Guide" | "Explainer" | "Solana" | "AI video";
  date: string; // ISO
  updated?: string; // ISO
  readMinutes: number;
  keywords: string[];
  content: BlogBlock[];
  faq?: BlogFaq[];
  /** Slugs of related posts, shown under the article. */
  related?: string[];
};

const CTA_LINKS: BlogBlock = {
  type: "links",
  items: [
    { label: "Create your AI influencer", href: "/create" },
    { label: "Explore viral video references", href: "/explore" },
    { label: "Browse live influencer markets", href: "/market" },
  ],
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "what-is-solcameo-cameo-for-solana",
    title: "What Is Solcameo? The Cameo for Solana, Powered by AI Influencers",
    description:
      "Solcameo is where AI influencers live on Solana: each one has a face, a voice, its own wallet and its own token. Here is what it is, how it works and who it is for.",
    category: "Explainer",
    date: "2026-09-02",
    readMinutes: 6,
    keywords: ["Solcameo", "Cameo for Solana", "AI influencers on Solana", "Solana creator platform"],
    content: [
      { type: "p", text: "Cameo made it normal to pay for a personal video from someone with an audience. Solcameo takes the same idea and rebuilds it for Solana: instead of waiting on a human to record a clip, you create an AI influencer that can make videos on demand, post them, hold its own money and carry its own token." },
      { type: "h2", text: "The short version" },
      { type: "p", text: "A Solcameo influencer is an AI character with a consistent face and personality. It has a Solana wallet of its own, can render short videos from prompts or from viral reference clips, can post to X, and can be launched as a token that anyone can trade on a bonding curve." },
      { type: "h2", text: "What you get when you create one" },
      {
        type: "list",
        items: [
          "A character: upload a portrait and the agent keeps that identity across every video.",
          "An agent wallet: a real Solana wallet that holds USDC and SOL and pays for video generation.",
          "A token (optional): launched through Meteora's Dynamic Bonding Curve, so there is a live market from the first minute.",
          "A builder: one place to generate videos, schedule posts, edit clips and connect your social accounts.",
        ],
      },
      { type: "h2", text: "Why Solana" },
      { type: "p", text: "Solana is fast and cheap enough that an AI agent can pay for things itself, in small amounts, many times a day. A video render that costs a few dollars can be paid from the agent's own wallet in USDC, and a token trade settles in about a second. That is what makes an agent that earns, spends and trades practical rather than a demo." },
      { type: "h2", text: "Who it is for" },
      {
        type: "list",
        items: [
          "Creators who want a faceless or AI-fronted channel that keeps posting without filming.",
          "Crypto teams that need a mascot or spokesperson with real video output.",
          "Traders and collectors who want to hold a stake in an AI character they believe will grow.",
        ],
      },
      { type: "h2", text: "How it is different from a normal AI avatar tool" },
      { type: "p", text: "Most avatar tools stop at the video file. Solcameo adds the economy around it: a wallet, a token, a market page, creator fees and a public leaderboard. The influencer is a small business, not just a render." },
      CTA_LINKS,
    ],
    faq: [
      { q: "Is Solcameo the same company as Cameo?", a: "No. Solcameo is an independent project built on Solana. The name is a nod to the idea of paying for personal videos from people with an audience." },
      { q: "Do I need a token to use it?", a: "No. You can create an influencer and make videos without launching a token. The token is optional." },
      { q: "What do videos cost?", a: "The price depends on the model, length and quality you pick, and it is shown before you generate. It is paid in USDC from the agent's wallet." },
    ],
    related: ["ai-influencers-on-solana-explained", "how-to-launch-an-ai-influencer-token-on-solana", "cameo-alternative-for-crypto-creators"],
  },
  {
    slug: "ai-influencers-on-solana-explained",
    title: "AI Influencers on Solana, Explained: Agents With Wallets, Tokens and Followers",
    description:
      "What an AI influencer on Solana really is, why wallets and tokens change the model, and what to look for before you create or buy into one.",
    category: "Solana",
    date: "2026-09-05",
    readMinutes: 7,
    keywords: ["AI influencers on Solana", "AI agents Solana", "crypto AI influencer", "AI character token"],
    content: [
      { type: "p", text: "An AI influencer is a character that is generated rather than filmed: the face, the voice and the videos all come from models. That part is not new. What is new on Solana is giving that character a wallet and a token, so it can earn, pay and be owned in the open." },
      { type: "h2", text: "From avatar to agent" },
      { type: "p", text: "An avatar is a picture or a rendered clip. An agent decides what to make and acts on it: it picks a topic, writes the prompt, pays for the render, posts the result and records what happened. On Solcameo each influencer is an agent with its own wallet, so those actions leave an on-chain trail." },
      { type: "h2", text: "Why a wallet matters" },
      {
        type: "list",
        items: [
          "It can pay for its own work. Video generation is paid in USDC from the agent's wallet, so the cost is visible and capped by what the wallet holds.",
          "It can receive money. Tips, campaign payouts and fees can land in the same wallet.",
          "It is auditable. Anyone can read the balance and the transactions on Solscan.",
        ],
      },
      { type: "h2", text: "Why a token matters" },
      { type: "p", text: "A token turns an audience into stakeholders. If the influencer grows, early supporters hold something that can reflect that. It also gives the creator a revenue line through trading fees. It also adds risk: a token can fall as easily as it rises, and nothing here is financial advice." },
      { type: "h2", text: "What to check before you buy or build" },
      {
        type: "list",
        items: [
          "Is the token on a transparent curve with locked supply, or a plain mint with a large team wallet?",
          "Does the influencer actually publish? Look at the videos and the post history, not the chart.",
          "Who controls the agent wallet, and what does it pay for?",
          "How are creator fees split, and can you verify it on-chain?",
        ],
      },
      { type: "h2", text: "Where to start" },
      { type: "p", text: "The fastest way to understand the model is to create one, make a first video and look at its market page. You can do all of that without launching a token." },
      CTA_LINKS,
    ],
    faq: [
      { q: "Are AI influencers on Solana safe to buy?", a: "Tokens are volatile and can lose all their value. Read how the curve and supply work, check that the influencer publishes real content, and only risk what you can afford to lose. This is not financial advice." },
      { q: "Can an AI influencer really pay for itself?", a: "It can pay for its own video generation from its wallet as long as the wallet holds USDC or SOL. If the balance runs out, generation stops until it is topped up." },
    ],
    related: ["what-is-solcameo-cameo-for-solana", "agent-wallets-on-solana-usdc-sol-and-swaps", "how-ai-influencers-earn-creator-fees-on-solana"],
  },
  {
    slug: "how-to-launch-an-ai-influencer-token-on-solana",
    title: "How to Launch an AI Influencer Token on Solana, Step by Step",
    description:
      "A plain walkthrough of creating an AI influencer, funding it and launching its token on a Meteora bonding curve, including what it costs and what can go wrong.",
    category: "Guide",
    date: "2026-09-09",
    readMinutes: 7,
    keywords: ["launch token on Solana", "Solana token launch guide", "Meteora bonding curve launch", "create AI influencer"],
    content: [
      { type: "p", text: "Launching a token for an AI influencer takes a few minutes, but the order of the steps matters. This is the path Solcameo uses, from first portrait to a live market." },
      { type: "h2", text: "1. Create the character" },
      { type: "p", text: "Pick a name, a ticker and a portrait. The portrait is the reference the agent keeps for every video, so choose a clear, front-facing image. You can write a short personality and niche so its posts stay on topic." },
      { type: "h2", text: "2. Check what you will pay" },
      { type: "p", text: "Launching creates accounts on Solana, and those need a small amount of SOL as rent. Solcameo shows an itemised cost before you launch and your live wallet balance beside it, and takes no launch fee of its own. Keep a little more SOL than the total as a buffer." },
      { type: "h2", text: "3. Launch" },
      { type: "p", text: "The launch is two transactions: one creates the curve configuration, the second creates the pool, the token mint and its metadata. If something is interrupted, pressing Launch again resumes without paying for the first part twice." },
      { type: "h2", text: "4. Fund the agent wallet" },
      { type: "p", text: "The influencer needs money to work. Send USDC to its wallet, or send SOL and let it swap to USDC when a video needs paying for. The deposit dialog on the Explore page and in the builder handles both." },
      { type: "h2", text: "5. Make the first video" },
      { type: "p", text: "Open Explore, pick a viral reference or describe your own video, choose the model and length, and generate. The price is shown first and is charged from the agent wallet." },
      { type: "h2", text: "What can go wrong" },
      {
        type: "list",
        items: [
          "Not enough SOL: the launch will stop with a clear message and nothing is lost. Add SOL and press Launch again.",
          "Network congestion: Solcameo adds a priority fee and re-sends the transaction while it waits for confirmation.",
          "Empty agent wallet: videos fail with a funding prompt. Deposit and retry.",
        ],
      },
      CTA_LINKS,
    ],
    faq: [
      { q: "How much SOL do I need to launch?", a: "The exact amount is shown before you launch because it follows current Solana rent costs. Plan for a few hundredths of a SOL plus a buffer." },
      { q: "Can I launch without a token?", a: "Yes. You can create an influencer and make videos first and launch a token later." },
    ],
    related: ["meteora-dynamic-bonding-curve-explained", "solana-token-launchpad-guide-for-creators", "agent-wallets-on-solana-usdc-sol-and-swaps"],
  },
  {
    slug: "meteora-dynamic-bonding-curve-explained",
    title: "Meteora Dynamic Bonding Curve Explained for Token Creators",
    description:
      "How a bonding curve prices a new Solana token, what happens when it graduates to a full pool, and why Solcameo launches on Meteora's DBC.",
    category: "Solana",
    date: "2026-09-12",
    readMinutes: 6,
    keywords: ["Meteora Dynamic Bonding Curve", "Meteora DBC", "bonding curve Solana", "DAMM v2 graduation"],
    content: [
      { type: "p", text: "A bonding curve is a rule that sets a token's price from how much of it has been sold. Early buyers pay less, later buyers pay more, and the market exists from the first block because the curve itself is the counterparty." },
      { type: "h2", text: "Why not just add liquidity" },
      { type: "p", text: "Traditional launches need someone to seed a pool and set a starting price, which is where many launches go wrong. On a bonding curve the starting price and the way it rises are written into the configuration before anything trades." },
      { type: "h2", text: "What Meteora's DBC adds" },
      {
        type: "list",
        items: [
          "Configurable curves: the creator sets the supply, the migration size and how steep the price climbs.",
          "Trading fees that can be shared between the creator and the platform.",
          "Anti-sniper settings that make the first seconds less profitable for bots.",
          "A built-in path to a normal pool once the curve is full.",
        ],
      },
      { type: "h2", text: "Graduation to DAMM v2" },
      { type: "p", text: "When enough has been bought, the curve is complete and the liquidity migrates into a Meteora DAMM v2 pool. From then on the token trades like any other pair, and fees continue to accrue to the pool's liquidity owners." },
      { type: "h2", text: "Locked and vested supply" },
      { type: "p", text: "A token is easier to trust when team and reserve supply cannot be sold at once. Solcameo launches use locked vesting for the creator allocation, so those tokens unlock over time instead of on day one." },
      { type: "h2", text: "What to check on any curve" },
      {
        type: "list",
        items: [
          "How much supply goes to the curve, how much to the team, and how much is locked.",
          "The migration threshold, which is how much has to be bought before the pool opens.",
          "Who can claim trading fees and how they are split.",
        ],
      },
      CTA_LINKS,
    ],
    faq: [
      { q: "Is a bonding curve launch safer than a normal launch?", a: "It removes the need to seed liquidity by hand and makes the price rule public, but the token can still lose value. Always read the supply and vesting settings." },
      { q: "What is DAMM v2?", a: "It is Meteora's dynamic automated market maker. A token that completes its bonding curve migrates into a DAMM v2 pool." },
    ],
    related: ["how-to-launch-an-ai-influencer-token-on-solana", "solana-token-launchpad-guide-for-creators", "how-ai-influencers-earn-creator-fees-on-solana"],
  },
  {
    slug: "solana-token-launchpad-guide-for-creators",
    title: "Solana Token Launchpads: A Creator's Guide to Picking One",
    description:
      "What a launchpad does, what to compare (fees, curve design, anti-bot protection, what happens after launch) and where Solcameo fits for AI creators.",
    category: "Guide",
    date: "2026-09-16",
    readMinutes: 6,
    keywords: ["Solana token launchpad", "best Solana launchpad", "launch a token on Solana", "creator token launch"],
    content: [
      { type: "p", text: "A launchpad packages the awkward parts of issuing a token: creating the mint, setting up the market, adding metadata and showing it to traders. The differences between them show up in the details." },
      { type: "h2", text: "What to compare" },
      {
        type: "list",
        items: [
          "Launch cost: the rent for the accounts is unavoidable, but some platforms add their own fee on top.",
          "Curve design: how supply is split, how steep the price rises and what the migration target is.",
          "Protection: anti-sniper rules and locked team supply.",
          "Fees: how trading fees are shared between the creator and the platform, and whether you can claim them yourself.",
          "After launch: is there a market page, a leaderboard, a way to keep the token in front of people?",
        ],
      },
      { type: "h2", text: "What makes AI creators different" },
      { type: "p", text: "A normal token launch is a moment. An AI influencer is a stream of content, which gives the token something to point at every day: new videos, new posts, a wallet you can watch. A launchpad built for them should make content and market live together." },
      { type: "h2", text: "Where Solcameo fits" },
      { type: "p", text: "Solcameo launches on Meteora's Dynamic Bonding Curve, charges no launch fee of its own, ties each token to an agent that makes videos, and shows every launch on a public market page with live data." },
      { type: "h2", text: "A simple decision rule" },
      { type: "p", text: "Pick the launchpad where you can explain, in two sentences, how the supply is split and how fees are shared. If that is hard to find out, treat it as a warning." },
      CTA_LINKS,
    ],
    faq: [
      { q: "Does Solcameo take a fee to launch?", a: "No launch fee. You pay Solana's account rent, which is itemised before you launch." },
      { q: "Can I use a different launchpad for my AI influencer?", a: "The agent and wallet work independently of the token, but the market page and creator fees are built around launches on Solcameo." },
    ],
    related: ["meteora-dynamic-bonding-curve-explained", "how-to-launch-an-ai-influencer-token-on-solana", "ai-influencers-on-solana-explained"],
  },
  {
    slug: "ai-video-generation-for-crypto-creators",
    title: "AI Video Generation for Crypto Creators: Prompts, Motion Transfer and Cost",
    description:
      "How to make short videos with an AI character: describing a scene, copying motion from a viral clip, choosing a model and knowing the price before you generate.",
    category: "AI video",
    date: "2026-09-19",
    readMinutes: 7,
    keywords: ["AI video generation", "AI character video", "motion transfer", "Higgsfield Genjutsu", "crypto content creator"],
    content: [
      { type: "p", text: "Short video is how most crypto audiences find new projects. AI generation lets a small team ship that video every day without a camera. There are two routes: describe the scene, or copy the motion of a clip that already works." },
      { type: "h2", text: "Route 1: describe the video" },
      { type: "p", text: "Write what should happen in plain language. Mention the setting, the action and the mood. Keep it to one idea per clip. You can tag another agent to bring a second character into the scene." },
      { type: "h2", text: "Route 2: copy motion from a viral reference" },
      { type: "p", text: "Explore lists viral clips by category: dance, movie, comedy, sports and more. Pick one and the model transfers its movement onto your character, so you get a proven format with your own face and identity." },
      { type: "h2", text: "Picking a model" },
      {
        type: "list",
        items: [
          "Genjutsu models transfer motion from a reference clip or swap an object in it.",
          "Image-to-video models such as Grok Imagine, Veo, Seedance and Gemini Omni follow your prompt starting from your character's image.",
          "Longer clips and higher quality cost more. The price is shown on the button before you generate.",
        ],
      },
      { type: "h2", text: "What it costs" },
      { type: "p", text: "The price is the provider's cost plus a small service fee and is charged in USDC from the agent's wallet. If the wallet holds only SOL, it can swap to USDC first. You never pay for a render that fails: it is refunded." },
      { type: "h2", text: "Tips that save money" },
      {
        type: "list",
        items: [
          "Start with short clips and a lower quality while you test an idea.",
          "Reuse formats that already perform instead of inventing new ones.",
          "Use Schedule on a reference to render it later instead of keeping a tab open.",
        ],
      },
      CTA_LINKS,
    ],
    faq: [
      { q: "What is motion transfer?", a: "It copies the movement from a reference video onto your own character, so the new clip follows the same choreography or action." },
      { q: "Are failed renders charged?", a: "No. If a render fails, the charge is refunded to the agent's balance." },
    ],
    related: ["solana-memecoin-marketing-with-ai-video", "agent-wallets-on-solana-usdc-sol-and-swaps", "what-is-solcameo-cameo-for-solana"],
  },
  {
    slug: "agent-wallets-on-solana-usdc-sol-and-swaps",
    title: "Agent Wallets on Solana: Funding With USDC or SOL and Swapping Between Them",
    description:
      "How an AI agent's wallet pays for video, why it keeps a little SOL for fees, and how to swap SOL to USDC (and back) with Jupiter at low slippage.",
    category: "Solana",
    date: "2026-09-23",
    readMinutes: 6,
    keywords: ["agent wallet Solana", "swap SOL to USDC", "Jupiter swap", "fund AI agent"],
    content: [
      { type: "p", text: "Every Solcameo influencer has its own Solana wallet. It pays for video generation from that wallet, so understanding what is in it, and in which token, saves failed jobs." },
      { type: "h2", text: "Two balances, two jobs" },
      {
        type: "list",
        items: [
          "USDC pays for generation. Prices are quoted in dollars.",
          "SOL pays Solana's network fees and the rent for new token accounts. The wallet keeps a small reserve for this.",
        ],
      },
      { type: "h2", text: "Ways to fund it" },
      {
        type: "list",
        items: [
          "Send USDC from your wallet. This is the simplest option.",
          "Send SOL. It will not pay for a video by itself, but the agent can swap just what it needs.",
          "Swap from your own wallet: pick SOL to USDC in the deposit dialog and the exact USDC amount you need arrives in the agent wallet in one transaction.",
        ],
      },
      { type: "h2", text: "Swapping inside the agent wallet" },
      { type: "p", text: "If the agent already holds SOL, you can swap it to USDC from the Swap tab, or the other way round. The server signs with the agent's key after checking that you own the agent, uses Jupiter for the best route and keeps slippage tight. The wallet always keeps enough SOL for fees." },
      { type: "h2", text: "Automatic top-up" },
      { type: "p", text: "If a video needs more USDC than the wallet has and it holds enough SOL, the agent swaps only the shortfall at the live price before charging. If it cannot, you get a message that says why instead of a silent failure." },
      { type: "h2", text: "Good habits" },
      {
        type: "list",
        items: [
          "Keep a few dollars of USDC above what you plan to spend.",
          "Leave at least 0.02 SOL in the wallet so swaps and fees always work.",
          "Check the balance on Solscan if anything looks off.",
        ],
      },
      CTA_LINKS,
    ],
    faq: [
      { q: "Why does my agent show SOL but videos still fail?", a: "Videos are priced in USDC. The agent needs enough SOL to swap the shortfall and still keep its fee reserve. Deposit more SOL or swap to USDC in the wallet." },
      { q: "Does swapping cost a fee?", a: "Solcameo adds no swap fee. You pay the route's pool fee and Solana's network fee." },
    ],
    related: ["ai-video-generation-for-crypto-creators", "ai-influencers-on-solana-explained", "how-to-launch-an-ai-influencer-token-on-solana"],
  },
  {
    slug: "how-ai-influencers-earn-creator-fees-on-solana",
    title: "How AI Influencers Earn on Solana: Creator Fees, Tips and Campaigns",
    description:
      "The ways an AI influencer can make money: trading fees from its token, tips and campaign payouts into its wallet, and what actually decides whether it grows.",
    category: "Solana",
    date: "2026-09-26",
    readMinutes: 6,
    keywords: ["creator fees Solana", "earn with AI influencer", "token trading fees", "AI influencer income"],
    content: [
      { type: "p", text: "An AI influencer can earn in several ways at once. None of them is guaranteed, and the common thread is the same: attention first, money second." },
      { type: "h2", text: "1. Trading fees from the token" },
      { type: "p", text: "When the token trades on its Meteora curve, a fee is taken on each trade and part of it goes to the creator. After the token graduates to a full pool, the creator can keep earning from the liquidity position. Fees accrue on-chain and can be claimed by the creator wallet." },
      { type: "h2", text: "2. Payments into the agent wallet" },
      { type: "p", text: "The agent has a normal Solana address. Tips, brand payments and campaign rewards can be sent straight to it, and anyone can verify them." },
      { type: "h2", text: "3. Campaigns" },
      { type: "p", text: "Brands can pay for content that gets views. An agent that posts consistently on X is easier to include in these campaigns than one that posts rarely." },
      { type: "h2", text: "What decides whether it works" },
      {
        type: "list",
        items: [
          "Consistency: a steady posting rhythm beats occasional bursts.",
          "A clear niche and character: people follow a point of view.",
          "Format fit: reuse video formats that already perform, then add your own twist.",
          "Cost control: if videos cost more than the agent earns, growth stalls. Watch the wallet.",
        ],
      },
      { type: "h2", text: "A realistic view" },
      { type: "p", text: "Most tokens earn little. Fees scale with trading volume, and volume follows attention. Treat earnings as a bonus on top of an audience you are building, not a plan." },
      CTA_LINKS,
    ],
    faq: [
      { q: "How do I claim creator fees?", a: "Connect the creator wallet and use the claim action on your influencer's page. The fee amount depends on the trading volume of your token." },
      { q: "Is income guaranteed?", a: "No. Earnings depend on trading activity and audience growth, and many tokens earn very little." },
    ],
    related: ["meteora-dynamic-bonding-curve-explained", "ai-influencers-on-solana-explained", "solana-memecoin-marketing-with-ai-video"],
  },
  {
    slug: "solana-memecoin-marketing-with-ai-video",
    title: "Solana Memecoin Marketing With AI Video: A Practical Playbook",
    description:
      "How a token team can use an AI character and short video to stay visible: formats that work, a weekly rhythm and how to measure it without chasing the chart.",
    category: "AI video",
    date: "2026-09-29",
    readMinutes: 7,
    keywords: ["Solana memecoin marketing", "crypto marketing video", "AI mascot", "X video strategy"],
    content: [
      { type: "p", text: "Most Solana tokens disappear because nobody is talking about them a week after launch. A mascot that posts a new video every day keeps a project in the feed without a production team." },
      { type: "h2", text: "Give the token a face" },
      { type: "p", text: "Create one character and keep it consistent: same portrait, same tone, same recurring jokes. Consistency is what turns a stream of clips into a recognisable account." },
      { type: "h2", text: "Four formats that fit" },
      {
        type: "list",
        items: [
          "Reaction: the character reacts to a market move or a headline in a few seconds.",
          "Trend swap: copy the motion of a viral clip and drop your character in.",
          "Explainer: one idea, one clip, such as how the curve works or why the supply is locked.",
          "Milestone: celebrate holders, a graduation or a new listing.",
        ],
      },
      { type: "h2", text: "A weekly rhythm" },
      {
        type: "list",
        items: [
          "Three short clips on X, one per two days.",
          "One longer or higher-quality piece for the key announcement.",
          "One reply thread where the character answers questions.",
        ],
      },
      { type: "h2", text: "Measure what you control" },
      { type: "p", text: "Views, saves and replies tell you if the content works. The price chart mixes in everything else in the market. Track the content first." },
      { type: "h2", text: "Stay honest" },
      { type: "p", text: "Do not promise returns, and label the character as AI-generated. Audiences forgive a joke and punish a lie, and platforms increasingly require disclosure." },
      CTA_LINKS,
    ],
    faq: [
      { q: "How many videos should I post?", a: "A steady three to five short clips a week beats a burst. Keep quality consistent and watch the cost in the agent wallet." },
      { q: "Do I need to disclose that it is AI?", a: "Yes, it is good practice and often required. Label AI-generated characters clearly." },
    ],
    related: ["ai-video-generation-for-crypto-creators", "how-ai-influencers-earn-creator-fees-on-solana", "what-is-solcameo-cameo-for-solana"],
  },
  {
    slug: "cameo-alternative-for-crypto-creators",
    title: "A Cameo Alternative for Crypto: Why Solcameo Uses AI and Solana",
    description:
      "Cameo sells personal videos from people. Solcameo gives you an AI character that makes videos on demand, with a wallet and a token. Here is how the two compare.",
    category: "Explainer",
    date: "2026-10-02",
    readMinutes: 5,
    keywords: ["Cameo alternative", "Cameo for crypto", "Cameo for Solana", "AI personalised video"],
    content: [
      { type: "p", text: "Cameo is a marketplace where fans pay a person for a short personal video. It is a good model, but it depends on one human's time. Solcameo keeps the idea of a creator you can request content from and replaces the bottleneck with an AI agent." },
      { type: "h2", text: "Side by side" },
      {
        type: "list",
        items: [
          "Who makes the video: on Cameo a person records it. On Solcameo the AI influencer renders it.",
          "Speed: a recorded cameo takes days. A render takes minutes.",
          "Price: a person sets a price per booking. On Solcameo the price is the render cost, shown before you generate.",
          "Ownership: Cameo has no token. A Solcameo influencer can have one, plus its own wallet.",
          "Scale: one person can only record so many videos. An agent can make many.",
        ],
      },
      { type: "h2", text: "What you give up" },
      { type: "p", text: "A real person brings authenticity and a real relationship. If you need a specific celebrity, Solcameo is not a substitute. It is for characters that are AI from the start." },
      { type: "h2", text: "When Solcameo fits better" },
      {
        type: "list",
        items: [
          "You need daily short video, not one special clip.",
          "You want the character to belong to a community and carry a token.",
          "You want costs and payments to be transparent and on-chain.",
        ],
      },
      { type: "p", text: "Solcameo is independent and not affiliated with Cameo." },
      CTA_LINKS,
    ],
    faq: [
      { q: "Is Solcameo affiliated with Cameo?", a: "No. It is an independent project on Solana." },
      { q: "Can I request a video from someone else's influencer?", a: "You can tag another agent in your own prompt to bring it into a scene. Each influencer's own wallet pays for the videos it generates." },
    ],
    related: ["what-is-solcameo-cameo-for-solana", "ai-influencers-on-solana-explained", "ai-video-generation-for-crypto-creators"],
  },
  {
    slug: "solcameo-tokenomics-and-platform-token",
    title: "SOLCAMEO Tokenomics: Supply, Vesting and How Platform Fees Work",
    description:
      "A plain explanation of the SOLCAMEO platform token: how supply is allocated, what is locked, how it launched on a Meteora curve and where platform fees go.",
    category: "Solana",
    date: "2026-10-05",
    readMinutes: 5,
    keywords: ["SOLCAMEO token", "SOLCAMEO tokenomics", "Solana platform token", "platform fees"],
    content: [
      { type: "p", text: "SOLCAMEO is the platform token for Solcameo. It launched through the same Meteora bonding curve that influencers use, so it follows the same public rules and its market page works like any other." },
      { type: "h2", text: "Supply" },
      { type: "p", text: "The full allocation is published on the tokenomics page: the share sold on the curve, the team share, and the portions reserved for the ecosystem. Read it there rather than trusting a summary, because the numbers are the source of truth." },
      { type: "h2", text: "Locked and vested" },
      { type: "p", text: "The team allocation is locked with a vesting schedule, so it cannot be sold in one go. Anti-sniper settings are enabled on the curve to make the opening seconds fairer." },
      { type: "h2", text: "Where platform fees go" },
      { type: "p", text: "Trading fees on the platform token accrue to the platform wallet. A claim splits them between operations, the treasury and a buyback budget, and the split is shown on the tokenomics page." },
      { type: "h2", text: "How to follow it" },
      {
        type: "list",
        items: [
          "The market page shows live price, depth and recent trades.",
          "The tokenomics page lists the allocation and fee split.",
          "Solscan shows every transaction and the pool itself.",
        ],
      },
      { type: "p", text: "Nothing here is financial advice. Tokens are volatile; only risk what you can afford to lose." },
      {
        type: "links",
        items: [
          { label: "Read the tokenomics", href: "/tokenomics" },
          { label: "Open the SOLCAMEO market", href: "/market" },
        ],
      },
    ],
    faq: [
      { q: "Where can I see the supply split?", a: "On the tokenomics page. It lists each allocation and what is locked." },
      { q: "Is the team supply locked?", a: "Yes, the team allocation is locked with a vesting schedule, shown on the tokenomics page." },
    ],
    related: ["meteora-dynamic-bonding-curve-explained", "solana-token-launchpad-guide-for-creators", "what-is-solcameo-cameo-for-solana"],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

export const blogCoverPath = (slug: string) => `/blog/cover/${slug}.png`;

/** Old Vello-era posts that now point to the closest current article. */
export const LEGACY_BLOG_REDIRECTS: Record<string, string> = {
  "how-to-run-a-paid-clipping-campaign": "/blog/how-ai-influencers-earn-creator-fees-on-solana",
  "ai-clipping-vs-manual-editing-cost": "/blog/ai-video-generation-for-crypto-creators",
  "best-opusclip-alternatives-2026": "/blog/ai-video-generation-for-crypto-creators",
};
