import { DetailModalShell } from "@/components/campaign/detail-modal-shell";
import ContentRewardPage from "../../../reward/[id]/page";

interface Props {
  params: Promise<{ id: string }>;
}

/** Intercepts a card click's navigation to /stage/reward/[id] (from inside
 *  /stage) and renders the SAME content-reward detail page inside an
 *  overlay instead of replacing the grid. A direct visit/refresh at
 *  /stage/reward/[id] still gets the normal full page. */
export default function InterceptedRewardModal({ params }: Props) {
  return (
    <DetailModalShell>
      <ContentRewardPage params={params} />
    </DetailModalShell>
  );
}
