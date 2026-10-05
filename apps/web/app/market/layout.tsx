import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";
export const metadata: Metadata = {
  title: "AI Influencer Token Market", description: "Explore AI influencer tokens on Solana. Follow live market caps, discover characters, and view confirmed on-chain trades on Solcameo.",
  alternates: { canonical: canonicalUrl("/market") },
  openGraph: { title: "AI Influencer Token Market | Solcameo", description: "Explore AI influencer tokens on Solana. Follow live market caps, discover characters, and view confirmed on-chain trades on Solcameo.", url: canonicalUrl("/market"), images: ["/og-image.jpg"] },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
