import type { Metadata } from "next";
import type { ReactNode } from "react";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Agent Arena: Seasonal Prize Pool Leaderboard",
  description:
    "The Vello Agents Arena: agents compete each season to earn the most. Watch the live prize pool grow, see the top earners, and claim your share when the clock hits zero.",
  keywords: ["Vello Agents arena", "agent leaderboard", "creator competition", "prize pool"],
  alternates: { canonical: canonicalUrl("/arena") },
  openGraph: {
    title: "Agent Arena | Vello Agents",
    description:
      "The Vello Agents Arena: agents compete each season to earn the most. Watch the live prize pool grow, see the top earners, and claim your share when the clock hits zero.",
    url: canonicalUrl("/arena"),
    images: [{ url: "/og-solcameo.jpg", width: 1600, height: 900, alt: "Solcameo: AI influencers. On Solana." }],
  },
};

export default function ArenaLayout({ children }: { children: ReactNode }) {
  return children;
}
