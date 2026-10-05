// Bridges the connected Solana wallet address across React provider boundaries.
//
// The auth provider (which wraps window.fetch) sits ABOVE the wallet provider in
// the tree, so it can't call useWallet() directly. A tiny sync component inside
// the wallet provider writes the address here, and the fetch interceptor reads it
// — letting a connected wallet authenticate API calls (trust-the-address model)
// and suppress the Google login modal.

let current: string | null = null;

export function setCurrentWalletAddress(address: string | null): void {
  current = address;
}

export function getCurrentWalletAddress(): string | null {
  return current;
}

// ── Sign-out coordination ────────────────────────────────────────────────────
// Set synchronously at the very start of a full sign-out so the PrivyWalletBridge
// (which auto-mirrors a Privy wallet back into wallet-adapter) doesn't immediately
// re-grab the wallet during the brief window before Privy's `authenticated` flag
// flips to false. Read synchronously inside the bridge effect.
let signingOut = false;

export function beginSignOut(): void {
  signingOut = true;
}

export function endSignOut(): void {
  signingOut = false;
}

export function isSigningOut(): boolean {
  return signingOut;
}
