import type { Metadata } from "next";
import { VsPage } from "@/components/cofounder/vs-page";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: "Vello Agents vs Klap: Features, Pricing and Auto-Posting" },
  description:
    "Vello Agents vs Klap: compare clip quality, paid clipping campaigns, multi-platform auto-posting, and pay-per-view payouts.",
  keywords: ["Vello Agents vs Klap", "Klap alternative", "shorts tool comparison", "long video to shorts"],
  alternates: { canonical: canonicalUrl("/vs/klap") },
  openGraph: {
    title: "Vello Agents vs Klap: Features, Pricing and Auto-Posting",
    description: "Compare Vello Agents and Klap on clip quality, paid clipping campaigns, and pay-per-view payouts.",
    url: canonicalUrl("/vs/klap"),
    images: [{ url: "/og-solcameo.jpg", width: 1600, height: 900, alt: "Vello Agents vs Klap" }],
  },
};

export default function Page() {
  return (
    <VsPage
      competitor="Klap"
      intro="Klap is an editing tool for turning long videos into clips fast. Vello does the editing too, but the difference is distribution: Vello pays a network of clippers to post your content, instead of leaving distribution to you."
      rows={[
        { label: "AI-generated short clips from long-form video", vello: true, them: true },
        { label: "Auto captions, reframing, hook detection", vello: true, them: true },
        { label: "Run a paid clipping campaign for a brand", vello: true, them: false },
        { label: "Pay clippers per verified view (not per clip)", vello: true, them: false },
        { label: "On-chain escrow — budget locked before clippers post", vello: true, them: false },
        { label: "Auto-post clips across TikTok, IG, YouTube, X", vello: true, them: true },
        { label: "Marketplace of clippers you can hire directly", vello: true, them: false },
        { label: "Solana / USDC payouts, no invoicing", vello: true, them: false },
      ]}
      whenThem="You need a fast, no-frills editor to cut your own footage into clips and post them yourself."
      whenVello="You want your content clipped and posted by people other than you — funded with a budget, paid automatically per verified view, tracked without spreadsheets."
    />
  );
}
