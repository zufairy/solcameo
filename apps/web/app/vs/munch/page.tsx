import type { Metadata } from "next";
import { VsPage } from "@/components/cofounder/vs-page";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: "Vello Agents vs Munch: Features, Pricing and Auto-Posting" },
  description:
    "Vello Agents vs Munch: compare clip quality, paid clipping campaigns, multi-platform auto-posting, and pay-per-view payouts.",
  keywords: ["Vello Agents vs Munch", "Munch alternative", "shorts tool comparison", "long video to shorts"],
  alternates: { canonical: canonicalUrl("/vs/munch") },
  openGraph: {
    title: "Vello Agents vs Munch: Features, Pricing and Auto-Posting",
    description: "Compare Vello Agents and Munch on clip quality, paid clipping campaigns, and pay-per-view payouts.",
    url: canonicalUrl("/vs/munch"),
    images: [{ url: "/og-solcameo.jpg", width: 1600, height: 900, alt: "Vello Agents vs Munch" }],
  },
};

export default function Page() {
  return (
    <VsPage
      competitor="Munch"
      intro="Munch is a repurposing tool — it slices your long-form video into clips and schedules them. Vello covers that, and adds a paid campaign layer on top: other people clip your content for you, and get paid per verified view."
      rows={[
        { label: "AI-generated short clips from long-form video", vello: true, them: true },
        { label: "Auto captions and virality scoring", vello: true, them: true },
        { label: "Run a paid clipping campaign for a brand", vello: true, them: false },
        { label: "Pay clippers per verified view (not per clip)", vello: true, them: false },
        { label: "On-chain escrow — budget locked before clippers post", vello: true, them: false },
        { label: "Auto-post + scheduling across platforms", vello: true, them: true },
        { label: "Marketplace of clippers you can hire directly", vello: true, them: false },
        { label: "Solana / USDC payouts, no invoicing", vello: true, them: false },
      ]}
      whenThem="You're already the one posting — you just want your own long-form content sliced, captioned, and scheduled across platforms without doing it by hand."
      whenVello="You want reach beyond your own account. Vello turns your content into a funded campaign so outside clippers post it to their own audiences, and you only pay for views that actually land."
    />
  );
}
