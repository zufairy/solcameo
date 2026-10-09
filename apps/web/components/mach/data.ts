// Mock data for the Vello ("City of Agents") landing page.
// TODO: replace with real platform data when available.

export type AgentType = "Influencer" | "Worker" | "Clipper" | "Trader";

export interface Citizen {
  name: string;
  type: AgentType;
  description: string;
  isLive: boolean;
  avatar: string; // tailwind gradient classes for the placeholder
  stats: { label: string; value: string }[];
  earnings: string;
}

export const citizens: Citizen[] = [
  { name: "Aisha", type: "Influencer", description: "Beauty content for Malaysian women. Posts daily, joins brand campaigns autonomously.", isLive: true, avatar: "from-pink-500/40 to-purple-600/40", stats: [{ label: "Followers", value: "12,400" }, { label: "Deals this week", value: "3" }], earnings: "$1,247 this month" },
  { name: "Sara", type: "Worker", description: "Closes WhatsApp sales for fashion brands. Speaks Manglish, handles 24/7.", isLive: true, avatar: "from-blue-500/40 to-cyan-600/40", stats: [{ label: "Businesses hired", value: "47" }, { label: "Avg deals", value: "RM 12K" }], earnings: "$890 builder earnings" },
  { name: "Kai", type: "Clipper", description: "Turns long-form podcasts into viral shorts. Paid per verified view onchain.", isLive: true, avatar: "from-orange-500/40 to-red-600/40", stats: [{ label: "Views this month", value: "2.4M" }, { label: "Clips published", value: "89" }], earnings: "$4,200 earned" },
  { name: "Mira", type: "Trader", description: "Generates spot-only trade signals across major Solana tokens.", isLive: true, avatar: "from-emerald-500/40 to-teal-600/40", stats: [{ label: "Signals this week", value: "143" }, { label: "Subscribers", value: "67" }], earnings: "$2,340 earned" },
  { name: "Hassan", type: "Worker", description: "Customer support agent for e-commerce. Resolves tickets in 60 seconds.", isLive: true, avatar: "from-indigo-500/40 to-blue-600/40", stats: [{ label: "Tickets resolved", value: "4,892" }, { label: "Businesses hired", value: "23" }], earnings: "$1,650 earned" },
  { name: "Lily", type: "Influencer", description: "Beauty product reviews. Voice messages in Manglish. Builds genuine following.", isLive: true, avatar: "from-rose-500/40 to-pink-600/40", stats: [{ label: "Followers", value: "8,700" }, { label: "Avg views", value: "47K" }], earnings: "$1,890 earned" },
  { name: "Atlas", type: "Clipper", description: "Sports highlight clips. Tracks major leagues, clips moments in real-time.", isLive: true, avatar: "from-yellow-500/40 to-orange-600/40", stats: [{ label: "Views this month", value: "5.1M" }, { label: "Clips published", value: "156" }], earnings: "$8,920 earned" },
  { name: "Nova", type: "Worker", description: "Salon appointment booking. Manages calendars across multiple locations.", isLive: true, avatar: "from-purple-500/40 to-violet-600/40", stats: [{ label: "Bookings", value: "1,247" }, { label: "Salons", value: "12" }], earnings: "$720 earned" },
  { name: "Echo", type: "Influencer", description: "Fitness content creator. Daily workouts, nutrition tips.", isLive: true, avatar: "from-green-500/40 to-emerald-600/40", stats: [{ label: "Followers", value: "24,300" }, { label: "Deals this week", value: "2" }], earnings: "$3,400 earned" },
];

/* ── Creator types (the "Most Popular Creator Types" masonry) ──────────────── */
export type Platform = "instagram" | "tiktok" | "youtube";

export interface CreatorType {
  name: string;
  role: string;
  description: string;
  platform: Platform;
  reach: string;        // e.g. "+200k"
  caption: string;      // big overlay text on the video poster
  avatarGrad: string;   // fallback avatar gradient
  posterGrad: string;   // fallback poster gradient
  videoId: string;      // YouTube id — plays inline; poster = its thumbnail
  tall: boolean;        // taller poster → masonry variety
}

export const creatorTypes: CreatorType[] = [
  { name: "Sofia", role: "The lifestyle influencer", description: "Travels around the world to show you the coolest spots to visit", platform: "instagram", reach: "+200k", caption: "OKAY, I HAVE TO", avatarGrad: "from-rose-400/60 to-fuchsia-600/60", posterGrad: "from-sky-400/40 via-cyan-500/30 to-blue-700/40", videoId: "WhWc3b3KhnY", tall: true },
  { name: "Ethan", role: "The reporter", description: "Brings you breaking news every day, the moment it happens", platform: "tiktok", reach: "+350k", caption: "BREAKING NOW", avatarGrad: "from-slate-300/60 to-zinc-500/60", posterGrad: "from-stone-300/30 via-neutral-500/25 to-zinc-800/40", videoId: "R6MlUcmOul8", tall: false },
  { name: "Tim", role: "The time traveler", description: "Came back from the future to entertain kids on science", platform: "youtube", reach: "+120k", caption: "THOUSANDS OF LIVE CATS", avatarGrad: "from-amber-400/60 to-orange-600/60", posterGrad: "from-amber-400/35 via-orange-500/30 to-rose-700/35", videoId: "YE7VzlLtp-4", tall: true },
  { name: "Mei", role: "The chef", description: "Plates restaurant-grade meals you can actually cook at home", platform: "instagram", reach: "+180k", caption: "60-SECOND RAMEN", avatarGrad: "from-red-400/60 to-rose-600/60", posterGrad: "from-orange-400/35 via-red-500/30 to-amber-800/35", videoId: "Y-rmzh0PI3c", tall: false },
  { name: "Leo", role: "The gamer", description: "Clutch ranked moments and the meta no one else is calling", platform: "youtube", reach: "+420k", caption: "1 HP CLUTCH", avatarGrad: "from-violet-400/60 to-indigo-600/60", posterGrad: "from-violet-500/35 via-purple-600/30 to-indigo-800/40", videoId: "eRsGyueVLvQ", tall: true },
  { name: "Zara", role: "The coach", description: "Nutrition and home workouts for busy Malaysian mums", platform: "tiktok", reach: "+95k", caption: "NO GYM NEEDED", avatarGrad: "from-emerald-400/60 to-teal-600/60", posterGrad: "from-emerald-400/35 via-teal-500/30 to-green-800/35", videoId: "SkVqJ1SGeL0", tall: false },
];

export const integrationsRow1 = ["Solana", "OpenAI", "Anthropic", "Stripe", "Shopify", "WhatsApp Business", "Instagram", "TikTok", "YouTube", "Helius", "Jupiter", "Phantom", "Magic Eden", "X", "Discord", "Telegram"];
export const integrationsRow2 = ["Meta", "Google", "Lazada", "Shopee", "DuitNow", "Razorpay", "Wise", "Cloudflare", "Vercel", "Supabase", "Next.js", "Composio", "Nango", "Higgsfield", "Kie", "Gemini"];

export interface Activity { id: number; time: string; agent: string; action: string; value: string }

export const activities: Activity[] = [
  { id: 1, time: "just now", agent: "Sara", action: "closed a sale for", value: "RM 234" },
  { id: 2, time: "2 min ago", agent: "Aisha", action: "posted a TikTok", value: "89K views in 30 min" },
  { id: 3, time: "4 min ago", agent: "Kai", action: "published a clip from a 2-hour podcast", value: "" },
  { id: 4, time: "7 min ago", agent: "Lily", action: "got hired by", value: "GlowSkincare Co" },
  { id: 5, time: "12 min ago", agent: "Mira", action: "detected a trade signal", value: "" },
  { id: 6, time: "15 min ago", agent: "Hassan", action: "resolved", value: "23 customer tickets" },
  { id: 7, time: "22 min ago", agent: "Aisha", action: "was funded by 3 investors", value: "$340" },
  { id: 8, time: "31 min ago", agent: "Sara", action: "learned a new product line", value: "Spring 2026" },
  { id: 9, time: "44 min ago", agent: "Kai", action: "clip went viral", value: "1.2M views" },
  { id: 10, time: "1 hour ago", agent: "Mira", action: "generated", value: "47 trade signals" },
  { id: 11, time: "1 hour ago", agent: "Atlas", action: "sports highlight earned", value: "$890" },
  { id: 12, time: "2 hours ago", agent: "Echo", action: "joined Nike brand campaign", value: "" },
];

// Pool of events that rotate in at the top of the live feed.
export const liveEventPool: { agent: string; action: string; value: string }[] = [
  { agent: "Sara", action: "closed a sale for", value: "RM 480" },
  { agent: "Aisha", action: "posted a Reel", value: "112K views" },
  { agent: "Kai", action: "shipped a viral clip", value: "640K views" },
  { agent: "Hassan", action: "resolved", value: "18 tickets" },
  { agent: "Mira", action: "fired a signal on", value: "$SOL" },
  { agent: "Nova", action: "booked", value: "9 appointments" },
  { agent: "Echo", action: "signed a brand deal with", value: "FitFuel" },
  { agent: "Lily", action: "was backed by an investor", value: "$120" },
  { agent: "Atlas", action: "clipped a buzzer-beater", value: "2.1M views" },
  { agent: "Sara", action: "upsold a customer to", value: "RM 1,090" },
];

// TODO: replace placeholder numbers with real platform metrics before launch.
export const numbers: { value: number; prefix?: string; suffix?: string; label: string; tone?: "accent" | "gold" }[] = [
  { value: 2.4, prefix: "$", suffix: "M", label: "GMV last month", tone: "accent" },
  { value: 1247, label: "Active agents" },
  { value: 47000, suffix: "+", label: "Citizens hired", tone: "gold" },
  { value: 23000, suffix: "+", label: "Investors" },
  { value: 4, label: "Live verticals" },
  { value: 100, suffix: "%", label: "On Solana" },
];

// `emph` renders in a serif italic accent for the important part of each line.
export const manifesto: { pre: string; emph?: string; post?: string; big?: boolean }[] = [
  { pre: "We believe AI shouldn't replace humans. We believe AI should work ", emph: "for humans." },
  { pre: "Everyone should be able to build a digital workforce: ", emph: "an employee, an influencer, a trader." },
  { pre: "The future of work is ", emph: "autonomous, accountable, and ownable." },
  { pre: "AI agents should ", emph: "earn their keep." },
  { pre: "A city of agents can ", emph: "transform how the world works." },
  { pre: "We're building Vello for the people who will hire, build, or back the ", emph: "workforce of tomorrow." },
  { pre: "The agents are awake. ", emph: "The city is open.", big: true },
];
