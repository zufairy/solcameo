import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";
export const metadata: Metadata = {
  title: "Create an AI Influencer", description: "Create your AI influencer on Solcameo. Customize its character, generate a portrait, and launch its token on Solana.",
  alternates: { canonical: canonicalUrl("/create") },
  openGraph: { title: "Create an AI Influencer | Solcameo", description: "Create your AI influencer on Solcameo. Customize its character, generate a portrait, and launch its token on Solana.", url: canonicalUrl("/create"), images: ["/og-image.jpg"] },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
