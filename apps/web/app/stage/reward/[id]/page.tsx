"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { isOnchainCampaign } from "@/lib/campaignVisibility";
import { CLIPPING_FR_ORIGIN } from "@/lib/clippingFr";

interface Props {
  params: Promise<{ id: string }>;
}

export default function ContentRewardPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const campaigns = useQuery(api.campaigns.listStage);
  const funded = campaigns?.find((campaign) =>
    campaign.contentRewardId === id && campaign.origin !== CLIPPING_FR_ORIGIN && isOnchainCampaign(campaign));

  useEffect(() => {
    if (funded) router.replace(`/stage/${funded._id}`);
  }, [funded, router]);

  // Old reward URLs remain valid only when linked to a finalized on-chain
  // campaign. Do not fetch the legacy Supabase reward or show an unpayable CTA.
  if (campaigns !== undefined && !funded) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-zinc-500 text-sm">This reward has no funded on-chain campaign.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center gap-3 text-sm text-zinc-500">
      <Loader2 className="size-5 animate-spin" />
      {funded ? "Opening on-chain campaign…" : "Loading campaign…"}
    </div>
  );
}
