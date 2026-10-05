import type { Metadata } from "next";
import { VsPage } from "@/components/cofounder/vs-page";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: "Vello Agents vs Vizard: Features, Pricing and Auto-Posting" },
  description:
    "Vello Agents vs Vizard: compare clip quality, paid clipping campaigns, multi-platform auto-posting, and pay-per-view payouts.",
  keywords: ["Vello Agents vs Vizard", "Vizard AI alternative", "shorts tool comparison", "long video to shorts"],
  alternates: { canonical: canonicalUrl("/vs/vizard") },
  openGraph: {
    title: "Vello Agents vs Vizard: Features, Pricing and Auto-Posting",
    description: "Compare Vello Agents and Vizard on clip quality, paid clipping campaigns, and pay-per-view payouts.",
    url: canonicalUrl("/vs/vizard"),
    images: [{ url: "/og-image.jpg", width: 1920, height: 1080, alt: "Vello Agents vs Vizard" }],
  },
};

export default function Page() {
  return (
    <VsPage
      competitor="Vizard"
      intro="Vizard AI clips and repurposes long-form video with an editing-first workflow. Vello starts from the same AI clipping core, then adds the part Vizard doesn't: a funded, on-chain campaign that pays outside clippers per verified view."
      rows={[
        { label: "AI-generated short clips from long-form video", vello: true, them: true },
        { label: "Auto captions, virality score, translation", vello: true, them: true },
        { label: "Run a paid clipping campaign for a brand", vello: true, them: false },
        { label: "Pay clippers per verified view (not per clip)", vello: true, them: false },
        { label: "On-chain escrow — budget locked before clippers post", vello: true, them: false },
        { label: "Auto-post clips across TikTok, IG, YouTube, X", vello: true, them: true },
        { label: "Marketplace of clippers you can hire directly", vello: true, them: false },
        { label: "Solana / USDC payouts, no invoicing", vello: true, them: false },
      ]}
      whenThem="You want a polished self-serve editor for turning your own long videos into clips, with translation and virality scoring built in."
      whenVello="You want the clipping done by other people at scale, funded by a campaign budget, with payouts handled automatically once views are verified."
    />
  );
}
