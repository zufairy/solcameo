"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Check, Loader2, AlertCircle, Wallet, ArrowRight, RefreshCw } from "lucide-react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSiwsSession } from "@/hooks/use-siws-session";
import { classifyMintError, type MintErrorKind } from "@/lib/builder/mintErrors";
import type { AgentBlueprint } from "@/lib/builder/agentTypes";

/** Agent confirmation card — creating an agent is FREE (one agent on the free plan). This card is a glass confirm sheet: persona recap, a realtime
 *  agent-slots meter, and one "Create agent" action. No fees, no payments,
 *  no "mint" language in the UI (the /api/nft/mint path name is internal). */

interface NftMintCardProps {
  avatarUrls: string[];
  agentBlueprint: AgentBlueprint;
  sessionId: string;
  onMintComplete: (mintAddress: string) => void;
}

type CreateState = "idle" | "working" | "done" | "error" | "limit";

type StepId = "signin" | "create" | "finish";
const STEP_ORDER: StepId[] = ["signin", "create", "finish"];
const STEP_LABELS: Record<StepId, string> = {
  signin: "Signing you in",
  create: "Creating your agent",
  finish: "Finishing up",
};

/** Account agent quota, keyed by wallet so a wallet switch refetches. */
type Quota = { wallet: string; agentCount: number; agentLimit: number };

/** Display a niche/category as a single, capitalised word. */
function tidyCategory(raw?: string): string {
  if (!raw) return "";
  const first = raw.trim().split(/[\s,/–—-]+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "";
}

export default function NftMintCard({ avatarUrls, agentBlueprint, sessionId, onMintComplete }: NftMintCardProps) {
  const router = useRouter();
  const [activeIdx, setActiveIdx] = useState(0);
  const [gifLoaded, setGifLoaded] = useState(false);
  const [state, setState] = useState<CreateState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [currentStep, setCurrentStep] = useState<StepId | null>(null);
  const [stepFailed, setStepFailed] = useState(false);
  const [errorKind, setErrorKind] = useState<MintErrorKind>("server");
  const { publicKey } = useUnifiedSolanaWallet();
  const { ensureSiwsSession } = useSiwsSession();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Realtime agent quota: fetch on mount/wallet switch and poll every 15s while
  // idle, so the slots meter tracks agents created in other tabs too.
  useEffect(() => {
    if (!publicKey) return;
    const wallet = publicKey.toBase58();
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/nft/mint?sessionId=${encodeURIComponent(sessionId)}`);
        if (!res.ok) throw new Error(String(res.status));
        const q = await res.json() as { agentCount?: number; agentLimit?: number };
        if (!cancelled) {
          setQuota({ wallet, agentCount: Math.max(0, q.agentCount ?? 0), agentLimit: q.agentLimit ?? 1 });
        }
      } catch {
        if (!cancelled) setQuota({ wallet, agentCount: 1, agentLimit: 1 });
      }
    };
    void load();
    const poll = setInterval(() => { void load(); }, 15_000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [publicKey, sessionId]);

  // Quota for the CURRENTLY connected wallet only.
  const activeQuota = quota && publicKey && quota.wallet === publicKey.toBase58() ? quota : null;
  const limitReached = false;

  // Surface the right identity block — traders use agentBlueprint.trader, others use persona.
  const isTrader = agentBlueprint?.agentType === "trader";
  const persona = isTrader
    ? {
        name: agentBlueprint?.trader?.name,
        handle: undefined as string | undefined,
        niche: agentBlueprint?.trader?.strategy?.assetUniverse?.[0],
        voiceArchetype: agentBlueprint?.trader?.strategy?.autonomy,
        language: undefined as string | undefined,
        contentPillars: agentBlueprint?.trader?.strategy?.assetUniverse,
        catchphrase: agentBlueprint?.trader?.summary,
      }
    : (agentBlueprint?.persona ?? {});
  const validUrls = avatarUrls.filter(Boolean);

  // If first URL is a .gif, browser animates natively — no JS cycling needed
  const isGif = validUrls[0]?.toLowerCase().includes(".gif");
  const displayUrls = isGif ? [validUrls[0]] : validUrls;
  const posterUrl = isGif
    ? validUrls.find((u) => u.startsWith("data:")) ??
      validUrls.find((u, i) => i > 0 && !u.toLowerCase().includes(".gif"))
    : undefined;

  useEffect(() => {
    if (isGif || displayUrls.length < 2) return;
    intervalRef.current = setInterval(() => {
      setActiveIdx((i) => (i + 1) % displayUrls.length);
    }, 700);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [displayUrls.length, isGif]);

  async function handleCreate() {
    if (!publicKey || state === "working" || state === "done") return;
    const wallet = publicKey.toBase58();
    setErrorMsg("");
    setStepFailed(false);
    setCurrentStep(null);

    try {
      setState("working");

      // STEP 1 — wallet-proof sign-in (SIWS). No-op if a session already exists.
      setCurrentStep("signin");
      const session = await ensureSiwsSession();
      if (!session) {
        throw new Error("Connect your wallet to create your agent.");
      }

      // STEP 2 — create the agent. Free: a unique placeholder signature satisfies
      // the backend's replay protection; the server enforces the account-wide plan limit
      // atomically. Filter to ONLY http(s) URLs (no base64 data URIs).
      setCurrentStep("create");
      const signature = `free_promo_${sessionId.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const safeAvatarUrls = validUrls.filter((u) => /^https?:\/\//i.test(u));
      const res = await fetch("/api/nft/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          txSignature: signature,
          creatorWallet: wallet,
          agentBlueprint,
          avatarUrls: safeAvatarUrls,
        }),
      });

      const data = await res.json() as { ok?: boolean; mintAddress?: string; error?: string; limitReached?: boolean; agentCount?: number; agentLimit?: number };
      if (!res.ok || data.error) {
        if (data.limitReached) {
          setQuota({ wallet, agentCount: data.agentCount ?? 1, agentLimit: data.agentLimit ?? 1 });
          setCurrentStep(null);
          setState("limit");
          return;
        }
        throw new Error(data.error ?? "Couldn't create the agent");
      }

      // STEP 3 — settled.
      setCurrentStep("finish");
      setQuota((q) => (q && q.wallet === wallet ? { ...q, agentCount: q.agentCount + 1 } : q));
      setCurrentStep(null);
      setState("done");
      if (!data.mintAddress) throw new Error("Agent creation returned no agent address. Please retry.");
      onMintComplete(data.mintAddress);
      router.replace(`/builder?mint=${encodeURIComponent(data.mintAddress)}`);
    } catch (err) {
      const { kind, message } = classifyMintError(err);
      setErrorKind(kind);
      setErrorMsg(message);
      setStepFailed(true);
      setState("error");
    }
  }

  const pillars = persona.contentPillars?.slice(0, 3) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex w-full flex-col overflow-hidden rounded-2xl border border-white/15 bg-white/[0.06] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl sm:flex-row"
    >
      {/* Avatar display, native GIF animation OR frame cycling — landscape:
          fixed-width column on the left, stretched to match the info
          column's height (flex default align-items:stretch). */}
      <div className="relative aspect-square overflow-hidden bg-black/40 sm:aspect-auto sm:w-[280px] sm:shrink-0">
        {isGif ? (
          <>
            {posterUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={posterUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayUrls[0]}
              alt="Agent avatar"
              onLoad={() => setGifLoaded(true)}
              className={`relative h-full w-full object-cover transition-opacity duration-300 ${
                gifLoaded || !posterUrl ? "opacity-100" : "opacity-0"
              }`}
            />
          </>
        ) : (
          <AnimatePresence mode="wait">
            {displayUrls[activeIdx] && (
              <motion.img
                key={activeIdx}
                src={displayUrls[activeIdx]}
                alt={`Avatar ${activeIdx + 1}`}
                className="h-full w-full object-cover"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              />
            )}
          </AnimatePresence>
        )}

        {!isGif && displayUrls.length > 1 && (
          <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1">
            {displayUrls.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                aria-label={`Show avatar ${i + 1}`}
                className={`h-1.5 w-1.5 rounded-full transition-all ${i === activeIdx ? "scale-125 bg-white" : "bg-white/30"}`}
              />
            ))}
          </div>
        )}

        <div className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full border border-white/15 bg-black/40 px-2 py-0.5 backdrop-blur-sm">
          <Sparkles className="size-2.5 text-white/80" />
          <span className="text-[9px] font-medium text-white/70">Vello Agent</span>
        </div>
      </div>

      {/* Info — right column in landscape, full width below the image on mobile */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5">
        <div>
          <p className="text-[15px] font-bold leading-tight text-white">{persona.name ?? "AI Agent"}</p>
          <p className="text-[11px] font-medium text-white/45">{persona.handle ? `@${persona.handle.replace(/^@/, "")}` : ""}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[tidyCategory(persona.niche), tidyCategory(persona.voiceArchetype), tidyCategory(persona.language)]
            .filter(Boolean)
            .map((label) => (
              <span
                key={label}
                className="rounded-full border border-white/12 bg-white/[0.07] px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm"
              >
                {label}
              </span>
            ))}
        </div>

        {pillars.length > 0 && (
          <div className="text-[10px] leading-relaxed text-white/45">
            Posts about: {pillars.join(" · ")}
          </div>
        )}

        {persona.catchphrase && (
          <p className="border-l-2 border-white/20 pl-2 text-[10.5px] italic text-white/60">
            &ldquo;{persona.catchphrase}&rdquo;
          </p>
        )}

        {/* CTA / status */}
        {state === "done" ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
              <Check className="size-4 shrink-0 text-lime-400" />
              <span className="text-[11.5px] font-semibold text-white">Your agent is live!</span>
            </div>
            <Link
              href="/studio"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 py-2 text-[11.5px] font-semibold text-white/60 transition-colors hover:border-white/20 hover:text-white"
            >
              View my agents
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        ) : state === "limit" || limitReached ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2.5 rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2.5 backdrop-blur-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-300" />
              <div className="text-[10.5px] leading-relaxed">
                <p className="font-semibold text-white">All {activeQuota?.agentLimit ?? 1} agent slots used</p>
                <p className="mt-0.5 text-white/55">
                  Your account is at its limit. Delete an agent you no longer need to free a slot.
                </p>
              </div>
            </div>
            <Link
              href="/studio"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 py-2 text-[11px] font-semibold text-white/70 transition-colors hover:border-white/20 hover:text-white"
            >
              Manage my agents
              <ArrowRight className="size-3" />
            </Link>
          </div>
        ) : state === "working" || state === "error" ? (
          (() => {
            const curIdx = currentStep ? Math.max(STEP_ORDER.indexOf(currentStep), 0) : 0;
            const declined = errorKind === "declined";
            const barColor = state === "error" ? (declined ? "bg-amber-400" : "bg-red-400") : "bg-lime-400";
            const filled = curIdx + (state === "working" ? 0.5 : 0);
            const pct = Math.max(8, Math.round((filled / STEP_ORDER.length) * 100));
            return (
              <div className="flex flex-col gap-2.5">
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className={`h-full rounded-full ${barColor}`}
                    initial={false}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
                  />
                </div>

                <div className="flex flex-col gap-0.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 backdrop-blur-sm">
                  {STEP_ORDER.map((id) => {
                    const idx = STEP_ORDER.indexOf(id);
                    const status: "done" | "active" | "error" | "pending" =
                      idx < curIdx ? "done"
                      : idx === curIdx ? (stepFailed ? "error" : "active")
                      : "pending";
                    return (
                      <div key={id} className="flex items-center gap-2.5 py-1">
                        <span className="grid size-4 shrink-0 place-items-center">
                          {status === "done" ? (
                            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 24 }}>
                              <Check className="size-4 text-lime-400" />
                            </motion.span>
                          ) : status === "active" ? (
                            <Loader2 className="size-3.5 animate-spin text-white" />
                          ) : status === "error" ? (
                            <AlertCircle className={`size-3.5 ${declined ? "text-amber-400" : "text-red-400"}`} />
                          ) : (
                            <span className="size-1.5 rounded-full bg-white/25" />
                          )}
                        </span>
                        <span
                          className={`text-[11.5px] font-medium leading-tight ${
                            status === "done" ? "text-white/65"
                            : status === "active" ? "text-white"
                            : status === "error" ? (declined ? "text-amber-200" : "text-red-200")
                            : "text-white/35"
                          }`}
                        >
                          {STEP_LABELS[id]}
                          {status === "active" && id === "signin" && (
                            <span className="ml-1.5 text-[10px] font-normal text-white/40">· confirm in your wallet</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {state === "error" && (
                  <div className="flex flex-col gap-2">
                    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${declined ? "border-amber-500/25 bg-amber-500/[0.08]" : "border-red-500/20 bg-red-500/10"}`}>
                      <AlertCircle className={`mt-0.5 size-3.5 shrink-0 ${declined ? "text-amber-300" : "text-red-400"}`} />
                      <span className={`text-[10.5px] leading-relaxed ${declined ? "text-amber-200" : "text-red-300"}`}>{errorMsg}</span>
                    </div>
                    <button
                      onClick={handleCreate}
                      disabled={!publicKey}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 py-2 text-[11.5px] font-semibold text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
                    >
                      <RefreshCw className="size-3" />
                      Try again
                    </button>
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <button
            onClick={handleCreate}
            disabled={!publicKey}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[13px] font-extrabold uppercase tracking-wide transition-all duration-100 ${
              !publicKey
                ? "cursor-default bg-white/10 text-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                : "bg-white text-black shadow-[0_5px_0_0_rgba(255,255,255,0.25)] hover:bg-white/90 active:translate-y-[3px] active:shadow-[0_2px_0_0_rgba(255,255,255,0.25)]"
            }`}
          >
            {!publicKey ? (
              <><Wallet className="size-4" /> Connect wallet</>
            ) : (
              <><Sparkles className="size-4" /> Create agent · Free</>
            )}
          </button>
        )}

        <p className="text-center text-[9.5px] text-white/35">
          Free to create · unlimited influencers
        </p>
      </div>
    </motion.div>
  );
}
