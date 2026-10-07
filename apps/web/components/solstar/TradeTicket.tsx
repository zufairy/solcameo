"use client";
import { DbcTradeTicket } from "./DbcTradeTicket";
import { PositionCard } from "./PositionCard";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import {
  ensureSiwsViaRegistered,
  getCurrentSiwsToken,
  getCurrentSiwsWallet,
} from "@/lib/client/siwsIdentity";
import { quoteBuy, quoteSell } from "@/lib/solstar/economics";
import { parseUnits } from "@/lib/solstar/terminal";
import { formatSol } from "@/lib/solstar/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Token = NonNullable<
  FunctionReturnType<typeof api.solstarMarket.terminal>
>["token"];
const human = (units: bigint, decimals: number) =>
  `${units / 10n ** BigInt(decimals)}.${(units % 10n ** BigInt(decimals)).toString().padStart(decimals, "0")}`.replace(
    /\.?0+$/,
    "",
  );
export function TradeTicket({ token }: { token: Token }) {
  return token.dbcPool ? (
    <>
      <PositionCard characterId={token.characterId} ticker={token.ticker} network={token.network} />
      <DbcTradeTicket characterId={token.characterId} ticker={token.ticker} network={token.network} mint={token.mint ?? undefined} />
    </>
  ) : <PaperTradeTicket token={token} />;
}
function PaperTradeTicket({ token }: { token: Token }) {
  const { profile, login, getFreshToken } = useSupabaseAuth();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [slippage, setSlippage] = useState("1");
  const locked = useRef(false);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const wallet = getCurrentSiwsWallet() || profile?.walletAddress;
  const position = useQuery(
    api.solstarTrade.positionOf,
    wallet && token.network === "paper"
      ? { wallet, tokenId: token._id }
      : "skip",
  );
  const decimals = side === "buy" ? 9 : 6;
  const units = parseUnits(amount, decimals);
  const slip = Number(slippage);
  const quote = useMemo(() => {
    if (!units) return null;
    try {
      return side === "buy"
        ? quoteBuy(
            {
              solReserve: BigInt(token.solReserve),
              tokenReserve: BigInt(token.tokenReserve),
            },
            units,
          )
        : quoteSell(
            {
              solReserve: BigInt(token.solReserve),
              tokenReserve: BigInt(token.tokenReserve),
            },
            units,
          );
    } catch {
      return null;
    }
  }, [units, side, token.solReserve, token.tokenReserve]);
  async function trade() {
    if (
      locked.current ||
      !quote ||
      !Number.isFinite(slip) ||
      slip < 0.1 ||
      slip > 10
    )
      return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      const auth = await getFreshToken();
      if (!auth) throw new Error("Sign in to trade");
      const siws = getCurrentSiwsToken() || (await ensureSiwsViaRegistered());
      if (!siws) throw new Error("Verify your wallet to trade");
      const fingerprint = `${token._id}:${side}:${quote.amountIn}:${getCurrentSiwsWallet()}`;
      if (attempt.current?.key !== fingerprint)
        attempt.current = {
          key: fingerprint,
          body: JSON.stringify({
            tokenId: token._id,
            side,
            amount: quote.amountIn.toString(),
            minOut: (
              (quote.amountOut * BigInt(Math.floor(10000 - slip * 100))) /
              10000n
            ).toString(),
            quoteExpiresAt: Date.now() + 30000,
            idempotencyKey: crypto.randomUUID(),
          }),
        };
      const response = await fetch("/api/solstar/trade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth}`,
          "x-siws-session": siws,
        },
        body: attempt.current.body,
      });
      const d = await response.json();
      if (!response.ok) {
        if (response.status < 500) attempt.current = null;
        throw new Error(d.error || "Trade failed");
      }
      attempt.current = null;
      setMessage("Paper trade completed. Market updated.");
      setAmount("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Trade failed");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const disabled = token.network !== "paper" || token.state !== "paper";
  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-1">
        {(["buy", "sell"] as const).map((s) => (
          <Button
            key={s}
            disabled={busy}
            onClick={() => {
              setSide(s);
              setAmount("");
              setMessage("");
            }}
            variant="ghost"
            className={`flex-1 capitalize ${side === s ? (s === "buy" ? "bg-emerald-300 text-black hover:bg-emerald-200" : "bg-red-400 text-black hover:bg-red-300") : "text-zinc-500"}`}
          >
            {s}
          </Button>
        ))}
      </div>
      <label className="block text-xs text-zinc-500">
        Amount · {side === "buy" ? "SOL" : token.ticker}
        <Input
          value={amount}
          disabled={busy || disabled}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          className="mt-2 h-14 border-white/10 bg-[#1a1a1e] text-lg"
        />
      </label>
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {position
            ? side === "buy"
              ? `${formatSol(position.lamports)} paper SOL`
              : `${human(BigInt(position.tokens), 6)} ${token.ticker}`
            : "Connect to view balance"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!position || busy}
          onClick={() =>
            position &&
            setAmount(
              human(
                BigInt(side === "buy" ? position.lamports : position.tokens),
                decimals,
              ),
            )
          }
        >
          Max
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {(side === "buy" ? [0.1, 0.5, 1] : [25, 50, 100]).map((n) => (
          <Button
            key={n}
            variant="outline"
            disabled={busy || disabled}
            onClick={() =>
              setAmount(
                side === "buy"
                  ? String(n)
                  : position
                    ? human((BigInt(position.tokens) * BigInt(n)) / 100n, 6)
                    : "",
              )
            }
            className="border-white/10 bg-transparent text-zinc-500"
          >
            {n}
            {side === "buy" ? " SOL" : "%"}
          </Button>
        ))}
      </div>
      <label className="flex items-center justify-between text-xs text-zinc-500">
        Slippage %
        <Input
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
          type="number"
          min="0.1"
          max="10"
          step="0.1"
          disabled={busy}
          className="w-20 border-white/10"
        />
      </label>
      {quote && (
        <div className="space-y-1 text-xs text-zinc-400">
          <p className="flex justify-between">
            Est. receive
            <span className="text-white">
              {side === "buy"
                ? `${human(quote.amountOut, 6)} ${token.ticker}`
                : `${formatSol(quote.amountOut.toString())} SOL`}
            </span>
          </p>
          <p className="flex justify-between">
            Fee · 1.25%<span>{formatSol(quote.fee.toString())} SOL</span>
          </p>
        </div>
      )}
      <Button
        onClick={() => (profile ? void trade() : void login())}
        disabled={
          busy ||
          disabled ||
          (!!profile &&
            (!quote || !Number.isFinite(slip) || slip < 0.1 || slip > 10))
        }
        className={`h-12 w-full ${side === "buy" ? "bg-emerald-300 text-black hover:bg-emerald-200" : "bg-red-400 text-black hover:bg-red-300"}`}
      >
        {disabled
          ? "On-chain trading unavailable"
          : busy
            ? "Submitting…"
            : !profile
              ? "Sign in to trade"
              : !quote
                ? "Enter an amount"
                : `${side === "buy" ? "Buy" : "Sell"} ${token.ticker}`}
      </Button>
      <p className="text-[10px] leading-relaxed text-zinc-600">
        {disabled
          ? "Mint data is available through Solana RPC. A live trading venue is not configured for this token."
          : "Paper trading · simulated SOL, no on-chain transaction. Quotes include fees; final execution checks slippage."}
      </p>
      {message && (
        <p role="status" className="text-xs text-amber-200">
          {message.replaceAll("_", " ")}
        </p>
      )}
    </div>
  );
}
