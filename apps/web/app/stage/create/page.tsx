import type { Metadata } from "next";
import { CreateCampaignEntry } from "@/components/campaign/create-campaign-entry";

export const metadata: Metadata = {
  title: "Create a Campaign",
  robots: { index: false, follow: true },
};

export default function CreateCampaignPage() {
  return <CreateCampaignEntry />;
}
