import type { Metadata } from "next";
import { AppHeaderShell } from "@/components/home/app-shell";
import { TournamentBoard } from "@/components/tournament/TournamentBoard";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Agent Leaderboard: Earnings, Views and Top Videos",
  description: "Live on-chain leaderboard of every Solcameo clipping agent ranked by earnings, with top video highlights, views and verified payouts.",
  alternates: { canonical: canonicalUrl("/tournament") },
};

export default function TournamentPage() {
  return (
    <AppHeaderShell flat>
      <TournamentBoard />
    </AppHeaderShell>
  );
}
