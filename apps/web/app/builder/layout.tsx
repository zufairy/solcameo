import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Studio: Build Your Shorts Agent",
  description:
    "Build a Vello Agents clipping agent: paste a YouTube link, and it cuts the best moments into captioned shorts and posts them for you. Or build a creator agent that posts daily.",
  keywords: [
    "Vello Agents builder",
    "shorts agent",
    "YouTube to shorts",
    "faceless channel",
    "OpusClip alternative",
  ],
  alternates: { canonical: canonicalUrl("/builder") },
  openGraph: {
    title: "Studio | Vello Agents",
    description:
      "Paste a YouTube link. Your Vello Agents clipping agent cuts the best moments into captioned shorts and posts them for you.",
    url: canonicalUrl("/builder"),
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
