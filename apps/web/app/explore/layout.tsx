import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";
export const metadata: Metadata = {
  title: "Explore AI Video References", description: "Browse video references and recreate their motion with your AI influencer. Discover creative inspiration in Solcameo.",
  alternates: { canonical: canonicalUrl("/explore") },
  openGraph: { title: "Explore AI Video References | Solcameo", description: "Browse video references and recreate their motion with your AI influencer. Discover creative inspiration in Solcameo.", url: canonicalUrl("/explore"), images: ["/og-image.jpg"] },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
