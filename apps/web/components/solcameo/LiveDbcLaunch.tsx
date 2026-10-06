"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { ensureSiwsViaRegistered } from "@/lib/client/siwsIdentity";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getNetworkLabel } from "@/lib/solana/network";
import { Button } from "@/components/ui/button";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2, CheckCircle2, Rocket } from "lucide-react";
import type { DbcOptions } from "@/lib/meteora/options";
import { Notice } from "./Notice";

const LAUNCH_STEPS = [
  { title: "Approve your curve", body: "Sign once so Meteora can lock in your launch settings." },
  { title: "Create token and pool", body: "Sign again to mint your coin and open its market." },
  { title: "Live on Solana", body: "Your character is trading and ready to make videos." },
];
type Pending = {
  mintSecret: number[];
  configSecret: number[];
  transaction: string;
  receipt: string;
  stage: "config" | "pool";
  signature?: string;
};
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function call(body: unknown) {
  const res = await fetch("/api/meteora/launch", {
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
  options,
  onComplete,
  autoStart = false,
}: {
  characterId: string;
  options: DbcOptions;
  onComplete: () => void;
  autoStart?: boolean;
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
    [error, setError] = useState("");
  const [launchStep, setLaunchStep] = useState(0);
  const launchLock = useRef(false);
  const autoStarted = useRef(false);
  const reduced = useReducedMotion();
  const launch = useCallback(async () => {
    if (launchLock.current) return;
    if (!publicKey || !signTransaction) {
      setError("Connect your Solana wallet to approve the launch.");
      return;
    }
    if (!preflight?.ready || preflight.balanceLamports === 0) {
      setError("Verify the devnet connection and fund your wallet with test SOL first.");
      return;
    }
    launchLock.current = true;
    setBusy(true);
    setError("");
    const key = `vello-dbc-${characterId}-${publicKey.toBase58()}`;
    const save = (v: Pending) => sessionStorage.setItem(key, JSON.stringify(v));
    try {
      if (!await ensureSiwsViaRegistered()) throw new Error("Verify your wallet before minting.");
      let pending: Pending | null = JSON.parse(
        sessionStorage.getItem(key) ?? "null",
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
        const prepared = await call({
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
          stage: "config",
        };
        save(pending);
      }
      for (let phase = 0; phase < 2; phase++) {
        if (!pending.signature) {
          setStatus("Checking saved launch progress…");
          const recovered = await call({
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
                  result = await call({action: "submit", receipt: pending.receipt, transaction: pending.transaction});
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
              const recovered = await call({action: "refresh", receipt: pending.receipt, transaction: pending.transaction});
              if (recovered.signature) pending.signature = recovered.signature;
              else {pending.transaction = recovered.transaction; pending.receipt = recovered.receipt;}
              save(pending);
            }
          }
        }
        setLaunchStep(pending.stage === "config" ? 0 : 1);
        setStatus("Waiting for Solana confirmation…");
        let result;
        for (let attempt = 0; attempt < 24; attempt++) {
          try {
            result = await call({
              action: "confirm",
              receipt: pending.receipt,
              signature: pending.signature,
            });
            break;
          } catch (e) {
            if (
              !(e instanceof Error) ||
              !e.message.includes("not confirmed") ||
              attempt === 23
            )
              throw e;
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
        if (result?.complete) {
          sessionStorage.removeItem(key);
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
  }, [publicKey, signTransaction, preflight, characterId, options, onComplete]);
  useEffect(() => {
    if (!autoStart || autoStarted.current || !publicKey || !signTransaction || !preflight?.ready || preflight.balanceLamports === 0) return;
    autoStarted.current = true;
    void launch();
  }, [autoStart, publicKey, signTransaction, preflight, launch]);
  return (
    <motion.div initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="sticky top-4 z-20 isolate space-y-5 overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/[0.09] via-[#202326]/90 to-[#17191c]/95 p-6 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 -z-10 size-64 rounded-full bg-[#d7ff00]/10 blur-3xl" />
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#d7ff00]/25 bg-[#d7ff00]/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"><Rocket className="size-5 text-[#d7ff00]" /></span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#d7ff00]/80">Launch</p>
          <h3 className="text-[19px] font-semibold leading-tight tracking-tight text-white">Your next chapter starts here</h3>
          <p className="mt-0.5 text-[12.5px] text-zinc-400">Two wallet approvals. Your character, live on Solana.</p>
        </div>
      </div>
      <ol className="relative space-y-1" aria-label="Launch progress">
        <span aria-hidden className="absolute bottom-6 left-[17px] top-6 w-px bg-gradient-to-b from-[#d7ff00]/40 via-white/10 to-white/5" />
        {LAUNCH_STEPS.map((step, index) => {
          const done = index < launchStep, current = index === launchStep;
          return (
            <motion.li key={step.title} initial={reduced ? false : { opacity: 0, y: 14, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.55, delay: reduced ? 0 : 0.25 + index * 0.4, ease: [0.22, 1, 0.36, 1] }}
              aria-current={current ? "step" : undefined}
              className={`relative flex items-start gap-3.5 rounded-xl border px-2.5 py-2.5 transition-colors duration-500 ${current ? "border-[#d7ff00]/25 bg-[#d7ff00]/[0.05]" : done ? "border-transparent" : "border-transparent opacity-70"}`}>
              <span className={`relative z-10 grid size-[26px] shrink-0 place-items-center rounded-full border text-[11px] font-bold tabular-nums transition-colors duration-500 ${done ? "border-[#d7ff00] bg-[#d7ff00] text-black" : current ? "border-[#d7ff00]/60 bg-[#14170a] text-[#d7ff00]" : "border-white/15 bg-[#17191c] text-zinc-500"}`}>
                {done ? <CheckCircle2 className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <span className="min-w-0 pt-0.5">
                <span className={`block text-[13.5px] font-semibold leading-tight ${current || done ? "text-white" : "text-zinc-300"}`}>{step.title}</span>
                <span className="mt-0.5 block text-[12px] leading-5 text-zinc-500">{step.body}</span>
              </span>
            </motion.li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-zinc-300">{getNetworkLabel()} launch</span>
        <span className="text-[#d7ff00]">{preflight?.ready ? "RPC verified" : preflight ? "Needs attention" : "Checking network…"}</span>
      </div>
      {preflight?.balanceLamports != null && <p className="text-xs text-zinc-400">Wallet balance: {(preflight.balanceLamports / 1e9).toFixed(4)} SOL</p>}
      {preflight?.error && <Notice tone="warn">{preflight.error}</Notice>}
      {(!preflight?.ready || preflight.balanceLamports === 0) && <div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={busy} onClick={() => setCheck(v => v + 1)}>Check again</Button>{getNetworkLabel() === "Devnet" && <a href="https://faucet.solana.com" target="_blank" rel="noreferrer" className="text-xs text-[#d7ff00] underline">Get devnet SOL</a>}</div>}
            <p className="text-sm leading-6 text-zinc-400">
        Two wallet approvals: your curve configuration, then your token and
        pool. SOL is used for account rent and network fees. No token purchase
        is included.
      </p>
      <Button
        disabled={busy || (!!publicKey && (!preflight?.ready || preflight.balanceLamports === 0))}
        onClick={() => publicKey ? void launch() : setVisible(true)}
        className="w-full bg-[#d7ff00] text-zinc-950 hover:bg-[#e4ff59]"
      >
        {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
        {busy ? "Launching…" : !publicKey ? "Connect Solana wallet" : `Launch on ${getNetworkLabel().toLowerCase()}`}
      </Button>
      {status && <Notice tone="info" role="status">{status}</Notice>}
      {error && <Notice tone="error" title="Launch needs attention">{error} Keep this tab open; your launch progress is saved.</Notice>}
    </motion.div>
  );
}
