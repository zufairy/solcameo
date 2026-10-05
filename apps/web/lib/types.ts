export type Niche =
  | "lifestyle"
  | "tech"
  | "fashion"
  | "fitness"
  | "food"
  | "travel"
  | "finance"
  | "gaming";

export type Language =
  | "en"
  | "ms"
  | "id"
  | "ar"
  | "zh"
  | "hi"
  | "es"
  | "fr";

export interface AIInfluencer {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string;
  previewVideoUrl?: string;
  archetype?: string;
  niche: Niche;
  language: Language;
  tvl: number;
  monthlyEarnings: number;
  sharePrice: number;
  totalShares: number;
  availableShares: number;
  description: string;
  personality: {
    warmth: number;
    humor: number;
    authority: number;
    boldness: number;
  };
  contentHistory: ContentPost[];
  earningsHistory: EarningsPoint[];
  shareholders: Shareholder[];
  createdAt: string;
  creatorWallet?: string;
  agentWallet?: string;
  /** Canonical agent type, set at mint. */
  agentType?: "influencer" | "trader" | "worker";
}

export interface ContentPost {
  id: string;
  platform: "tiktok" | "instagram" | "youtube";
  thumbnailUrl: string;
  views: number;
  earnings: number;
  campaignId?: string;
  createdAt: string;
}

export interface EarningsPoint {
  date: string;
  earnings: number;
}

export interface Shareholder {
  address: string;
  shares: number;
  percentage: number;
}

export interface Campaign {
  id: string;
  brandName: string;
  brandLogoUrl: string;
  campaignImageUrl?: string;
  title: string;
  brief: string;
  budget: number;
  ratePerThousandViews: number;
  campaignType?: "marketing" | "bounty" | "agent_task";
  rewardPerCompletion?: number;
  agentTaskCategory?: string;
  deliverables?: string;
  /** MANDATORY structured requirements every agent post/clip must obey
   *  (@mentions / #hashtags / brand tags / tone rules). Stored + enforced
   *  server-side; surfaced on the campaign detail so what the owner entered shows. */
  requirements?: string[];
  contentLinks?: string[];
  contentFileUrls?: string[];
  targetNiche: Niche[];
  targetLanguage: Language[];
  /** Social platforms this campaign accepts submissions on (upload-post ids:
   *  tiktok/instagram/youtube). Empty/undefined = any connected platform. */
  platforms?: string[];
  status: "open" | "in_progress" | "completed" | "cancelled";
  submissionsCount: number;
  deadline: string;
  createdAt: string;
  creatorWallet: string;
  pdaAddress?: string;
  /** On-chain rail version. undefined/1 = legacy off-chain; 2 = funded on-chain
   *  treasury (vault holds the budget). Gates the creator "Reclaim remaining" action. */
  onchainVersion?: number;
  /** On-chain refund tx signature once the creator has reclaimed the unspent
   *  escrow after expiry (best-effort mirror; the chain is the source of truth). */
  refundTxSignature?: string;
  /** Linked jobtepi/ryze content_reward UUID (this campaign is its USDC treasury). */
  contentRewardId?: string;
  /** Provenance marker — "clipping_fr" = mirrored from a jobtepi clipping campaign. */
  origin?: string;
  /** Board tab this campaign lists under on /stage: "web3" | "ugc" | "clipping".
   *  Absent/default = "web3". Clipping FR routes via `origin`, not this. */
  category?: string;
  /** Optional per-submission payout cap (USDC), marketing campaigns only. */
  maxPayoutUsdc?: number;
  /** USDC already paid out of the budget (oracle-maintained). */
  spentUsdc?: number;
}

export interface UserInvestment {
  influencerId: string;
  shares: number;
  avgBuyPrice: number;
  currentValue: number;
  totalEarned: number;
}

export interface UserInfluencer {
  id: string;
  name: string;
  avatarUrl: string;
  tvl: number;
  monthlyEarnings: number;
  activeCampaigns: number;
}

export type WorkerCategory = "sales" | "support" | "marketing" | "operations";
export type WorkerVertical = "fashion" | "fnb" | "beauty" | "electronics" | "health" | "education" | "travel" | "general";
export type WorkerCapability = "whatsapp" | "instagram" | "shopify" | "woocommerce" | "stripe" | "razorpay" | "telegram" | "email";

export interface AIWorker {
  id: string;
  name: string;
  avatarUrl: string;
  builderWallet: string;
  builderName: string;
  category: WorkerCategory;
  vertical: WorkerVertical;
  description: string;
  capabilities: WorkerCapability[];
  monthlyPrice: number;
  language: string[];
  personality: { warmth: number; professionalism: number; empathy: number; assertiveness: number };
  rating: number;
  reviewCount: number;
  totalCustomers: number;
  status: "active" | "draft";
  createdAt: string;
}

export interface WorkerIntegration {
  platform: WorkerCapability;
  connected: boolean;
  accountId?: string;
}

export interface WorkerBusinessContext {
  whatYouSell: string;
  targetCustomer: string;
  brandVoice: string;
  priceRange: string;
  shippingPolicy: string;
  returnPolicy: string;
  workingHours: string;
}

export interface WorkerPolicies {
  maxDiscountPct: number;
  approvalThresholdAmount: number;
  escalateOn: string[];
  languages: string[];
}

export interface WorkerHire {
  id: string;
  workerId: string;
  businessWallet: string;
  businessName: string;
  businessLogoUrl?: string;
  vertical: string;
  monthlyBudget: number;
  status: "active" | "paused" | "cancelled";
  integrations: WorkerIntegration[];
  businessContext: WorkerBusinessContext;
  policies: WorkerPolicies;
  startedAt: string;
  createdAt: string;
}

export interface WorkerActivity {
  id: string;
  hireId: string;
  workerId: string;
  type: "message_sent" | "sale_closed" | "escalated" | "order_created" | "inquiry_handled";
  summary: string;
  platform: string;
  amount?: number;
  customerHandle?: string;
  createdAt: string;
}
