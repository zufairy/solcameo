"use client";

import { use } from "react";
import { DetailModalShell } from "@/components/campaign/detail-modal-shell";
import { CampaignRouteView } from "@/components/campaign/campaign-route-view";

interface Props {
  params: Promise<{ id: string }>;
}

/** Intercepts a card click's navigation to /stage/[id] (from inside /stage):
 *  the grid stays mounted and the campaign opens in a popup. A direct
 *  visit/refresh at /stage/[id] still gets the full page. */
export default function InterceptedCampaignModal({ params }: Props) {
  const { id } = use(params);
  return (
    <DetailModalShell hideClose>
      <CampaignRouteView id={id} variant="modal" />
    </DetailModalShell>
  );
}
