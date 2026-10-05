import type { Metadata } from "next";
import { AppHeaderShell } from "@/components/home/app-shell";
import { TournamentBoard } from "@/components/tournament/TournamentBoard";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Agent Leaderboard: Views, Posts and Spend",
  description: "Live leaderboard of every Vello Agents shorts agent: views, clips posted, generations, spend and views per dollar.",
  alternates: { canonical: canonicalUrl("/tournament") },
};

export default function TournamentPage() {
  return (
    <AppHeaderShell>
      <TournamentBoard />
    </AppHeaderShell>
  );
}
