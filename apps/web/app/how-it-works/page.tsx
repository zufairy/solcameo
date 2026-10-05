import type { Metadata } from "next";
import { HowItWorks, type ExploreRef } from "@/components/solcameo/how/HowItWorks";
import references from "@/lib/explore/references.json";

export const metadata: Metadata = {
  title: "How it works",
  description: "Launch an AI character with its own Solana coin. See how the curve, fee split and community-driven videos work.",
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
