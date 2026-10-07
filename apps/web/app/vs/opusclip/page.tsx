import type { Metadata } from "next";
import { VsPage } from "@/components/cofounder/vs-page";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: "Vello Agents vs OpusClip: Features, Pricing and Auto-Posting" },
  description:
    "Vello Agents vs OpusClip: compare clip quality, paid clipping campaigns, multi-platform auto-posting, and pay-per-view payouts. See which fits your channel.",
  keywords: ["Vello Agents vs OpusClip", "OpusClip alternative", "shorts tool comparison", "long video to shorts"],
  alternates: { canonical: canonicalUrl("/vs/opusclip") },
  openGraph: {
    title: "Vello Agents vs OpusClip: Features, Pricing and Auto-Posting",
    description: "Compare Vello Agents and OpusClip on clip quality, paid clipping campaigns, and pay-per-view payouts.",
    url: canonicalUrl("/vs/opusclip"),
    images: [{ url: "/og-solcameo.jpg", width: 1600, height: 900, alt: "Vello Agents vs OpusClip" }],
  },
};

export default function Page() {
  return (
    <VsPage
      competitor="OpusClip"
      intro="OpusClip turns your own long-form video into clips. Vello does that too — but it also runs the campaign: brands fund a budget, clippers post the clips, and Vello pays out per verified view, on-chain, without anyone chasing an invoice."
      rows={[
        { label: "AI-generated short clips from long-form video", vello: true, them: true },
        { label: "Auto captions, hooks, and B-roll overlays", vello: true, them: true },
        { label: "Run a paid clipping campaign for a brand", vello: true, them: false },
        { label: "Pay clippers per verified view (not per clip)", vello: true, them: false },
        { label: "On-chain escrow — budget locked before clippers post", vello: true, them: false },
        { label: "Auto-post clips across TikTok, IG, YouTube, X", vello: true, them: true },
        { label: "Marketplace of clippers you can hire directly", vello: true, them: false },
        { label: "Solana / USDC payouts, no invoicing", vello: true, them: false },
        { label: "Standalone editor for solo creators", vello: true, them: true },
      ]}
      whenThem="You're a solo creator or editor who already has an audience and just needs long-form footage (a podcast, a stream, a talk) cut into clips fast. OpusClip is a strong editing tool for that workflow."
      whenVello="You're a brand or founder who wants clips made and posted by other people, not just yourself. Vello lets you fund a campaign, and clippers pull your content, edit it, and post it for a cut of the views — paid automatically, on-chain, once views are verified. No hiring, no invoices, no chasing creators for a link."
    />
  );
}
