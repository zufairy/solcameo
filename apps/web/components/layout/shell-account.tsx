"use client";

import { usePrivy } from "@privy-io/react-auth";
import { PRIVY_ENABLED } from "@/lib/privy";
import { WalletButton } from "./wallet-button";
import { AccountMenu } from "./account-menu";

/** Privy configured: wallet UI (or "Connect wallet" when signed out) + the account
 *  dropdown for Google/email users, who have no wallet pill of their own. */
function PrivyShellAccount() {
  const { authenticated } = usePrivy();
  // Signed in: Deposit / create / balance panel / avatar. Signed out: connect button.
  return authenticated ? <AccountMenu /> : <WalletButton showConnect />;
}

/** Single primary account control for the global shell top bar. */
export function ShellAccount() {
  return PRIVY_ENABLED ? <PrivyShellAccount /> : <WalletButton />;
}
