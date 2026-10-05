"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets as usePrivySolanaWallets,
  useSignTransaction as usePrivySignTransaction,
  useSignMessage as usePrivySignMessage,
} from "@privy-io/react-auth/solana";
import { PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { getNetwork } from "@/lib/solana/network";
import { signTransactionViaBytes } from "@/lib/solana/privySignAdapter";
import { selectActiveWallet, getLoginWalletAddress } from "@/lib/solana/activeWallet";
import { getE2eBypassSession, type E2eBypassSession } from "@/lib/client/e2eBypass";

type AnyTx = Transaction | VersionedTransaction;

export interface UnifiedSolanaWallet {
  /** Active wallet pubkey — external (wallet-adapter) wallet first, else the
   *  Privy wallet (embedded one auto-created on Google login, or external). */
  publicKey: PublicKey | null;
  /** Signs with whichever wallet `publicKey` came from. Undefined when not connected. */
  signTransaction: (<T extends AnyTx>(tx: T) => Promise<T>) | undefined;
  /** Signs an arbitrary message (Ed25519) with the active wallet, returning the raw
   *  64-byte signature. Used by Sign-In-With-Solana. Undefined when not connected. */
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined;
  connected: boolean;
  connecting: boolean;
}

/**
 * The ONE wallet hook for pages that need an address + signing.
 *
 * Why not `useWallet()` directly: after the Privy migration, a Google login
 * creates an EMBEDDED Privy wallet that never appears in wallet-adapter, so
 * `useWallet().publicKey` stays null — pages built on it show "Select Wallet"
 * even though the header (Privy-aware) shows the user as connected. This hook
 * applies the same resolution order as the header pill (adapter wallet first,
 * then Privy wallet) and adapts Privy's bytes-level signer to wallet-adapter's
 * `signTransaction` shape so mint/funding flows work for both wallet kinds.
 *
 * Gated on the Privy session like the header: no Privy auth → not connected,
 * even if a browser extension still reports a lingering connection.
 */
export function useUnifiedSolanaWallet(): UnifiedSolanaWallet {
  const {
    publicKey: adapterPk,
    signTransaction: adapterSign,
    signMessage: adapterSignMessage,
    connecting: adapterConnecting,
  } = useWallet();
  const { authenticated, ready, user } = usePrivy();
  const { wallets: privyWallets } = usePrivySolanaWallets();
  const { signTransaction: privySignBytes } = usePrivySignTransaction();
  const { signMessage: privySignMessage } = usePrivySignMessage();

  // Dev-only E2E test-auth seam (null in prod — flag is compile-time inlined). When
  // present, the wallet resolves to the injected address and signing is stubbed
  // (E2E mocks on-chain calls; the server bypass sets provenWallet, so no real
  // signature is ever needed). Declared via hooks BEFORE the return branch so the
  // Rules of Hooks hold whether or not the bypass is active, and resolved POST-MOUNT
  // (useEffect → useState, same as the auth provider) so the first client render
  // starts at `null` — identical to the server's (both take the non-bypass branch
  // below) — instead of reading localStorage synchronously during render, which
  // would desync from SSR and trigger a hydration mismatch.
  const [e2e, setE2e] = useState<E2eBypassSession | null>(null);
  useEffect(() => {
    setE2e(getE2eBypassSession());
  }, []);
  const e2ePk = useMemo(() => {
    if (!e2e) return null;
    try {
      return new PublicKey(e2e.wallet);
    } catch {
      return null;
    }
  }, [e2e]);

  // The address of the wallet the user actually LOGGED IN with (e.g. Solflare).
  const loginAddress = useMemo(() => getLoginWalletAddress(user), [user]);

  // The active SPENDING wallet = the connected Privy wallet matching the login
  // wallet, so we sign with the wallet the user logged in with — never another
  // installed extension (Phantom) that the wallet-adapter happened to select.
  const privyWallet = useMemo(
    () => selectActiveWallet(privyWallets, loginAddress) ?? undefined,
    [privyWallets, loginAddress],
  );
  const privyAddress = privyWallet?.address ?? null;
  const privyPk = useMemo(() => {
    if (!privyAddress) return null;
    try {
      return new PublicKey(privyAddress);
    } catch {
      return null;
    }
  }, [privyAddress]);

  const signViaPrivy = useCallback(
    async <T extends AnyTx>(tx: T): Promise<T> => {
      if (!privyWallet) throw new Error("Wallet not connected.");
      const network = getNetwork();
      const chain =
        network === "mainnet-beta" ? ("solana:mainnet" as const)
        : network === "testnet" ? ("solana:testnet" as const)
        : ("solana:devnet" as const);
      return signTransactionViaBytes(tx, async (serialized) => {
        const { signedTransaction } = await privySignBytes({
          transaction: serialized,
          wallet: privyWallet,
          chain,
        });
        return signedTransaction;
      });
    },
    [privyWallet, privySignBytes],
  );

  // Sign-In-With-Solana message signing. Mirrors signViaPrivy: prefer the Privy
  // wallet (deterministically prompts the login wallet), fall back to the adapter
  // signer for the no-Privy build. Both produce a raw 64-byte Ed25519 signature.
  const signMessageViaPrivy = useCallback(
    async (message: Uint8Array): Promise<Uint8Array> => {
      if (!privyWallet) throw new Error("Wallet not connected.");
      const embedded = user?.linkedAccounts.some(
        (account) => account.type === "wallet"
          && account.address === privyWallet.address
          && account.walletClientType === "privy",
      ) ?? false;
      const { signature } = await privySignMessage({
        message,
        wallet: privyWallet,
        // This signer is used only for account-bound SIWS authentication.
        // Transaction signing retains its normal approval UI.
        options: { uiOptions: { showWalletUIs: !embedded } },
      });
      return signature;
    },
    [privyWallet, privySignMessage, user],
  );

  // Privy owns the login, so its wallet is the source of truth for WHICH account
  // is active AND how we sign. We ALWAYS sign through Privy (`signViaPrivy`) when
  // a Privy wallet exists — Privy's signer deterministically prompts that exact
  // wallet, so the login wallet (Solflare) opens, never whatever extension the
  // wallet-adapter auto-selected (Phantom). The wallet-adapter signer is only a
  // fallback for the no-Privy (legacy) build.
  const publicKey = !authenticated
    ? null
    : (privyPk ?? (adapterPk && adapterSign ? adapterPk : null));
  const signTransaction = !authenticated
    ? undefined
    : privyWallet
      ? signViaPrivy
      : adapterPk && adapterSign
        ? adapterSign
        : undefined;
  const signMessage = !authenticated
    ? undefined
    : privyWallet
      ? signMessageViaPrivy
      : adapterPk && adapterSignMessage
        ? adapterSignMessage
        : undefined;

  if (e2e) {
    return {
      publicKey: e2ePk,
      // On-chain calls are mocked in E2E; return the tx unsigned and a dummy 64-byte
      // signature. The server bypass authorizes the request without a real signature.
      signTransaction: e2ePk ? async <T extends AnyTx>(tx: T): Promise<T> => tx : undefined,
      signMessage: e2ePk ? async (_message: Uint8Array): Promise<Uint8Array> => new Uint8Array(64) : undefined,
      connected: !!e2ePk,
      connecting: false,
    };
  }

  return {
    publicKey,
    signTransaction,
    signMessage,
    connected: !!publicKey,
    // `!ready` covers Privy's initial session restore so callers can show a
    // loading state instead of flashing "Connect Wallet" on every page load.
    connecting: adapterConnecting || !ready,
  };
}
