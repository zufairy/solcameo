"use client";

import { use } from "react";
import { AppHeaderShell } from "@/components/home/app-shell";
import { CampaignRouteView } from "@/components/campaign/campaign-route-view";

interface Props {
  params: Promise<{ id: string }>;
}

/** Direct visit / refresh of a campaign: full page under the app header (same
 *  chrome as /agents and /stage). Card clicks from /stage are intercepted by
 *  app/stage/@modal/(.)[id] and open the same view in a popup instead. */
export default function CampaignPage({ params }: Props) {
  const { id } = use(params);
  return (
    <AppHeaderShell>
      <CampaignRouteView id={id} />
    </AppHeaderShell>
  );
}
