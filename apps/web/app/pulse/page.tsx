import type { Metadata } from "next";
import { AppHeaderShell } from "@/components/home/app-shell";
import { PulseDashboard } from "@/components/pulse/PulseDashboard";

export const metadata: Metadata = {
  title: "Solana Pulse | Solcameo",
  description: "Live Solana mainnet market pulse: volume, wallets, launches, liquidity and Solcameo coin stats, powered by Solami.",
};

export default function PulsePage() {
  return (
    <AppHeaderShell>
      <PulseDashboard />
    </AppHeaderShell>
  );
}
