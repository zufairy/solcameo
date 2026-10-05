"use client";

import { useState } from "react";
import { useFundWallet } from "@privy-io/react-auth/solana";
import { CreditCard, Droplet, ExternalLink, Loader2 } from "lucide-react";
import { isMainnet, getUsdcFaucetUrl } from "@/lib/solana/network";

interface AddFundsButtonProps {
  /** The wallet address the on-ramp should fund (the user's OWN wallet, or an
   *  agent wallet when used one-hop from the deposit modal). */
  address: string;
  /** Called after the funding modal is exited so the balance can be re-read. */
  onRefresh?: () => void;
  /** USDC amount to preload in the on-ramp. Default "20". */
  amount?: string;
  /** Mainnet card-CTA label. Default "Add funds". */
  label?: string;
  /** Override the mainnet button styling (e.g. to embed in the deposit modal). */
  className?: string;
  /** Override the devnet faucet-link styling. */
  faucetClassName?: string;
}

const DEFAULT_BTN_CLASS =
  "group inline-flex items-center gap-2 rounded-full bg-lime-400 px-4 py-1.5 text-[12.5px] font-semibold text-[#0c1402] shadow-[0_0_24px_-8px_rgba(163,230,53,0.6)] transition-transform duration-300 active:scale-[0.98] disabled:opacity-60";
const DEFAULT_FAUCET_CLASS =
  "group inline-flex items-center gap-2 rounded-full bg-black/25 px-3.5 py-1.5 text-[12.5px] font-medium text-[#aab39a] ring-1 ring-white/10 transition-colors hover:text-[#F4F6F0]";

/**
 * Native Privy fiat/card on-ramp for a Solana wallet (Coinbase / MoonPay, enabled
 * per-app in the Privy Dashboard). On-ramps only deliver real MAINNET USDC, so on
 * devnet/testnet this renders the Circle faucet link instead.
 *
 * `fundWallet` resolves on modal EXIT (not on funds landing), and `onUserExited`
 * fires whenever the flow closes — both trigger a balance refresh.
 */
export default function AddFundsButton({
  address, onRefresh, amount = "20", label = "Add funds", className, faucetClassName,
}: AddFundsButtonProps) {
  const [busy, setBusy] = useState(false);
  const { fundWallet } = useFundWallet({ onUserExited: () => { setBusy(false); onRefresh?.(); } });

  // Devnet/testnet: no real on-ramp exists — surface the test-USDC faucet instead.
  if (!isMainnet()) {
    const faucet = getUsdcFaucetUrl();
    if (!faucet) return null;
    return (
      <a
        href={faucet}
        target="_blank"
        rel="noopener noreferrer"
        className={faucetClassName ?? DEFAULT_FAUCET_CLASS}
      >
        <Droplet className="size-3.5" strokeWidth={1.5} /> Get test USDC
        <ExternalLink className="size-3 opacity-70" strokeWidth={1.5} />
      </a>
    );
  }

  const onClick = async () => {
    setBusy(true);
    try {
      await fundWallet({
        address,
        options: {
          chain: "solana:mainnet",
          asset: "USDC",
          amount,
          defaultFundingMethod: "card",
          card: { preferredProvider: "moonpay" },
        },
      });
    } catch {
      /* user closed the flow or no funding method available — onUserExited resets */
    } finally {
      setBusy(false);
      onRefresh?.();
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={className ?? DEFAULT_BTN_CLASS}
    >
      {busy
        ? <><Loader2 className="size-3.5 animate-spin" strokeWidth={2} /> Opening…</>
        : <><CreditCard className="size-3.5" strokeWidth={2} /> {label}</>}
    </button>
  );
}
