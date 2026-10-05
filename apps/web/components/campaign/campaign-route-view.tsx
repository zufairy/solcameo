"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Id } from "@/convex/_generated/dataModel";
import { CampaignDetail } from "@/components/campaign/campaign-detail";
import { Loader2 } from "lucide-react";
import type { Campaign, Niche, Language } from "@/lib/types";
import { isOnchainCampaign } from "@/lib/campaignVisibility";
import { CLIPPING_FR_ORIGIN } from "@/lib/clippingFr";

/** One campaign, shared by the full /stage/[id] page and the /stage popup
 *  (intercepted route). `variant="modal"` renders the compact in-overlay form. */
export function CampaignRouteView({ id, variant = "page" }: { id: string; variant?: "page" | "modal" }) {
  const doc = useQuery(api.campaigns.getStageById, { id: id as Id<"campaigns"> });
  const minH = variant === "modal" ? "min-h-[50vh]" : "min-h-[60vh]";

  if (doc === undefined) {
    return (
      <div className={`flex items-center justify-center ${minH}`}>
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Loading campaign...</p>
        </div>
      </div>
    );
  }

  if (doc === null || doc.origin === CLIPPING_FR_ORIGIN || !isOnchainCampaign(doc)) {
    return (
      <div className={`flex items-center justify-center ${minH}`}>
        <p className="text-zinc-500 text-sm">This campaign is not available on Stage.</p>
      </div>
    );
  }

  const campaign: Campaign = {
    id: doc._id,
    brandName: doc.brandName,
    brandLogoUrl: doc.brandLogoUrl,
    campaignImageUrl: doc.campaignImageUrl,
    title: doc.title,
    brief: doc.brief,
    budget: doc.budget,
    ratePerThousandViews: doc.ratePerThousandViews,
    campaignType: doc.campaignType as Campaign["campaignType"],
    rewardPerCompletion: doc.rewardPerCompletion,
    agentTaskCategory: doc.agentTaskCategory,
    deliverables: doc.deliverables,
    contentLinks: doc.contentLinks,
    contentFileUrls: doc.contentFileUrls,
    targetNiche: doc.targetNiche as Niche[],
    targetLanguage: doc.targetLanguage as Language[],
    platforms: doc.platforms,
    status: doc.status as Campaign["status"],
    submissionsCount: doc.submissionsCount,
    deadline: doc.deadline,
    createdAt: new Date(doc._creationTime).toISOString(),
    creatorWallet: doc.creatorWallet,
    pdaAddress: doc.pdaAddress,
    onchainVersion: doc.onchainVersion,
    refundTxSignature: doc.refundTxSignature,
    requirements: doc.requirements,
    contentRewardId: doc.contentRewardId,
    origin: doc.origin,
    category: doc.category,
    maxPayoutUsdc: doc.maxPayoutUsdc,
    spentUsdc: doc.spentUsdc,
  };

  return <CampaignDetail campaign={campaign} campaignDocId={doc._id} variant={variant} />;
}
