"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { ensureSiwsViaRegistered } from "@/lib/client/siwsIdentity";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getNetworkLabel } from "@/lib/solana/network";
import { Button } from "@/components/ui/button";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2, CheckCircle2, Rocket, Check } from "lucide-react";
import { unlockLaunchAudio } from "@/lib/client/launchSound";
import type { DbcOptions } from "@/lib/meteora/options";
import { Notice } from "./Notice";
import { LAUNCH_MIN_LAMPORTS, formatSol } from "@/lib/meteora/launchCost";

const LAUNCH_STEPS = [
  { title: "Approve curve", hint: "Tap Approve in your wallet to lock in your launch settings." },
  { title: "Create token", hint: "Approve once more to mint your coin and open its market." },
  { title: "Go live", hint: "Your character is trading and ready to make videos." },
];
type Pending = {
  mintSecret: number[];
  configSecret: number[];
  transaction: string;
  receipt: string;
  stage: "config" | "pool";
  signature?: string;
};
/** True only when the balance is known and too small to cover the launch (unknown is left to the server check). */
const lowSol = (lamports: number | null | undefined) => typeof lamports === "number" && lamports < LAUNCH_MIN_LAMPORTS.pool;
/** Launch progress survives closed tabs and reloads: localStorage first, session storage as a fallback. */
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { sessionStorage.setItem(k, v); } },
  remove: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function call(body: unknown, endpoint = "/api/meteora/launch") {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? "Launch failed."), {code: data.code});
  return data;
}
export function LiveDbcLaunch({
  characterId,
  endpoint = "/api/meteora/launch",
  platform = false,
  options,
  onComplete,
  autoStart = false,
  onProgress,
}: {
  characterId: string;
  endpoint?: string;
  platform?: boolean;
  options: DbcOptions;
  onComplete: () => void;
  autoStart?: boolean;
  onProgress?: (p: { step: number; status: string; busy: boolean; error: string }) => void;
}) {
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const { setVisible } = useWalletModal();
  const address = publicKey?.toBase58();
  const [networkCheck, setPreflight] = useState<{ ready: boolean; balanceLamports?: number | null; error?: string; forAddress?: string; check: number } | null>(null);
  const [check, setCheck] = useState(0);
  const preflight = networkCheck?.forAddress === address && networkCheck?.check === check ? networkCheck : null;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/meteora/readiness${address ? `?wallet=${encodeURIComponent(address)}` : ""}`, { signal: controller.signal }).then(r => r.json()).then(data => { if (!controller.signal.aborted) setPreflight({ ...data, forAddress: address, check }); }).catch(() => { if (!controller.signal.aborted) setPreflight({ ready: false, error: "Network check failed. Retry.", forAddress: address, check }); });
    return () => controller.abort();
  }, [address, check]);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [launchError, setError] = useState("");
  const [launchStep, setLaunchStep] = useState(0);
  const launchLock = useRef(false);
  const autoStarted = useRef(false);
  const reduced = useReducedMotion();
  const launch = useCallback(async () => {
    const callLaunch = (body: unknown) => call(body, endpoint);
    if (launchLock.current) return;
    if (!publicKey || !signTransaction) {
      setError("Connect your Solana wallet to approve the launch.");
      return;
    }
    if (!preflight?.ready || lowSol(preflight.balanceLamports)) {
      setError(!preflight?.ready ? (getNetworkLabel() === "Devnet" ? "Verify the devnet connection and fund your wallet with test SOL first." : "Verify the network connection, then launch.") : `Your wallet needs about ${formatSol(LAUNCH_MIN_LAMPORTS.total)} SOL for on-chain rent and fees before launching. Add SOL, then launch.`);
      return;
    }
    launchLock.current = true;
    setBusy(true);
    setError("");
    const key = `vello-dbc-${platform ? "platform" : "agent"}-${characterId}-${publicKey.toBase58()}`;
    const save = (v: Pending) => store.set(key, JSON.stringify(v));
    try {
      if (!await ensureSiwsViaRegistered()) throw new Error("Verify your wallet before minting.");
      let pending: Pending | null = JSON.parse(
        store.get(key) ?? "null",
      );
      if (pending) {
        const encoded = pending.receipt.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
        const receipt = JSON.parse(atob(encoded));
        if ((receipt.options?.economy ?? "creator-only") !== options.economy)
          throw new Error("This saved wallet transaction uses a different fee split. Start a new character launch for the 40/20/20 allocation; existing signed launch terms cannot be changed.");
      }
      if (!pending) {
        setStatus("Building your Meteora configuration…");
        const mint = Keypair.generate(),
          config = Keypair.generate();
        // Ask the server what already happened on chain, so a lost tab never strands a paid launch.
        const recovered = await callLaunch({ action: "recover", characterId, options, mint: mint.publicKey.toBase58() });
        if (recovered?.mode === "complete") { onComplete(); return; }
        const prepared = recovered?.mode === "resume" ? recovered : await callLaunch({
          action: "prepare",
          characterId,
          options,
          mint: mint.publicKey.toBase58(),
          config: config.publicKey.toBase58(),
        });
        // These are new, unfunded mint/config accounts, never the connected wallet's secret.
        pending = {
          mintSecret: [...mint.secretKey],
          configSecret: [...config.secretKey],
          transaction: prepared.transaction,
          receipt: prepared.receipt,
          stage: prepared.stage ?? "config",
        };
        save(pending);
      }
      for (let phase = 0; phase < 2; phase++) {
        if (!pending.signature) {
          setStatus("Checking saved launch progress…");
          const recovered = await callLaunch({
            action: "refresh",
            receipt: pending.receipt,
            transaction: pending.transaction,
          });
          if (recovered.signature) {
            pending.signature = recovered.signature;
            save(pending);
          } else {
            pending.transaction = recovered.transaction;
            pending.receipt = recovered.receipt;
            save(pending);
          }
        }
        if (!pending.signature) {
          for (let approval = 0; approval < 3 && !pending.signature; approval++) {
            const tx = VersionedTransaction.deserialize(decode(pending.transaction));
            tx.sign([Keypair.fromSecretKey(Uint8Array.from(pending.stage === "config" ? pending.configSecret : pending.mintSecret))]);
            setStatus(pending.stage === "config" ? "Approve the curve configuration in your wallet." : "Approve your token and pool creation in your wallet.");
            setLaunchStep(pending.stage === "config" ? 0 : 1);
            const signed = await signTransaction(tx);
            pending.transaction = encode(signed.serialize());
            save(pending);
            try {
              let result;
              for (let retry = 0; retry < 3; retry++) {
                try {
                  result = await callLaunch({action: "submit", receipt: pending.receipt, transaction: pending.transaction});
                  break;
                } catch (e) {
                  if ((e as {code?: string}).code !== "RPC_RETRY" || retry === 2) throw e;
                  setStatus("Syncing with Solana. Your approval is saved…");
                  await new Promise(resolve => setTimeout(resolve, 1200));
                }
              }
              pending.signature = result.signature;
              save(pending);
            } catch (e) {
              if ((e as {code?: string}).code !== "BLOCKHASH_EXPIRED" || approval === 2) throw e;
              setStatus("Refreshing your expired approval. Confirm the updated transaction in your wallet.");
              const recovered = await callLaunch({action: "refresh", receipt: pending.receipt, transaction: pending.transaction});
              if (recovered.signature) pending.signature = recovered.signature;
              else {pending.transaction = recovered.transaction; pending.receipt = recovered.receipt;}
              save(pending);
            }
          }
        }
        setLaunchStep(pending.stage === "config" ? 0 : 1);
        setStatus("Waiting for Solana confirmation…");
        let result;
        for (let attempt = 0; attempt < 36; attempt++) {
          try {
            result = await callLaunch({
              action: "confirm",
              receipt: pending.receipt,
              signature: pending.signature,
              transaction: pending.transaction,
            });
            break;
          } catch (e) {
            if ((e as { code?: string }).code === "BLOCKHASH_EXPIRED" || (e as { code?: string }).code === "TX_FAILED") {
              // This signature can never land: forget it so the next press of Launch asks for a fresh approval.
              pending.signature = undefined; save(pending);
              throw e;
            }
            if (!(e instanceof Error) || !e.message.includes("not confirmed")) throw e;
            if (attempt === 35) throw new Error("Solana is still confirming your transaction. Nothing is lost: press Launch to keep checking it.");
            // A busy network can drop a transaction that was only sent once. Re-send the same signed transaction
            // (same signature, so it can never land twice) while we wait.
            if (attempt % 3 === 2 && pending.transaction) {
              try { await callLaunch({ action: "submit", receipt: pending.receipt, transaction: pending.transaction }); } catch { /* already landed, expired, or still syncing */ }
              setStatus("Still confirming on Solana. Re-sending to speed it up…");
            }
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
        if (result?.complete) {
          store.remove(key);
          setLaunchStep(2);
          setStatus("Your Meteora pool is confirmed.");
          onComplete();
          return;
        }
        if (!result?.transaction)
          throw new Error("Launch saved. Resume to continue.");
        pending = {
          ...pending,
          stage: "pool",
          transaction: result.transaction,
          receipt: result.receipt,
          signature: undefined,
        };
        save(pending);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Launch needs attention. Progress is saved.",
      );
    } finally {
      launchLock.current = false;
      setBusy(false);
    }
  }, [publicKey, signTransaction, preflight, characterId, options, onComplete, endpoint, platform]);
  useEffect(() => {
    if (!autoStart || autoStarted.current || !publicKey || !signTransaction || !preflight?.ready || lowSol(preflight.balanceLamports)) return;
    autoStarted.current = true;
    void launch();
  }, [autoStart, publicKey, signTransaction, preflight, launch]);
  // When auto-start can't proceed, say why instead of leaving the launch guide waiting forever.
  const startBlock = autoStart && preflight && !busy && launchStep === 0
    ? (!publicKey || !signTransaction ? "Connect your Solana wallet to approve the launch."
      : !preflight.ready ? (preflight.error ?? "The network connection could not be verified. Check again, then launch.")
      : lowSol(preflight.balanceLamports) ? `Your wallet needs about ${formatSol(LAUNCH_MIN_LAMPORTS.total)} SOL for on-chain rent and fees before launching. Add SOL, then launch.` : "")
    : "";
  const error = launchError || startBlock;
  useEffect(() => { onProgress?.({ step: launchStep, status, busy, error }); }, [onProgress, launchStep, status, busy, error]);
  const complete = launchStep >= 2;
  const instruction = error ? "" : status || (busy ? "Opening your wallet…" : !publicKey ? "Connect your wallet to begin. You will approve twice." : (platform && launchStep === 2 ? "Your platform token is trading." : LAUNCH_STEPS[Math.min(launchStep, 2)].hint));
  return (
    <motion.div initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="sticky top-4 z-20 isolate overflow-hidden rounded-3xl border border-white/[0.12] bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_30px_80px_-40px_rgba(0,0,0,0.9)] backdrop-blur-xl">
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-48 w-3/4 -translate-x-1/2 rounded-full bg-[#d7ff00]/[0.09] blur-3xl" />
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#d7ff00]/25 bg-[#d7ff00]/10"><Rocket className="size-4 text-[#d7ff00]" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-tight tracking-tight text-white">Launch your coin</h3>
          <p className="text-xs text-zinc-500">Two quick wallet approvals</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-zinc-400"><span className={`size-1.5 rounded-full ${preflight?.ready ? "bg-emerald-400" : preflight ? "bg-amber-400" : "bg-zinc-600 animate-pulse"}`} />{getNetworkLabel()}</span>
      </div>

      {/* One row: the current step glows, everything else fades back. */}
      <ol className="mt-6 flex items-start" aria-label="Launch progress">
        {LAUNCH_STEPS.map((step, index) => {
          const done = index < launchStep || (complete && index === 2), current = index === launchStep && !done;
          return (
            <li key={step.title} aria-current={current ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
              {index > 0 && <span aria-hidden className="absolute right-1/2 top-[17px] h-px w-full bg-white/10"><motion.span className="absolute inset-y-0 left-0 bg-[#d7ff00]" initial={false} animate={{ width: index <= launchStep ? "100%" : "0%" }} transition={{ duration: reduced ? 0 : 0.6, ease: "easeOut" }} /></span>}
              <motion.span
                initial={false}
                animate={{ opacity: done || current ? 1 : 0.35, scale: current ? 1.08 : 1 }}
                transition={{ duration: reduced ? 0 : 0.5 }}
                className={`relative z-10 grid size-[34px] place-items-center rounded-full border text-[13px] font-bold tabular-nums transition-colors duration-500 ${done ? "border-[#d7ff00] bg-[#d7ff00] text-black" : current ? "border-[#d7ff00]/70 bg-[#0d0f10] text-[#d7ff00] shadow-[0_0_0_4px_rgba(215,255,0,0.1),0_0_28px_-2px_rgba(215,255,0,0.55)]" : "border-white/15 bg-[#0d0f10] text-zinc-400"}`}
              >
                {current && busy && !reduced && <span aria-hidden className="absolute inset-0 animate-ping rounded-full border border-[#d7ff00]/40" />}
                {done ? <Check className="size-4" strokeWidth={3} /> : index + 1}
              </motion.span>
              <motion.span initial={false} animate={{ opacity: done || current ? 1 : 0.35 }} transition={{ duration: reduced ? 0 : 0.5 }} className={`mt-2.5 px-1 text-[12px] font-medium leading-tight ${current ? "text-white" : done ? "text-zinc-300" : "text-zinc-500"}`}>{platform && index === 2 ? "Platform live" : step.title}</motion.span>
            </li>
          );
        })}
      </ol>

      {/* One plain-language instruction for whatever happens next. */}
      <div className="mt-5 min-h-[44px] rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-3" role="status" aria-live="polite">
        <p className="flex items-center gap-2.5 text-[13px] leading-5 text-zinc-200">
          {busy && <Loader2 className="size-3.5 shrink-0 animate-spin text-[#d7ff00]" />}
          <span>{instruction}</span>
        </p>
      </div>

      {preflight?.balanceLamports != null && <p className="mt-3 text-center text-[11px] text-zinc-500">Wallet balance {(preflight.balanceLamports / 1e9).toFixed(4)} SOL · launching needs about {formatSol(LAUNCH_MIN_LAMPORTS.total)} SOL for on-chain rent and fees, no token purchase</p>}
      {preflight?.error && <div className="mt-3"><Notice tone="warn">{preflight.error}</Notice></div>}
      {(!preflight?.ready || lowSol(preflight.balanceLamports)) && <div className="mt-3 flex items-center justify-center gap-3"><Button variant="outline" size="sm" disabled={busy} onClick={() => setCheck(v => v + 1)}>Check again</Button>{getNetworkLabel() === "Devnet" && <a href="https://faucet.solana.com" target="_blank" rel="noreferrer" className="text-xs text-[#d7ff00] underline">Get devnet SOL</a>}</div>}
      <Button
        disabled={busy || (!!publicKey && (!preflight?.ready || lowSol(preflight.balanceLamports)))}
        onClick={() => { unlockLaunchAudio(); if (publicKey) void launch(); else setVisible(true); }}
        className="mt-4 h-12 w-full rounded-xl bg-[#d7ff00] text-[15px] font-semibold text-zinc-950 shadow-[0_10px_28px_-10px_rgba(215,255,0,0.55)] hover:bg-[#e4ff59]"
      >
        {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
        {busy ? "Launching…" : !publicKey ? "Connect Solana wallet" : "Launch"}
      </Button>
      {error && <div className="mt-3"><Notice tone="error" title="Launch needs attention">{error} Keep this tab open; your launch progress is saved.</Notice></div>}
    </motion.div>
  );
}
