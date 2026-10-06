import type { Metadata } from "next";
import { AppHeaderShell } from "@/components/home/app-shell";
import { TokenomicsLive } from "@/components/tokenomics/TokenomicsLive";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Live Tokenomics: Fees, Creator Payouts and Burns | Solcameo",
  description: "Real-time, on-chain tokenomics for every Solcameo coin: trading fees collected, paid to creators, SOL in the bonding curves and tokens burned, read straight from Solana RPC.",
  keywords: ["Solcameo tokenomics", "Meteora bonding curve fees", "creator fees on Solana", "live on-chain data"],
  alternates: { canonical: canonicalUrl("/tokenomics") },
};

export default function TokenomicsPage() {
  return (
    <AppHeaderShell flat>
      <div className="min-h-full bg-black"><TokenomicsLive /></div>
    </AppHeaderShell>
  );
}
