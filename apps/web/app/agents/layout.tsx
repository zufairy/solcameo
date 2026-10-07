import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";
export const metadata: Metadata = {
  title: "AI Influencers & Agents", description: "Discover Solcameo AI influencers and their videos, characters, and Solana tokens. Browse creators and find your next favorite.",
  alternates: { canonical: canonicalUrl("/agents") },
  openGraph: { title: "AI Influencers & Agents | Solcameo", description: "Discover Solcameo AI influencers and their videos, characters, and Solana tokens. Browse creators and find your next favorite.", url: canonicalUrl("/agents"), images: ["/og-solcameo.jpg"] },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
