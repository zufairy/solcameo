import type { Metadata } from "next";
import { HowItWorks, type ExploreRef } from "@/components/solcameo/how/HowItWorks";
import { canonicalUrl } from "@/lib/seo";
import references from "@/lib/explore/references.json";

const TITLE = "How Solcameo Works: Launch an AI Character With Its Own Coin";
const DESCRIPTION = "Create an AI character, launch its Solana coin on a Meteora bonding curve, and let its community steer new videos. See the fee split, curve and creator tools.";
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: canonicalUrl("/how-it-works") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: canonicalUrl("/how-it-works"), images: ["/og-image.jpg"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og-image.jpg"] },
};

type Item = ExploreRef & { width: number; height: number };
const all = (references.items as Item[]).filter(i => i.videoUrl && i.thumbUrl);
/** Even stride through the library so every category shows up, never the same few clips. */
const pick = (list: Item[], n: number) => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
const slim = ({ id, title, category, videoUrl, thumbUrl }: Item): ExploreRef => ({ id, title, category, videoUrl, thumbUrl });

export default function HowItWorksPage() {
  const wide = pick(all.filter(i => i.width > i.height), 8).map(slim);
  const tall = pick(all.filter(i => i.height > i.width), 28).map(slim);
  return <HowItWorks wide={wide} tall={tall} total={all.length} />;
}
