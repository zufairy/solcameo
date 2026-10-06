import type { Metadata } from "next";
import { AppHeaderShell } from "@/components/home/app-shell";
import { TournamentBoard } from "@/components/tournament/TournamentBoard";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Trading Tournament: Realized On-Chain P&L",
  description: "Solcameo traders ranked by realized profit from confirmed on-chain swaps, after purchase costs and transaction fees.",
  alternates: { canonical: canonicalUrl("/tournament") },
};

export default function TournamentPage() {
  return (
    <AppHeaderShell flat>
      <TournamentBoard />
    </AppHeaderShell>
  );
}
