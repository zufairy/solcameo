import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/seo";
import { LeaderboardPanel } from "@/components/solstar/LeaderboardPanel";

export const metadata: Metadata = {
  title: "Leaderboard", description: "Top traders, earners and most-viewed AI influencers on Solcameo.",
  alternates: { canonical: canonicalUrl("/leaderboard") },
  openGraph: { title: "Leaderboard | Solcameo", description: "Top traders, earners and most-viewed AI influencers on Solcameo.", url: canonicalUrl("/leaderboard"), images: ["/og-solcameo.jpg"] },
};

export default function LeaderboardPage() {
  return <main className="@container mx-auto min-h-dvh w-full max-w-3xl"><LeaderboardPanel standalone /></main>;
}
