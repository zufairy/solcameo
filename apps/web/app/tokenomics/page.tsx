import type { Metadata } from "next";
import { AppHeaderShell } from "@/components/home/app-shell";
import { PlatformTokenSection } from "@/components/tokenomics/PlatformTokenSection";
import { TokenomicsLive } from "@/components/tokenomics/TokenomicsLive";
import { CoinLifecycle } from "@/components/tokenomics/CoinLifecycle";
import { BurnFlipCard } from "@/components/tokenomics/BurnFlipCard";
import { MoneyFlywheel } from "@/components/tokenomics/MoneyFlywheel";
import { Integrations, LivePulse } from "@/components/tokenomics/TokenomicsExtras";
import { canonicalUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "SOLCAMEO Tokenomics: Supply, Burns, Holder Tiers and Live Fees | Solcameo",
  description: "How the SOLCAMEO platform token works: the revenue cycle, weekly burns, holder tiers and allocation, plus real-time on-chain tokenomics for every Solcameo coin: trading fees collected, paid to creators, SOL in the bonding curves and tokens burned, read straight from Solana RPC.",
  keywords: ["Solcameo tokenomics", "Meteora bonding curve fees", "creator fees on Solana", "live on-chain data"],
  alternates: { canonical: canonicalUrl("/tokenomics") },
};

export default function TokenomicsPage() {
  return (
    <AppHeaderShell flat>
      <div className="min-h-full bg-[#07080a]"><TokenomicsLive heroAside={<BurnFlipCard />} afterHero={<><MoneyFlywheel /><LivePulse /><CoinLifecycle /></>} afterCoins={<Integrations />} /><PlatformTokenSection /></div>
    </AppHeaderShell>
  );
}
