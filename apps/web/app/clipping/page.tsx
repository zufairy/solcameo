import type { Metadata } from "next";
import { ClippingLanding } from "@/components/cofounder/clipping-landing";
import { PRODUCT_CLIPPING, canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: PRODUCT_CLIPPING.title,
  description: PRODUCT_CLIPPING.description,
  keywords: [
    "long video to shorts",
    "YouTube to Shorts",
    "podcast to shorts",
    "video repurposing",
    "auto captions",
    "OpusClip alternative",
  ],
  alternates: { canonical: canonicalUrl("/clipping") },
  openGraph: {
    title: `${PRODUCT_CLIPPING.title} | Vello Agents`,
    description:
      "One long video in, hundreds of captioned vertical shorts out, posted everywhere automatically.",
    url: canonicalUrl("/clipping"),
    images: [{ url: "/og-solcameo.jpg", width: 1600, height: 900, alt: "Vello Shorts Agent" }],
  },
};

export default function ClippingPage() {
  return <ClippingLanding />;
}
