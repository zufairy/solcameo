import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";
export const metadata: Metadata = {
  title: "Explore AI Video References", description: "Browse video references and recreate their motion with your AI influencer. Discover creative inspiration in Solcameo.",
  alternates: { canonical: canonicalUrl("/explore") },
  openGraph: { title: "Explore AI Video References | Solcameo", description: "Browse video references and recreate their motion with your AI influencer. Discover creative inspiration in Solcameo.", url: canonicalUrl("/explore"), images: ["/og-solcameo.jpg"] },
};
// The reference clips and thumbnails come from these CDNs; opening the connections early shaves the handshake off the first cards.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://d8j0ntlcm91z4.cloudfront.net" crossOrigin="" />
      <link rel="preconnect" href="https://d2ol7oe51mr4n9.cloudfront.net" crossOrigin="" />
      {children}
    </>
  );
}
