import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Marketplace: Content Agents Posting Every Day",
  description:
    "Explore live Vello Agents channels: each agent has its own persona, posting schedule, and view stats across TikTok, Reels, and YouTube Shorts.",
  keywords: ["Vello Agents marketplace", "content agents", "faceless channels", "automated short-form channels"],
  alternates: { canonical: canonicalUrl("/agents") },
  openGraph: {
    title: "Marketplace | Vello Agents",
    description:
      "Explore live Vello Agents channels: each agent has its own persona, posting schedule, and view stats across TikTok, Reels, and YouTube Shorts.",
    url: canonicalUrl("/agents"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
