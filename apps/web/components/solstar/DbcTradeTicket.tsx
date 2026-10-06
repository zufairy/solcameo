"use client";
import { getNetwork, getTxExplorerUrl } from "@/lib/solana/network";
import { useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import {
  ensureSiwsViaRegistered,
  getCurrentSiwsToken,
  getCurrentSiwsWallet,
} from "@/lib/client/siwsIdentity";
import { parseUnits } from "@/lib/solstar/terminal";
import { AlertTriangle, ArrowUpRight, Check, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { SolLogo } from "./SolLogo";
import { AnimatePresence, motion } from "framer-motion";
import { useSolUsd } from "@/lib/client/useSolUsd";
import { Input } from "@/components/ui/input";
import type { MarketRow } from "./MarketTable";

type Pending = { receipt: string; transaction: string; signature: string };
const human = (units: bigint, decimals: number) => {
  const scale = 10n ** BigInt(decimals);
  return (
    `${units / scale}.${(units % scale).toString().padStart(decimals, "0")}`.replace(
      /\.?0+$/,
      "",
    ) || "0"
  );
};
export function DbcTradeTicket({
  characterId,
  ticker,
  network,
  mint,
}: {
  characterId: MarketRow["characterId"];
  ticker: string;
  network: string;
  mint?: string;
}) {
  const { publicKey, signTransaction, connecting } = useUnifiedSolanaWallet();
  const { login, getFreshToken } = useSupabaseAuth();
  const { connection } = useConnection();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [signature, setSignature] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [balance, setBalance] = useState<{
    sol: bigint;
    tokens: bigint;
    decimals: number;
  } | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const [quote, setQuote] = useState<{
    key: string;
    minimumOut: string;
    jupiter?: { betterByPct: number; route: string };
  } | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [toast, setToast] = useState<{ text: string; signature: string } | null>(null);
  // Buy amounts can be typed in dollars; the SOL amount below stays the single source of truth for quotes and swaps.
  const [usdMode, setUsdMode] = useState(false);
  const [usdTyped, setUsdTyped] = useState<{ text: string; sol: string } | null>(null);
  const locked = useRef(false);
  const wallet = publicKey?.toBase58();
  const storage = `solcameo-dbc-trade-${network}-${characterId}-${wallet}`;
  const compatible =
    network === (getNetwork() === "mainnet-beta" ? "mainnet" : getNetwork());
  const decimals = side === "buy" ? 9 : (balance?.decimals ?? 6);
  const units = parseUnits(amount, decimals);
  const slip = Number(slippage);
  const validSlip = Number.isFinite(slip) && slip >= 0.1 && slip <= 10;
  const available = balance
    ? side === "buy"
      ? balance.sol > 10000000n
        ? balance.sol - 10000000n
        : 0n
      : balance.tokens
    : 0n;
  const percent =
    units && available > 0n
      ? Math.min(100, Number((units * 100n) / available))
      : 0;
  const quoteKey = `${side}:${units}:${slippage}`;

  useEffect(() => {
    try {
      // Also recover packets saved by the previous trade form.
      const saved =
        sessionStorage.getItem(storage) ??
        sessionStorage.getItem(`solcameo-dbc-trade-${characterId}-${wallet}`);
      const packet = saved ? JSON.parse(saved) : null;
      // Restore external browser storage after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPending(packet);
      setSignature(packet?.signature ?? "");
    } catch {
      setPending(null);
    }
  }, [storage, characterId, wallet]);
  useEffect(() => {
    if (!wallet || !compatible || !mint) return;
    let stopped = false,
      refreshing = false;
    // Clear the previous wallet balance while the new RPC request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBalance(null);
    const refresh = async () => {
      if (refreshing || stopped || document.hidden) return;
      refreshing = true;
      try {
        const owner = new PublicKey(wallet);
        const [sol, tokens] = await Promise.all([
          connection.getBalance(owner, "confirmed"),
          connection.getParsedTokenAccountsByOwner(
            owner,
            { mint: new PublicKey(mint) },
            "confirmed",
          ),
        ]);
        const accounts = tokens.value.map(
          (a) => a.account.data.parsed.info.tokenAmount,
        );
        if (!stopped) {
          setBalance({
            sol: BigInt(sol),
            tokens: accounts.reduce(
              (sum: bigint, a) => sum + BigInt(a.amount),
              0n,
            ),
            decimals: accounts[0]?.decimals ?? 6,
          });
          setBalanceError("");
        }
      } catch {
        if (!stopped)
          setBalanceError("Balance unavailable. Retry when RPC reconnects.");
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    window.addEventListener("solcameo:trade-confirmed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("solcameo:trade-confirmed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [wallet, connection, compatible, mint]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  // The "Swap confirmed" notice (and its link, which the toast also carries) fades away on its own.
  useEffect(() => {
    if (!message || error || busy || !/^Swap confirmed/.test(message)) return;
    const timer = setTimeout(() => { setMessage(""); if (!pending) setSignature(""); }, 5000);
    return () => clearTimeout(timer);
  }, [message, error, busy, pending]);
  const clearSaved = () => {
    sessionStorage.removeItem(storage);
    sessionStorage.removeItem(`solcameo-dbc-trade-${characterId}-${wallet}`);
    setPending(null);
    setSignature("");
  };
  async function call(
    body: unknown,
    auth: string,
    siws: string,
    signal?: AbortSignal,
  ) {
    const res = await fetch("/api/meteora/trade", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth}`,
        "x-siws-session": siws,
      },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(25000),
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        data.error || "Trading service unavailable. Please retry.",
      );
    return data;
  }
  useEffect(() => {
    if (!wallet || !units || busy || pending || !compatible) return;
    const refreshQuote = () => {
      if (!document.hidden) setQuoteRevision(value => value + 1);
    };
    const timer = setInterval(refreshQuote, 10000);
    window.addEventListener("solcameo:trade-confirmed", refreshQuote);
    window.addEventListener("focus", refreshQuote);
    return () => {
      clearInterval(timer);
      window.removeEventListener("solcameo:trade-confirmed", refreshQuote);
      window.removeEventListener("focus", refreshQuote);
    };
  }, [wallet, units, busy, pending, compatible]);
  useEffect(() => {
    if (
      !units ||
      !validSlip ||
      !compatible ||
      !wallet ||
      busy ||
      pending ||
      getCurrentSiwsWallet() !== wallet ||
      !getCurrentSiwsToken()
    )
      return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const auth = await getFreshToken(),
          siws = getCurrentSiwsToken();
        if (!auth || !siws || controller.signal.aborted) return;
        const result = await call(
          {
            action: "quote",
            characterId,
            side,
            amount: units.toString(),
            slippageBps: Math.round(slip * 100),
          },
          auth,
          siws,
          AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        );
        if (!controller.signal.aborted) {
          setQuote({ key: quoteKey, minimumOut: result.minimumOut, jupiter: result.jupiter });
          setQuoteError("");
        }
      } catch {
        if (!controller.signal.aborted)
          setQuoteError(
            "Quote unavailable. Buy / Sell will request a fresh quote.",
          );
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Input changes invalidate the quote; wallet verification is only prompted on trade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, quoteRevision, wallet, compatible, busy, pending, characterId, getFreshToken]);

  // The position card's "Sell 25% / Close position" buttons fill this ticket; the wallet still approves the swap.
  useEffect(() => {
    const onPrefill = (event: Event) => {
      const { side: s, percent } = (event as CustomEvent<{ side: "sell"; percent: number }>).detail;
      if (s !== "sell" || !balance) return;
      setSide("sell");
      setAmount(human((balance.tokens * BigInt(Math.min(100, Math.max(1, Math.round(percent))))) / 100n, balance.decimals));
      setMessage("");
    };
    window.addEventListener("solcameo:trade-prefill", onPrefill);
    return () => window.removeEventListener("solcameo:trade-prefill", onPrefill);
  }, [balance]);
  function allocate(value: number) {
    setAmount(human((available * BigInt(value)) / 100n, decimals));
    setMessage("");
  }
  async function trade() {
    if (locked.current) return;
    if (!publicKey || !signTransaction) {
      login();
      return;
    }
    if (!compatible) {
      setError(true);
      setMessage(
        `This market uses ${network}. Switch to the matching app network to trade.`,
      );
      return;
    }
    if (!pending && (!units || !validSlip)) {
      setError(true);
      setMessage("Enter an amount and slippage between 0.1% and 10%.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(false);
    setMessage("Verifying your wallet…");
    let packet = pending;
    try {
      const auth = await getFreshToken();
      if (!auth) throw new Error("Sign in again to trade.");
      const siws = await ensureSiwsViaRegistered();
      if (!siws || getCurrentSiwsWallet() !== wallet)
        throw new Error(
          "Wallet verification did not complete. Approve the sign-in message and retry.",
        );
      if (!packet) {
        setMessage("Fetching a fresh pool quote…");
        const prepared = await call(
          {
            action: "prepare",
            characterId,
            side,
            amount: units!.toString(),
            slippageBps: Math.round(slip * 100),
          },
          auth,
          siws,
        );
        setQuote({ key: quoteKey, minimumOut: prepared.minimumOut, jupiter: prepared.jupiter });
        setMessage(`Approve ${side} in your wallet…`);
        const tx = VersionedTransaction.deserialize(
          Uint8Array.from(atob(prepared.transaction), (c) => c.charCodeAt(0)),
        );
        const signed = await signTransaction(tx);
        packet = {
          receipt: prepared.receipt,
          transaction: btoa(String.fromCharCode(...signed.serialize())),
          signature: bs58.encode(signed.signatures[0]),
        };
        // Save BEFORE broadcasting: an ambiguous send must never cause a second swap.
        sessionStorage.setItem(storage, JSON.stringify(packet));
        setPending(packet);
        setSignature(packet.signature);
      }
      setMessage("Sending your signed swap…");
      try {
        await call({ action: "submit", ...packet }, auth, siws);
      } catch (e) {
        // A timed-out send can still land, so only transient errors fall through to
        // the signature check. A swap rejected on review or by the RPC is final.
        const text = e instanceof Error ? e.message : "";
        if (/differs|Invalid|expired|Blockhash not found|insufficient|custom program error|simulation/i.test(text)) {
          clearSaved();
          throw new Error(
            /differs/i.test(text)
              ? "Your wallet changed the swap after review. Nothing was sent and no funds moved. Press Buy again for a fresh quote."
              : `${text} Nothing was confirmed. Press Buy again for a fresh quote.`,
          );
        }
      }
      setMessage("Confirming on Solana…");
      for (let i = 0; i < 30; i++) {
        let result;
        try {
          result = await call({ action: "confirm", ...packet }, auth, siws);
        } catch (e) {
          if (!(e instanceof Error) || !e.message.includes("not confirmed"))
            throw e;
          if (i % 5 === 0) {
            try {
              await call({ action: "submit", ...packet }, auth, siws);
            } catch {
              /* Re-send identical bytes only. */
            }
          }
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (result.discarded) {
          clearSaved();
          throw new Error(`${result.reason} Press Buy again for a fresh quote.`);
        }
        if (result.expired || result.failed || result.confirmed) {
          sessionStorage.removeItem(storage);
          sessionStorage.removeItem(
            `solcameo-dbc-trade-${characterId}-${wallet}`,
          );
          setPending(null);
          if (result.failed)
            throw new Error(
              "Swap failed on chain. Network fees may apply. Request a fresh quote to retry.",
            );
          if (result.expired)
            throw new Error(
              "Swap expired without landing. You can safely retry with a fresh quote.",
            );
          setAmount("");
          setMessage(
            `Swap confirmed. ${result.historyWarning ?? "Balances and market data are updating."}`,
          );
          setToast({
            text: `${side === "buy" ? "Bought" : "Sold"} ${ticker} successfully`,
            signature: packet.signature,
          });
          window.dispatchEvent(new Event("solcameo:trade-confirmed"));
          return;
        }
      }
      setMessage(
        "Still pending. Use Resume swap to check this transaction without placing another order.",
      );
    } catch (e) {
      setError(true);
      setMessage(
        e instanceof Error ? e.message : "Trade unavailable. Please retry.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const solUsd = useSolUsd();
  const solAmount = side === "buy" ? Number(amount) : quote?.key === quoteKey ? Number(quote.minimumOut) / 1e9 : NaN;
  const usdValue = solUsd && Number.isFinite(solAmount) && solAmount > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(solAmount * solUsd) : null;
  const idle = busy || !!pending;
  const usdActive = usdMode && side === "buy" && !!solUsd;
  const trimSol = (n: number) => (Number.isFinite(n) && n > 0 ? n.toFixed(9).replace(/\.?0+$/, "") : "");
  const inputValue = usdActive
    ? usdTyped && usdTyped.sol === amount ? usdTyped.text : Number(amount) > 0 ? String(+(Number(amount) * solUsd!).toFixed(2)) : ""
    : amount;
  const onAmountInput = (raw: string) => {
    setQuoteError("");
    if (!usdActive) { setAmount(raw); return; }
    const clean = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    const sol = clean ? trimSol(Number(clean) / solUsd!) : "";
    setUsdTyped({ text: clean, sol });
    setAmount(sol);
  };
  const pickCurrency = (usd: boolean) => { setUsdMode(usd); setUsdTyped(null); };
  const usdPresets = [10, 25, 100];
  const usd2 = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
  const buyPresets = [0.1, 0.5, 1];
  const ctaLabel = busy
    ? "Processing swap…"
    : connecting
      ? "Connecting…"
      : !compatible
        ? `Market on ${network}`
        : !wallet
          ? "Connect wallet"
          : pending
            ? "Resume pending swap"
            : !units
              ? "Enter an amount"
              : `${side === "buy" ? "Buy" : "Sell"} ${ticker}`;
  const ctaDisabled = busy || connecting || !compatible || (!!wallet && !pending && (!units || !validSlip));
  const ctaReady = !ctaDisabled && (!wallet || !!pending || !!units);
  const chip = (on: boolean) =>
    `h-8 rounded-[8px] border font-sans text-[12px] font-semibold tabular-nums transition-colors disabled:opacity-40 ${on ? (side === "buy" ? "border-[#d7ff00]/40 bg-[#d7ff00]/10 text-[#d7ff00]" : "border-rose-400/40 bg-rose-400/10 text-rose-300") : "border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:text-white"}`;
  return (
    <div className="p-3">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.signature}
            role="status"
            aria-live="assertive"
            initial={{ opacity: 0, y: 18, scale: 0.96, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 10, scale: 0.97, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="fixed inset-x-4 bottom-4 z-50 overflow-hidden rounded-[20px] border border-white/[0.18] bg-[linear-gradient(135deg,rgba(255,255,255,0.16),rgba(255,255,255,0.04)_55%,rgba(215,255,0,0.07))] bg-[#0b0d0f]/55 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(255,255,255,0.04),0_28px_70px_-24px_rgba(0,0,0,0.9)] backdrop-blur-2xl backdrop-saturate-150 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[340px]"
          >
            <div aria-hidden className="pointer-events-none absolute -left-10 -top-12 size-32 rounded-full bg-[#d7ff00]/20 blur-3xl" />
            <div className="relative flex items-center gap-3 p-3.5 pr-3">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border border-white/25 bg-gradient-to-b from-white/[0.28] to-white/[0.06] text-[#d7ff00] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_6px_16px_-6px_rgba(215,255,0,0.45)]">
                <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold leading-tight tracking-tight">{toast.text}</p>
                <a
                  href={getTxExplorerUrl(toast.signature, network === "mainnet" ? "mainnet-beta" : "devnet")}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-white/55 transition-colors hover:text-white"
                >
                  View on Solscan <span aria-hidden>↗</span>
                </a>
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="grid size-7 shrink-0 place-items-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white">
                <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </div>
            <motion.div aria-hidden className="h-[2px] origin-left bg-[#d7ff00]/70" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 8, ease: "linear" }} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0b0c0e] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
        <div aria-hidden className={`pointer-events-none absolute -top-16 left-1/2 h-32 w-3/4 -translate-x-1/2 rounded-full blur-3xl transition-colors duration-500 ${side === "buy" ? "bg-[#d7ff00]/[0.08]" : "bg-rose-500/[0.10]"}`} />
        <div className="relative flex items-center gap-2">
          <div className="relative grid flex-1 grid-cols-2 rounded-xl border border-white/[0.07] bg-black/40 p-1" role="group" aria-label="Trade direction">
            {(["buy", "sell"] as const).map((sd) => (
              <button
                key={sd}
                type="button"
                disabled={idle}
                aria-pressed={side === sd}
                onClick={() => { setSide(sd); setAmount(""); setMessage(""); setQuoteError(""); }}
                className={`relative h-9 rounded-lg text-[14px] font-semibold capitalize transition-colors disabled:opacity-60 ${side === sd ? (sd === "buy" ? "text-black" : "text-white") : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {side === sd && <motion.span layoutId={`ticket-side-${characterId}`} transition={{ type: "spring", stiffness: 480, damping: 36 }} className={`absolute inset-0 rounded-lg ${sd === "buy" ? "bg-[#d7ff00] shadow-[0_6px_18px_-6px_rgba(215,255,0,0.5)]" : "bg-rose-500 shadow-[0_6px_18px_-6px_rgba(244,63,94,0.55)]"}`} />}
                <span className="relative">{sd}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Trade settings"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((v) => !v)}
            className={`grid size-9 shrink-0 place-items-center rounded-xl border transition-colors ${showSettings ? "border-white/20 bg-white/10 text-white" : "border-white/[0.07] bg-white/[0.03] text-zinc-500 hover:text-zinc-200"}`}
          >
            <Settings2 className="size-4" />
          </button>
        </div>
        {showSettings && (
          <label className="relative mt-2 flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400">
            Slippage limit %
            <Input
              aria-label="Slippage percent"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              disabled={idle}
              className="h-7 w-20 border-white/10 bg-black/30 text-right font-sans tabular-nums"
            />
          </label>
        )}
        <div className="relative mt-2 rounded-[10px] border border-white/[0.07] bg-white/[0.035] px-3.5 pb-2.5 pt-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors focus-within:border-white/25 focus-within:bg-white/[0.05]">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span>{side === "buy" ? "You pay" : "You sell"}</span>
            {balance ? (
              <button type="button" disabled={idle} onClick={() => allocate(100)} className="font-sans tabular-nums transition-colors hover:text-zinc-200">
                <span className="inline-flex items-center gap-1">
                  {side === "buy" && !usdActive && <SolLogo className="size-3" />}
                  {usdActive
                    ? `${usd2(Number(balance.sol) / 1e9 * solUsd!)} USD`
                    : `${human(side === "buy" ? balance.sol : balance.tokens, decimals)} ${side === "buy" ? "SOL" : ticker}`}
                </span>
              </button>
            ) : (
              <span className="font-sans tabular-nums">{wallet ? "Loading balance…" : "No wallet"}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Amount in ${usdActive ? "USD" : side === "buy" ? "SOL" : ticker}`}
              value={inputValue}
              onChange={(e) => onAmountInput(e.target.value)}
              disabled={idle}
              placeholder="0"
              inputMode="decimal"
              className="h-11 min-w-0 flex-1 border-0 bg-transparent px-0 font-sans text-[30px] font-semibold tabular-nums shadow-none placeholder:text-zinc-600 focus-visible:ring-0"
            />
            {side === "buy" ? (
              <button
                type="button"
                disabled={idle || !solUsd}
                onClick={() => pickCurrency(!usdActive)}
                aria-label={`Switch amount currency to ${usdActive ? "SOL" : "USD"}`}
                title={solUsd ? `Switch to ${usdActive ? "SOL" : "USD"}` : "USD rate unavailable"}
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[4px] border border-white/[0.12] bg-white/[0.06] px-2.5 text-[11px] font-semibold text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:border-white/25 hover:bg-white/10 disabled:opacity-40"
              >
                {usdActive ? <span aria-hidden>$</span> : <SolLogo className="size-3.5" />}
                <span>{usdActive ? "USD" : "SOL"}</span>
                <RefreshCw aria-hidden className="ml-0.5 size-3.5 text-zinc-400" />
              </button>
            ) : (
              <span className="shrink-0 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-xs font-semibold text-zinc-300">{ticker}</span>
            )}
          </div>
          <p className="flex h-4 items-center gap-1 font-sans text-[11px] tabular-nums text-zinc-500">
            {usdActive
              ? Number(amount) > 0 ? <>≈ <SolLogo className="size-3" />{Number(amount).toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL</> : null
              : usdValue != null ? (side === "sell" ? <>You receive ≈ <SolLogo className="size-3" />{solAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })} · {usdValue}</> : `≈ ${usdValue}`) : ""}
          </p>
        </div>
        <div className="relative mt-2 grid grid-cols-4 gap-1.5">
          {side === "buy"
            ? usdActive
              ? usdPresets.map((n) => (
                  <button key={n} type="button" disabled={idle} onClick={() => { const sol = trimSol(n / solUsd!); setUsdTyped({ text: String(n), sol }); setAmount(sol); setQuoteError(""); }} className={chip(usdTyped?.text === String(n) && usdTyped.sol === amount)}>{usd2(n)}</button>
                ))
              : buyPresets.map((n) => (
                  <button key={n} type="button" disabled={idle} onClick={() => { setAmount(String(n)); setQuoteError(""); }} className={chip(amount === String(n))}>{n} SOL</button>
                ))
            : [25, 50, 75].map((n) => (
                <button key={n} type="button" disabled={idle || !balance} onClick={() => allocate(n)} className={chip(percent === n)}>{n}%</button>
              ))}
          <button type="button" disabled={idle || !balance} onClick={() => allocate(100)} className={chip(percent === 100)}>Max</button>
        </div>
        <div className="relative mt-2.5 flex items-center justify-between px-0.5 text-[11px] text-zinc-500">
          <span>Min receive · {slippage || "1"}% slip</span>
          <span className="font-sans tabular-nums text-zinc-300">
            {quote?.key === quoteKey
              ? `${human(BigInt(quote.minimumOut), side === "buy" ? (balance?.decimals ?? 6) : 9)} ${side === "buy" ? ticker : "SOL"}`
              : "—"}
          </span>
        </div>
        {quote?.key === quoteKey && quote.jupiter && quote.jupiter.betterByPct >= 0.5 && mint && (
          <a
            href={`https://jup.ag/swap/${side === "buy" ? `SOL-${mint}` : `${mint}-SOL`}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center justify-between rounded-lg border border-sky-300/25 bg-sky-300/[0.07] px-2.5 py-1.5 text-[11px] text-sky-200 hover:bg-sky-300/[0.12]"
          >
            <span>Jupiter ({quote.jupiter.route}) quotes {quote.jupiter.betterByPct.toFixed(1)}% more</span>
            <span aria-hidden>Open ↗</span>
          </a>
        )}
        <button
          type="button"
          disabled={ctaDisabled}
          onClick={() => void trade()}
          className={`group relative mt-2.5 flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-[8px] text-[14px] font-bold tracking-[-0.01em] transition-[transform,filter,box-shadow] duration-200 active:scale-[.985] disabled:cursor-not-allowed ${ctaReady ? (side === "buy" ? "bg-[linear-gradient(180deg,#e6ff55_0%,#d7ff00_100%)] text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.65),inset_0_-1px_0_rgba(0,0,0,0.14),0_10px_26px_-12px_rgba(215,255,0,0.65)] hover:brightness-105" : "bg-[linear-gradient(180deg,#fb5b78_0%,#f43f5e_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.18),0_10px_26px_-12px_rgba(244,63,94,0.7)] hover:brightness-105") : "border border-white/[0.08] bg-white/[0.04] text-zinc-500"}`}
        >
          {ctaReady && <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/40 opacity-0 blur-md transition-all duration-700 group-hover:left-[110%] group-hover:opacity-70" />}
          {busy && <Loader2 className="relative size-4 animate-spin" />}
          <span className="relative">{ctaLabel}</span>
          {ctaReady && !busy && !!units && <ArrowUpRight className="relative size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.6} />}
        </button>
        {!compatible && (
          <p role="alert" className="mt-2 text-xs text-amber-300">
            This market is on {network}; the app is configured for {getNetwork()}. Trading requires matching networks.
          </p>
        )}
        {(balanceError || quoteError) && <p className="mt-2 text-[11px] text-amber-200">{balanceError || quoteError}</p>}
        <AnimatePresence initial={false}>
          {message && (
            <motion.div
              key={error ? "error" : busy ? "progress" : "done"}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div
                role={error ? "alert" : "status"}
                aria-live="polite"
                className={`mt-2.5 flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-[12px] leading-[18px] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl ${error ? "border-rose-400/25 bg-rose-500/[0.09] text-rose-100" : busy ? "border-white/[0.12] bg-white/[0.05] text-zinc-200" : "border-[#d7ff00]/25 bg-[linear-gradient(135deg,rgba(215,255,0,0.12),rgba(255,255,255,0.03))] text-white"}`}
              >
                <span aria-hidden className={`mt-px grid size-[18px] shrink-0 place-items-center rounded-full ${error ? "bg-rose-400/20 text-rose-300" : busy ? "text-zinc-300" : "bg-[#d7ff00] text-black"}`}>
                  {error ? <AlertTriangle className="size-3" /> : busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3" strokeWidth={3.2} />}
                </span>
                <p className="min-w-0 flex-1">
                  {/^Swap confirmed/.test(message)
                    ? <><b className="font-semibold">Swap confirmed</b><span className="text-white/60">{message.replace(/^Swap confirmed\.?/, "")}</span></>
                    : message}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {signature && (
          <a
            href={getTxExplorerUrl(signature, network === "mainnet" ? "mainnet-beta" : "devnet")}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block truncate font-sans tabular-nums text-[11px] text-emerald-300 underline underline-offset-4"
          >
            View transaction · {signature.slice(0, 8)}…
          </a>
        )}
      </div>
    </div>
  );
}
