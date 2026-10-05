// Single source of truth for "which wallet is the active SPENDING wallet".
//
// The hard requirement: sign/deduct from the wallet the user actually LOGGED IN
// with. Two things made the app open the wrong wallet (e.g. Solflare logged in,
// but Phantom popped up to sign):
//   1. `usePrivySolanaWallets()` can return MORE than one connected wallet (a
//      Google user's auto-created embedded wallet, plus any installed extension
//      the bridge happened to connect). Blindly taking `wallets[0]` is wrong.
//   2. The signer fell back to the wallet-ADAPTER, which opens whichever
//      extension it auto-selected — not the Privy-connected login wallet.
//
// Fix: identify the login wallet by ADDRESS (from the Privy `user` object) and
// always pick the matching Privy wallet object, then sign through Privy (which
// deterministically prompts THAT wallet). Pure + web3-free so it's unit-testable
// and shared by every call site (header pill, builder funding, identity bridge).

/** The minimal shape of a Privy Solana wallet we need to choose the active one. */
export interface SelectableWallet {
  address?: string;
  /** Privy sets this to "privy" for the embedded wallet on some wallet shapes.
   *  Not present on every Privy wallet object, so it's only a fallback hint. */
  walletClientType?: string;
}

/** True for Privy's auto-created embedded wallet (best-effort — not all wallet
 *  objects carry `walletClientType`, so treat a missing value as "not embedded"). */
export function isEmbeddedWallet(w: Pick<SelectableWallet, "walletClientType">): boolean {
  return w.walletClientType === "privy";
}

/**
 * Choose the active spending wallet from Privy's wallet array.
 *
 * Priority:
 *   1. The wallet whose address === `preferredAddress` (the login wallet). This
 *      is what guarantees we sign with the wallet the user logged in with.
 *   2. Otherwise the first connected EXTERNAL wallet (over the embedded one).
 *   3. Otherwise the first usable wallet.
 * Returns null when there is nothing usable.
 */
export function selectActiveWallet<T extends SelectableWallet>(
  wallets: readonly T[] | null | undefined,
  preferredAddress?: string | null,
): T | null {
  const usable = (wallets ?? []).filter((w): w is T => !!w?.address);
  if (usable.length === 0) return null;
  if (preferredAddress) {
    const match = usable.find((w) => w.address === preferredAddress);
    if (match) return match;
  }
  const external = usable.find((w) => !isEmbeddedWallet(w));
  return external ?? usable[0];
}

// ── Login-wallet resolution from the Privy `user` object ──────────────────────

/** A linked account as Privy exposes it on `user.linkedAccounts`. */
export interface LinkedAccountLike {
  type?: string;
  chainType?: string;
  address?: string;
  /** When this account was most recently used to log in / link. */
  latestVerifiedAt?: string | number | Date | null;
}

/** The slice of Privy's `user` object we read to find the login wallet. */
export interface PrivyUserLike {
  wallet?: { address?: string; chainType?: string } | null;
  linkedAccounts?: ReadonlyArray<LinkedAccountLike>;
}

function verifiedTime(a: LinkedAccountLike): number {
  const v = a.latestVerifiedAt;
  if (v == null) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * The address of the Solana wallet the user authenticated with. When several
 * wallets are linked, the one MOST RECENTLY used to log in wins (so re-logging
 * in with Solflare makes Solflare the spending wallet, not a previously-linked
 * Phantom). Falls back to the primary verified wallet. Null when unknown.
 */
export function getLoginWalletAddress(user: PrivyUserLike | null | undefined): string | null {
  const sol = (user?.linkedAccounts ?? []).filter(
    (a) => a.type === "wallet" && a.chainType === "solana" && !!a.address,
  );
  if (sol.length > 0) {
    let best = sol[0];
    for (const a of sol) if (verifiedTime(a) > verifiedTime(best)) best = a;
    return best.address ?? null;
  }
  if (user?.wallet?.chainType === "solana" && user.wallet.address) return user.wallet.address;
  return null;
}

// ── Ownership comparison ────────────────────────────────────────────────────

/**
 * True when `activeAddress` (the resolved active wallet — e.g.
 * `useUnifiedSolanaWallet().publicKey?.toBase58()`) matches the wallet that
 * owns a resource (e.g. `influencers.creatorWallet`). Pure string comparison,
 * no wallet-adapter dependency, so ownership gates built on it are testable
 * without mounting a wallet hook. Callers must resolve `activeAddress` via the
 * Privy-aware `useUnifiedSolanaWallet()`, not raw wallet-adapter `useWallet()`
 * — the latter is null for embedded-wallet (Google/email) logins, which would
 * make every ownership check false for those users.
 */
export function isOwnerWallet(
  activeAddress: string | null | undefined,
  ownerWallet: string | null | undefined,
): boolean {
  return !!activeAddress && !!ownerWallet && activeAddress === ownerWallet;
}

// ── Multi-wallet ownership scoping ──────────────────────────────────────────

/**
 * Union an account's linked wallet addresses (e.g. Convex `profile.walletAddresses`)
 * with its currently active wallet, de-duplicated. A resource (agent, campaign)
 * is keyed to the wallet it was minted/created under, which for a Privy/Google
 * user is frequently NOT the wallet currently resolved as "active" — owner
 * queries must scope by this full set (e.g. `influencers.listByCreators`), not
 * the single active wallet (`influencers.listByCreator`), or a multi-wallet
 * operator sees an empty/partial list. Mirrors app/wallet/page.tsx.
 */
export function unionWalletAddresses(
  linkedWallets: ReadonlyArray<string | null | undefined> | null | undefined,
  activeAddress?: string | null,
): string[] {
  const set = new Set<string>();
  for (const w of linkedWallets ?? []) if (w) set.add(w);
  if (activeAddress) set.add(activeAddress);
  return [...set];
}
