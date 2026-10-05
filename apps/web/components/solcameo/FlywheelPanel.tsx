"use client";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { ensureSiwsViaRegistered } from "@/lib/client/siwsIdentity";
import { Button } from "@/components/ui/button";
import { motion, useReducedMotion } from "framer-motion";
import { RefreshCw, Video, ArrowUpRight, Loader2 } from "lucide-react";
const sol = (n: string) =>
  (Number(n) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 });
type Chain = {
  creatorClaimable: string;
  readyToGraduate: boolean;
  migrated: boolean;
};
async function call(body: unknown) {
  const res = await fetch("/api/meteora/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error);
  return d;
}
export function FlywheelPanel({
  characterId,
}: {
  characterId: Id<"ssCharacters">;
}) {
  const wheel = useQuery(api.solstarFlywheel.status, { characterId });
  const [chain, setChain] = useState<Chain | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [tick, setTick] = useState(0);
  const { publicKey, signTransaction } = useUnifiedSolanaWallet();
  const reduced = useReducedMotion(),
    owner = wheel?.ownerWallet === publicKey?.toBase58();
  useEffect(() => {
    const ctrl = new AbortController();
    async function load() {
      try {
        const r = await fetch(
          `/api/meteora/lifecycle?characterId=${characterId}`,
          { signal: ctrl.signal },
        );
        const d = await r.json();
        if (!ctrl.signal.aborted) setChain(r.ok && d.available ? d : null);
      } catch {
        if (!ctrl.signal.aborted) setChain(null);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [characterId, tick]);
  const [saved, setSaved] = useState({claim: false, graduate: false});
  useEffect(() => {
    const prefix = `dbc-operation-${characterId}-${publicKey?.toBase58()}-`;
    const timer = setTimeout(() => setSaved({claim: !!localStorage.getItem(prefix + "claim"), graduate: !!localStorage.getItem(prefix + "graduate")}), 0);
    return () => clearTimeout(timer);
  }, [characterId, publicKey, busy]);
  async function operation(kind: "claim" | "graduate") {
    if (!publicKey || !signTransaction) return;
    setBusy(true);
    setMessage("");
    const storage = `dbc-operation-${characterId}-${publicKey.toBase58()}-${kind}`;
    try {
      if (!(await ensureSiwsViaRegistered()))
        throw new Error("Verify your wallet first");
      let pending = JSON.parse(localStorage.getItem(storage) ?? "null");
      if (!pending) {
        setMessage(
          kind === "claim"
            ? "Preparing your fee claim…"
            : "Preparing permanent liquidity…",
        );
        const d = await call({ action: "prepare", characterId, kind });
        const tx = VersionedTransaction.deserialize(
          Uint8Array.from(atob(d.transaction), (c) => c.charCodeAt(0)),
        );
        const signed = await signTransaction(tx);
        pending = {
          receipt: d.receipt,
          transaction: btoa(String.fromCharCode(...signed.serialize())),
          signature: bs58.encode(signed.signatures[0]),
        };
        localStorage.setItem(storage, JSON.stringify(pending));
      }
      try {
        await call({ action: "submit", ...pending });
      } catch {
        /* Always check the saved signature before requesting a new wallet operation. */
      }
      setMessage("Confirming on Solana. You can safely resume this operation.");
      let done = false;
      for (let i = 0; i < 20; i++) {
        try {
          const d = await call({ action: "confirm", ...pending });
          if (d.expired || d.failed) {
            localStorage.removeItem(storage);
            throw new Error(
              d.failed
                ? "Transaction failed. You may request a fresh operation."
                : "Transaction expired without landing. You may retry.",
            );
          }
          if (d.confirmed) {
            done = true;
            break;
          }
        } catch (e) {
          if (
            !(e instanceof Error) ||
            !e.message.includes("not confirmed") ||
            i === 19
          )
            throw e;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (done) {
        localStorage.removeItem(storage);
        setTick((n) => n + 1);
        setMessage(
          kind === "claim"
            ? "Your fee claim is confirmed."
            : "Your character has graduated to permanent liquidity.",
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Operation unavailable");
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    if (!wheel) return;
    setBusy(true);
    try {
      if (!(await ensureSiwsViaRegistered()))
        throw new Error("Verify your wallet first");
      await call({ action: "toggle", characterId, enabled: !wheel.enabled });
      setMessage(
        wheel.enabled
          ? "Future generation paused. Accepted jobs still finish."
          : "Budget-backed creation enabled.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not update setting");
    } finally {
      setBusy(false);
    }
  }
  if (!wheel) return null;
  const labels: Record<string, string> = {
    awaiting_fees: "Waiting for earned fees",
    devnet_test_budget: "Devnet budget · test SOL only",
    fees_collected: "Fees collected",
    creating_content: "Creating the next chapter",
    paused: "Creation paused",
    awaiting_budget_or_plot: "Waiting for budget or a new plot",
    generation_not_configured: "Generation service needs configuration",
    needs_attention: "Needs attention",
    needs_reconciliation: "Provider task needs reconciliation",
    collecting_fees: "Collecting earned fees",
    creator_only: "Original creator-only economics",
    graduated: "Graduated to DAMM v2",
  };
  return (
    <section className="space-y-4 border-b border-white/10 p-4">
      <div className="flex items-center gap-2">
        <RefreshCw className="size-4 text-[#d7ff00]" />
        <h3 className="text-sm font-medium">Character flywheel</h3>
      </div>
      <p className="text-xs leading-5 text-zinc-400">
        {labels[wheel.status] ?? "Checking the flywheel"}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-zinc-500">
            Content budget {wheel.network === "devnet" ? "(test)" : ""}
          </p>
          <motion.p
            key={wheel.available}
            initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-1 text-sm tabular-nums"
          >
            {sol(wheel.available)} SOL
          </motion.p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500">Unclaimed creator fees</p>
          <p className="mt-1 text-sm tabular-nums">
            {chain ? `${sol(chain.creatorClaimable)} SOL` : "RPC unavailable"}
          </p>
        </div>
      </div>
      {wheel.economy === "sustainable-v1" && (
        <p className="text-[10px] leading-5 text-zinc-500">
          Fee allocation: creator 40% · content 20% · platform 20% · Meteora
          20%. Content budget is managed by Solcameo’s treasury. Devnet funds
          cannot buy AI credits.
        </p>
      )}
      {owner && (
        <div className="space-y-2">
          <Button
            disabled={busy || (!saved.claim && (!chain || BigInt(chain.creatorClaimable) === 0n))}
            onClick={() => void operation("claim")}
            className="w-full"
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowUpRight className="size-3" />
            )}
            Claim creator fees / resume
          </Button>
          {(chain?.readyToGraduate || saved.graduate) && (
            <Button
              disabled={busy}
              onClick={() => void operation("graduate")}
              className="w-full"
            >
              {saved.graduate ? "Resume graduation" : "Graduate to permanent liquidity"}
            </Button>
          )}
          {wheel.economy === "sustainable-v1" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void toggle()}
              className="w-full border-white/10"
            >
              <Video className="size-3" />
              {wheel.enabled
                ? "Pause automatic creation"
                : "Enable automatic creation"}
            </Button>
          )}
        </div>
      )}
      {chain?.migrated && (
        <p className="text-xs text-[#d7ff00]">
          Permanent pool is live. LP fees follow the migrated position
          allocation.
        </p>
      )}
      {wheel.jobs.map((j) => (
        <div
          key={j.id}
          className="flex items-center justify-between gap-2 text-[10px] text-zinc-500"
        >
          <span>
            {j.status === "complete"
              ? "New chapter ready"
              : j.status === "running"
                ? "Rendering next chapter"
                : j.status.replaceAll("_", " ")}
          </span>
          <time>{new Date(j.createdAt).toLocaleDateString()}</time>
        </div>
      ))}
      {(message || (owner && wheel.error)) && (
        <p role="status" className="text-xs leading-5 text-zinc-300">
          {message || wheel.error}
        </p>
      )}
    </section>
  );
}
