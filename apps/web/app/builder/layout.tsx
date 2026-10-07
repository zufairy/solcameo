import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";
export const metadata: Metadata = {
  title: "AI Influencer Builder", description: "Build your Solcameo AI influencer: design a character, generate videos, connect social accounts, and manage your content.",
  alternates: { canonical: canonicalUrl("/builder") },
  openGraph: { title: "AI Influencer Builder | Solcameo", description: "Build your Solcameo AI influencer: design a character, generate videos, connect social accounts, and manage your content.", url: canonicalUrl("/builder"), images: ["/og-solcameo.jpg"] },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
