"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConnection } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets as usePrivySolanaWallets } from "@privy-io/react-auth/solana";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Wallet,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useFullSignOut } from "@/providers/wallet-provider";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { getNetwork, getTxExplorerUrl, getAccountExplorerUrl, isMainnet } from "@/lib/solana/network";
import { selectActiveWallet, isEmbeddedWallet, getLoginWalletAddress } from "@/lib/solana/activeWallet";
import AddFundsButton from "@/components/wallet/AddFundsButton";
import { useSolBalance } from "./wallet-button";
import flashAvatar from "@/assets/flash.jpeg";

const MINT = "bg-[#a7f3c0] text-[#06210f] hover:bg-[#bdf7d1]";
const short = (a: string, n = 4) => `${a.slice(0, n)}…${a.slice(-n)}`;
const usdFmt = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Activity = { signature: string; time: number | null; failed: boolean };

/** Top-bar account: Deposit, quick create, balance chip with the wallet panel, and the profile avatar. */
export function AccountMenu() {
  const router = useRouter();
  const { connection } = useConnection();
  const { user } = usePrivy();
  const { profile } = useSupabaseAuth();
  const { wallets: privyWallets } = usePrivySolanaWallets();
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const signOut = useFullSignOut();
  const usd = useSolUsd();
  const address = publicKey?.toBase58() ?? null;
  const sol = useSolBalance(address);
  const privyWallet = useMemo(
    () =>
      selectActiveWallet(
        privyWallets as Array<{ address?: string; walletClientType?: string; meta?: { name?: string } }> | undefined,
        getLoginWalletAddress(user),
      ) ?? undefined,
    [privyWallets, user],
  );
  const embedded = !!privyWallet && isEmbeddedWallet(privyWallet);
  const walletName = embedded
    ? "Solcameo"
    : (privyWallet?.meta?.name ?? "Wallet");
  const network = getNetwork();
  const dollars = sol != null && usd ? sol * usd : null;

  const [open, setOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [tab, setTab] = useState<"send" | "activity">("send");
  const [copied, setCopied] = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  const copy = useCallback(() => {
    if (!address) return;
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [address]);

  // --- Send SOL -----------------------------------------------------------
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  async function send() {
    if (!publicKey || !signTransaction || sending) return;
    setSendError("");
    setSent(null);
    let recipient: PublicKey;
    try {
      recipient = new PublicKey(to.trim());
    } catch {
      setSendError("Enter a valid Solana address.");
      return;
    }
    const lamports = Math.round(Number(amount) * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      setSendError("Enter an amount greater than 0.");
      return;
    }
    if (sol != null && lamports > Math.round(sol * LAMPORTS_PER_SOL) - 5000) {
      setSendError("Not enough SOL after the network fee.");
      return;
    }
    setSending(true);
    try {
      const block = await connection.getLatestBlockhash("confirmed");
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: block.blockhash,
          instructions: [SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: recipient, lamports })],
        }).compileToV0Message(),
      );
      const signed = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
      const result = await connection.confirmTransaction({ signature, ...block }, "confirmed");
      if (result.value.err) throw new Error("The transfer failed on chain.");
      setSent(signature);
      setTo("");
      setAmount("");
      window.dispatchEvent(new Event("solcameo:trade-confirmed"));
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Transfer failed. Please retry.");
    } finally {
      setSending(false);
    }
  }

  // --- Activity -----------------------------------------------------------
  const [activity, setActivity] = useState<Activity[] | null>(null);
  useEffect(() => {
    if (!open || tab !== "activity" || !publicKey) return;
    let live = true;
    connection
      .getSignaturesForAddress(publicKey, { limit: 8 }, "confirmed")
      .then((rows) => {
        if (live) setActivity(rows.map((r) => ({ signature: r.signature, time: r.blockTime ?? null, failed: !!r.err })));
      })
      .catch(() => live && setActivity([]));
    return () => {
      live = false;
    };
  }, [open, tab, publicKey, connection, sent]);

  // --- Devnet airdrop -----------------------------------------------------
  const [airdropping, setAirdropping] = useState(false);
  const [airdropError, setAirdropError] = useState("");
  async function airdrop() {
    if (!publicKey) return;
    setAirdropping(true);
    setAirdropError("");
    try {
      const signature = await connection.requestAirdrop(publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature, "confirmed");
      window.dispatchEvent(new Event("solcameo:trade-confirmed"));
    } catch {
      setAirdropError("The devnet faucet is rate limited. Try again in a minute.");
    } finally {
      setAirdropping(false);
    }
  }

  if (!address) return null;
  const chip = dollars != null ? usdFmt(dollars) : sol != null ? `${sol.toFixed(3)} SOL` : "···";
  const field =
    "h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-white/25";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setDepositOpen(true)}
        className="hidden h-10 items-center rounded-lg bg-[#d7ff00] px-4 text-sm font-semibold text-black transition-colors hover:bg-[#e4ff59] active:scale-[0.98] sm:flex"
      >
        Deposit
      </button>
      <Link
        href="/create"
        aria-label="Create"
        className="hidden size-10 place-items-center rounded-lg border border-white/10 bg-[#14161a] text-zinc-200 transition-colors hover:border-white/25 hover:text-white sm:grid"
      >
        <Plus className="size-4" />
      </Link>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-[#14161a] px-3.5 text-sm font-medium text-white tabular-nums transition-colors hover:border-white/25"
            />
          }
        >
          {chip}
          <ChevronDown className={`size-3.5 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={10}
          className="w-[min(19rem,calc(100vw-1.5rem))] gap-0 overflow-hidden rounded-xl border border-white/10 bg-[#141619] p-0 text-zinc-200 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] ring-0"
        >
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-gradient-to-b from-white/[0.04] to-transparent px-4 py-3">
            <span className="text-sm font-medium text-white">Your balance</span>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
              aria-label="Copy wallet address"
            >
              {short(address, 6)}
              {copied ? <Check className="size-3.5 text-[#a7f3c0]" /> : <Copy className="size-3.5" />}
            </button>
          </div>

          <div className="px-4 pb-4 pt-3">
            <p className="text-2xl font-medium tracking-tight text-white tabular-nums">
              {dollars != null ? usdFmt(dollars) : "···"}
            </p>
            <div className="mt-3 flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-full bg-black ring-1 ring-white/10">
                <span className="size-3 rounded-sm bg-gradient-to-br from-[#9945ff] to-[#14f195]" />
              </span>
              <span className="text-sm text-white">SOL</span>
              <span className="ml-auto text-sm text-white tabular-nums">
                {sol != null ? `${sol.toFixed(4)} SOL` : "···"}
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">{dollars != null ? usdFmt(dollars) : ""}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDepositOpen(true);
              }}
              className="mt-4 h-10 w-full rounded-lg bg-[#d7ff00] text-sm font-semibold text-black transition-colors hover:bg-[#e4ff59] active:scale-[0.98]"
            >
              Deposit
            </button>
          </div>

          <div className="flex items-center gap-3 border-t border-white/[0.07] px-4 py-3">
            <span className="grid size-8 place-items-center rounded-lg bg-white/[0.05] text-[#c9b8ff]">
              <Wallet className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-zinc-500">Connected with</p>
              <p className="truncate text-sm text-white">
                {walletName} <span className="text-zinc-400">· {embedded ? "embedded wallet" : "external wallet"}</span>
              </p>
            </div>
          </div>

          <div className="border-t border-white/[0.07] px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="inline-flex rounded-lg border border-white/10 p-0.5" role="tablist">
                {(["send", "activity"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`rounded-md px-3 py-1 text-xs capitalize transition-colors ${tab === t ? "bg-white/[0.08] text-white" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <a
                href={getAccountExplorerUrl(address)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200"
              >
                Explorer <ExternalLink className="size-3" />
              </a>
            </div>

            {tab === "send" ? (
              <form
                className="mt-3 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="Recipient address"
                  aria-label="Recipient address"
                  spellCheck={false}
                  className={field}
                />
                <div className="relative">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    inputMode="decimal"
                    aria-label="Amount in SOL"
                    className={`${field} pr-24`}
                  />
                  <span className="absolute right-3 top-2 flex items-center gap-2 text-xs text-zinc-500">
                    <button
                      type="button"
                      onClick={() => sol != null && setAmount(Math.max(0, sol - 0.00001).toFixed(5))}
                      className="rounded bg-white/[0.06] px-1.5 py-0.5 text-zinc-300 hover:text-white"
                    >
                      Max
                    </button>
                    SOL
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={sending || !to || !amount}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white/[0.08] text-sm font-medium text-white transition-colors hover:bg-white/[0.12] disabled:opacity-40"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
                  {sending ? "Confirming on Solana…" : "Send SOL"}
                </button>
                {sendError && (
                  <p role="alert" className="text-xs text-red-300">
                    {sendError}
                  </p>
                )}
                {sent && (
                  <p role="status" className="flex items-center gap-2 rounded-lg bg-[#a7f3c0]/10 px-3 py-2 text-xs text-[#a7f3c0]">
                    <Check className="size-3.5" /> Sent.
                    <a href={getTxExplorerUrl(sent)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      View transaction
                    </a>
                  </p>
                )}
              </form>
            ) : (
              <ul className="mt-3 divide-y divide-white/[0.06]">
                {activity === null ? (
                  <li className="py-6 text-center text-sm text-zinc-600">Loading…</li>
                ) : !activity.length ? (
                  <li className="py-6 text-center text-sm text-zinc-600">No transactions yet.</li>
                ) : (
                  activity.map((a) => (
                    <li key={a.signature}>
                      <a
                        href={getTxExplorerUrl(a.signature)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between py-2.5 text-sm text-zinc-300 hover:text-white"
                      >
                        <span className="tabular-nums">{short(a.signature, 6)}</span>
                        <span className={`text-xs ${a.failed ? "text-red-300" : "text-zinc-500"}`}>
                          {a.failed ? "Failed" : a.time ? new Date(a.time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Confirmed"}
                        </span>
                      </a>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <div className="border-t border-white/[0.07]">
            <button
              type="button"
              onClick={() => setShowAccount((v) => !v)}
              aria-expanded={showAccount}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-zinc-400 transition-colors hover:text-zinc-200"
            >
              <span>{profile?.name ?? profile?.email ?? "Account"}</span>
              <ChevronDown className={`size-4 transition-transform ${showAccount ? "rotate-180" : ""}`} />
            </button>
            {showAccount && (
              <div className="grid gap-0.5 px-2 pb-2 text-[13px]">
                {[
                  ["My profile", "/profile"],
                  ["My agents", "/control"],
                  ["Generations", "/generations"],
                  ["Billing & credits", "/billing"],
                  ...(profile?.isAdmin ? [["Admin panel", "/admin"]] : []),
                ].map(([label, href]) => (
                  <button
                    key={href}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(href);
                    }}
                    className="rounded-lg px-3 py-1.5 text-left text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-white"
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="rounded-lg px-3 py-1.5 text-left text-red-400 transition-colors hover:bg-red-400/10"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        aria-label="Account"
        className="relative size-11 shrink-0 rounded-full transition-transform hover:scale-[1.04] active:scale-95"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- bundled avatar */}
        <img src={flashAvatar.src} alt="" className="size-11 rounded-full object-cover ring-1 ring-white/20" />
      </button>

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="max-w-md rounded-2xl border border-white/10 bg-[#141619] text-zinc-200">
          <DialogHeader>
            <DialogTitle className="text-lg text-white">Deposit</DialogTitle>
            <DialogDescription className="text-zinc-500">
              Send SOL on {network === "mainnet-beta" ? "Solana mainnet" : `Solana ${network}`} to your Solcameo wallet. It
              arrives on chain and your balance updates automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs text-zinc-500">Your wallet address</p>
            <p className="mt-1 break-all font-mono text-sm text-white">{address}</p>
            <button
              type="button"
              onClick={copy}
              className={`mt-3 flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold ${MINT}`}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy address"}
            </button>
          </div>
          {isMainnet() ? (
            <AddFundsButton address={address} onRefresh={() => window.dispatchEvent(new Event("solcameo:trade-confirmed"))} label="Buy with card" />
          ) : (
            <div>
              <button
                type="button"
                onClick={() => void airdrop()}
                disabled={airdropping}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-white/[0.08] text-sm font-medium text-white hover:bg-white/[0.12] disabled:opacity-50"
              >
                {airdropping && <Loader2 className="size-4 animate-spin" />}
                Get 1 devnet SOL
              </button>
              {airdropError && <p className="mt-2 text-xs text-amber-300">{airdropError}</p>}
              <p className="mt-2 text-xs text-zinc-600">Devnet SOL is for testing and has no monetary value.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
