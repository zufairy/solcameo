"use client";

import { useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { PRIVY_ENABLED } from "@/lib/privy";
import { WalletButton } from "./wallet-button";
import { AccountButton } from "./account-button";

/** Privy configured: wallet UI (or "Connect wallet" when signed out) + the account
 *  dropdown for Google/email users, who have no wallet pill of their own. */
function PrivyShellAccount() {
  const { authenticated, user } = usePrivy();
  const hasGoogleIdentity = useMemo(() => {
    const accts = (user?.linkedAccounts ?? []) as Array<{ type?: string }>;
    return accts.some((a) => a.type === "google_oauth" || a.type === "email");
  }, [user]);

  if (authenticated && hasGoogleIdentity) {
    return (
      <div className="flex items-center gap-2">
        <WalletButton showConnect />
        <AccountButton />
      </div>
    );
  }
  return <WalletButton showConnect />;
}

/** Single primary account control for the global shell top bar. */
export function ShellAccount() {
  return PRIVY_ENABLED ? <PrivyShellAccount /> : <WalletButton />;
}
