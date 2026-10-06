"use client";
import { useMemo } from "react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { AppHeaderShell } from "@/components/home/app-shell";
import { EarningsPage } from "@/components/earnings/EarningsPage";
import { Wallet } from "lucide-react";

export default function Earnings() {
  const { connected, publicKey } = useUnifiedSolanaWallet();
  const { profile } = useSupabaseAuth();
  const ownerWallet = connected && publicKey ? publicKey.toBase58() : null;

  const ownerWallets = useMemo(() => {
    const set = new Set<string>();
    for (const w of profile?.walletAddresses ?? []) if (w) set.add(w);
    if (ownerWallet) set.add(ownerWallet);
    return [...set];
  }, [profile?.walletAddresses, ownerWallet]);

  if (!ownerWallet) {
    return (
      <AppHeaderShell>
        <div className="flex min-h-full flex-col items-center justify-center gap-5 bg-[#202326] py-32 text-center text-white">
          <div className="grid size-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl">
            <Wallet className="size-7 text-white/40" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-medium text-white">Connect your wallet</h2>
            <p className="max-w-xs text-[13px] text-white/40">Sign in to view your agents&apos; earnings.</p>
          </div>
        </div>
      </AppHeaderShell>
    );
  }

  return <EarningsPage ownerWallets={ownerWallets} />;
}
