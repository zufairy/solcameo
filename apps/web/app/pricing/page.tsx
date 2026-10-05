import type { Metadata } from "next";
import { PricingPage } from "@/components/cofounder/pricing";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Pricing: Start Free, Scale With Credits",
  description:
    "Vello pricing for AI clipping and influencer agents: Free, Starter, Creator, and Growth plans with transparent generation credit costs.",
  keywords: ["Vello Agents pricing", "Vello pricing", "OpusClip pricing alternative", "short-form video tool pricing"],
  alternates: { canonical: canonicalUrl("/pricing") },
  openGraph: {
    title: "Pricing | Vello Agents",
    description:
      "Four simple Vello plans with transparent credit costs for AI clipping, video generation, publishing, and content agents.",
    url: canonicalUrl("/pricing"),
    images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "Vello pricing" }],
  },
};

export default function Page() {
  return <PricingPage />;
}
