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
import { Button } from "@/components/ui/button";
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
  } | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [toast, setToast] = useState<{ text: string; signature: string } | null>(null);
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
          setQuote({ key: quoteKey, minimumOut: result.minimumOut });
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
        setQuote({ key: quoteKey, minimumOut: prepared.minimumOut });
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
  const color =
    side === "buy"
      ? "bg-emerald-300 text-zinc-950 hover:bg-emerald-200"
      : "bg-rose-400 text-zinc-950 hover:bg-rose-300";
  return (
    <div className="space-y-3 border-b border-white/10 bg-[#151719] p-4">
      {toast && (
        <div
          role="status"
          aria-live="assertive"
          className="fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-emerald-300/30 bg-[#12201a] p-4 text-sm text-emerald-100 shadow-2xl"
        >
          <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-300 text-xs font-bold text-zinc-950">✓</span>
          <div className="min-w-0">
            <p className="font-medium">{toast.text}</p>
            <a
              href={getTxExplorerUrl(toast.signature, network === "mainnet" ? "mainnet-beta" : "devnet")}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-emerald-300 underline underline-offset-4"
            >
              View on Solscan
            </a>
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="text-emerald-300/60 hover:text-white">×</button>
        </div>
      )}
      <div
        className="flex rounded-lg bg-white/[.04] p-1"
        role="group"
        aria-label="Trade direction"
      >
        {(["buy", "sell"] as const).map((s) => (
          <Button
            key={s}
            disabled={busy || !!pending}
            aria-pressed={side === s}
            variant="ghost"
            onClick={() => {
              setSide(s);
              setAmount("");
              setMessage("");
              setQuoteError("");
            }}
            className={`h-10 flex-1 rounded-md font-semibold capitalize transition-colors ${side === s ? (s === "buy" ? "bg-emerald-300 text-zinc-950 hover:bg-emerald-200" : "bg-rose-400 text-zinc-950 hover:bg-rose-300") : "text-zinc-400"}`}
          >
            {s}
          </Button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-zinc-500">
        <span>You pay</span>
        <span className="font-sans tabular-nums">
          {balance
            ? `${human(side === "buy" ? balance.sol : balance.tokens, decimals)} ${side === "buy" ? "SOL" : ticker}`
            : wallet
              ? "Loading balance…"
              : "Connect wallet"}
        </span>
      </div>
      <div className="relative">
        <Input
          aria-label={`Amount in ${side === "buy" ? "SOL" : ticker}`}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setQuoteError("");
          }}
          disabled={busy || !!pending}
          placeholder="0.00"
          inputMode="decimal"
          className="h-14 rounded-lg border-white/10 bg-[#1d2023] pr-20 font-sans tabular-nums text-xl"
        />
        <span className="absolute right-3 top-5 text-xs font-medium text-zinc-400">
          {side === "buy" ? "SOL" : ticker}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {[25, 50, 75, 100].map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy || !!pending || !balance}
            onClick={() => allocate(n)}
            className="rounded-md border border-white/10 py-2 font-sans tabular-nums text-[11px] text-zinc-400 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
          >
            {n === 100 ? "Max" : `${n}%`}
          </button>
        ))}
      </div>
      <input
        type="range"
        aria-label="Percentage of available balance"
        min="0"
        max="100"
        step="1"
        value={percent}
        onChange={(e) => allocate(Number(e.target.value))}
        disabled={busy || !!pending || !balance}
        className={`h-2 w-full cursor-pointer ${side === "buy" ? "accent-emerald-300" : "accent-rose-400"}`}
      />
      <div className="flex justify-between text-[10px] text-zinc-600">
        <span>0%</span>
        <span>{percent}% of available balance</span>
        <span>100%</span>
      </div>
      {side === "buy" && (
        <p className="text-[10px] text-zinc-500">
          Max keeps 0.01 SOL for fees and account rent.
        </p>
      )}
      <label className="flex items-center justify-between text-xs text-zinc-400">
        Slippage limit %
        <Input
          aria-label="Slippage percent"
          type="number"
          min="0.1"
          max="10"
          step="0.1"
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
          disabled={busy || !!pending}
          className="h-8 w-20 border-white/10 bg-white/[.03] text-right font-sans tabular-nums"
        />
      </label>
      <div className="flex justify-between gap-2 border-t border-white/5 pt-3 text-[11px] text-zinc-500">
        <span>Minimum receive</span>
        <span className="font-sans tabular-nums text-zinc-200">
          {quote?.key === quoteKey
            ? `${human(BigInt(quote.minimumOut), side === "buy" ? (balance?.decimals ?? 6) : 9)} ${side === "buy" ? ticker : "SOL"}`
            : "Quoted before approval"}
        </span>
      </div>
      <Button
        disabled={
          busy ||
          connecting ||
          !compatible ||
          (!!wallet && !pending && (!units || !validSlip))
        }
        onClick={() => void trade()}
        className={`h-12 w-full rounded-lg font-semibold transition-colors active:scale-[.98] ${color}`}
      >
        {busy
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
                    : `${side === "buy" ? "Buy" : "Sell"} ${ticker}`}
      </Button>
      {!compatible && (
        <p role="alert" className="text-xs text-amber-300">
          This market is on {network}; the app is configured for {getNetwork()}.
          Trading requires matching networks.
        </p>
      )}
      {(balanceError || quoteError) && (
        <p className="text-[11px] text-amber-200">
          {balanceError || quoteError}
        </p>
      )}
      {message && (
        <p
          role={error ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-md p-2.5 text-xs leading-5 ${error ? "bg-rose-400/10 text-rose-300" : "bg-emerald-300/5 text-emerald-200"}`}
        >
          {message}
        </p>
      )}
      {signature && (
        <a
          href={getTxExplorerUrl(
            signature,
            network === "mainnet" ? "mainnet-beta" : "devnet",
          )}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-sans tabular-nums text-[11px] text-emerald-300 underline underline-offset-4"
        >
          View transaction · {signature.slice(0, 8)}…
        </a>
      )}
      <p className="text-[10px] leading-4 text-zinc-600">
        Meteora · {network}. Pool fees, network fees and account rent apply.
        Final execution enforces your slippage limit.
      </p>
    </div>
  );
}
