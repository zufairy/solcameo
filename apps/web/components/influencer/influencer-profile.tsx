"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import { getRpcUrl, getUsdcMint } from "@/lib/solana/network";
import { getViewsForUrls } from "@/lib/content-rewards";
import {
  AreaChart, Area, XAxis, YAxis,
  ResponsiveContainer, Tooltip, CartesianGrid,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, TrendingUp, Globe, Star,
  CheckCircle2, Clock, XCircle, ExternalLink, Loader2,
  Wallet, Sparkles, Zap, AlertTriangle,
  Activity, RefreshCw, ChevronRight,
  ArrowUpRight, Lock, Coins, ScanSearch, Bot, Play,
  BookOpen, MessageSquare, Send, CreditCard, CheckCircle, Images, Eye,
  Film, Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import type { AIInfluencer } from "@/lib/types";
import { investEnabled } from "@/lib/flags";
import { socialProfileUrl } from "@/lib/socialProfileUrl";
import { PersonaModal } from "@/components/influencer/persona-modal";
import { PlatformBadge } from "@/components/social/platform-icons";

// ─── Constants ────────────────────────────────────────────────────────────────

const USDC_MINT = new PublicKey(getUsdcMint());
const RPC_URL = getRpcUrl();

const NICHE_APR: Record<string, number> = {
  finance: 18, tech: 14, gaming: 13, fitness: 11,
  lifestyle: 10, travel: 10, fashion: 9, food: 8,
};

const GROWTH = [0.28, 0.43, 0.57, 0.70, 0.85, 1.0];
const JITTER = [0.92, 1.07, 0.95, 1.06, 0.97, 1.02];

// ─── Social platform helpers ──────────────────────────────────────────────────
// Maps upload-post platform ids → human label + the profile URL shape for the
// agent's handle. Drives the sidebar "connected accounts" buttons (open each
// connected social account's profile) and the Creations hover overlay (open a
// posted clip on its actual platform).

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  threads: "Threads",
  bluesky: "Bluesky",
  reddit: "Reddit",
  pinterest: "Pinterest",
  telegram: "Telegram",
  discord: "Discord",
  google_business: "Google Business",
};

function platformLabel(id: string): string {
  return PLATFORM_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(n: number, dec = 0) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(dec)}`;
}

// ─── On-chain vault balance hook ──────────────────────────────────────────────

function useMintBalance(mintAddress: string) {
  const [sol, setSol] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // `silent` skips the spinner on background polls so the live refresh
  // doesn't flicker the balance every interval.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Server-side balance API — already network-aware (mainnet vs devnet)
      // and resolves the right USDC mint for each cluster. This avoids the
      // hardcoded devnet path that was returning $0 on mainnet wallets.
      const res = await fetch(`/api/agent-wallet-balance?wallet=${encodeURIComponent(mintAddress)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { ok: boolean; sol?: number; usdc?: number };
      if (data.ok) {
        setSol(data.sol ?? 0);
        setUsdc(data.usdc ?? 0);
      } else {
        setSol(0); setUsdc(0);
      }
    } catch {
      setSol(0);
      setUsdc(0);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [mintAddress]);

  // Initial load + live polling every 15s (on-chain balance has no
  // subscription, so we keep it current alongside the realtime Convex data).
  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
    const id = setInterval(() => void load(true), 15_000);
    return () => clearInterval(id);
  }, [load]);

  return { sol, usdc, loading, refresh: () => load() };
}

// ─── Task helpers ─────────────────────────────────────────────────────────────

function taskTimeAgo(ts: number) {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  return `${hours}h ago`;
}

const TASK_TYPE_ICONS: Record<string, React.ReactNode> = {
  // Influencer / worker
  create_video:     <span className="text-[12px]">🎬</span>,
  post_content:     <span className="text-[12px]">📝</span>,
  analyze_trend:    <span className="text-[12px]">📊</span>,
  engage_comment:   <span className="text-[12px]">💬</span>,
  research:         <span className="text-[12px]">🔍</span>,
  campaign_submit:  <span className="text-[12px]">📤</span>,
  // Trader
  trader_tick:      <span className="text-[12px]">⚡</span>,
  binary_scan:      <span className="text-[12px]">🎯</span>,
  settle_bets:      <span className="text-[12px]">💰</span>,
  trader_buy:       <span className="text-[12px]">📈</span>,
  trader_sell:      <span className="text-[12px]">📉</span>,
  check_wallet:     <span className="text-[12px]">💳</span>,
  find_jobs:        <span className="text-[12px]">🧭</span>,
  self_reflect:     <span className="text-[12px]">🪞</span>,
  custom:           <span className="text-[12px]">⚙️</span>,
};

function TaskStatusBadge({ status }: { status: string }) {
  if (status === "running") return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-400 rounded-[0.65rem] px-2 py-0.5 bg-blue-500/10 border border-blue-500/20">
      <span className="size-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />Running
    </span>
  );
  if (status === "pending") return <span className="text-[12px] font-medium text-zinc-500 rounded-[0.65rem] px-2 py-0.5 bg-white/[0.04] border border-white/[0.07]">Pending</span>;
  if (status === "awaiting_approval") return <span className="text-[12px] font-medium text-zinc-400 rounded-[0.65rem] px-2 py-0.5 bg-white/[0.04] border border-white/[0.07]">Awaiting</span>;
  if (status === "succeeded") return <span className="text-[12px] text-zinc-600 font-medium">Done</span>;
  if (status === "failed") return <span className="text-[12px] text-red-400 font-semibold">Failed</span>;
  return <span className="text-[12px] text-zinc-700">Cancelled</span>;
}

function TaskRow({ task }: { task: { _id: string; title: string; type: string; status: string; startedAt?: number; triggeredBy?: string; output?: string } }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-[1.25rem] border border-white/[0.06] hover:border-white/[0.1] hover:bg-white/[0.015] transition-all duration-150">
      <div className={`mt-1 size-1.5 rounded-full shrink-0 ${
        task.status === "running" ? "bg-blue-400 animate-pulse shadow-[0_0_5px_rgba(10,132,255,0.7)]" : "bg-zinc-700"
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[15px] font-semibold text-white leading-tight">{task.title}</p>
          <span className="inline-flex items-center gap-1 text-[12px] font-mono text-zinc-600 bg-white/[0.03] border border-white/[0.06] rounded-[0.65rem] px-1.5 py-0.5">
            {TASK_TYPE_ICONS[task.type] ?? <Activity className="size-3" />}
            {task.type.replace(/_/g, " ")}
          </span>
        </div>
        {task.output && (
          <p className="text-[13px] text-zinc-500 mt-1 line-clamp-2">{(() => { try { const p = JSON.parse(task.output); return p.summary ?? p.message ?? task.output; } catch { return task.output; } })()}</p>
        )}
        <p className="text-[12px] text-zinc-700 mt-1">
          {task.triggeredBy && <span>via {task.triggeredBy} · </span>}
          {task.startedAt ? taskTimeAgo(task.startedAt) : "queued"}
        </p>
      </div>
      <TaskStatusBadge status={task.status} />
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────────

function ChartTip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0f0f12] border border-[#2a2a30] rounded-[1.25rem] px-3 py-2 shadow-2xl text-[14px]">
      <p className="text-zinc-500 mb-0.5">{label}</p>
      <p className="font-mono font-bold text-blue-400">{fmtUsd(payload[0].value)}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved" || status === "verified") return <span className="inline-flex items-center gap-1 text-[13px] text-blue-400 font-medium"><CheckCircle2 className="size-3" /> {status === "verified" ? "Verified" : "Approved"}</span>;
  if (status === "rejected") return <span className="inline-flex items-center gap-1 text-[13px] text-red-400 font-medium"><XCircle className="size-3" /> Rejected</span>;
  return <span className="inline-flex items-center gap-1 text-[13px] text-amber-400 font-medium"><Clock className="size-3" /> Pending</span>;
}

/** Actual USDC a submission has earned: paid on-chain if disbursed, else the owed
 *  payout once approved/verified, else 0. Mirrors submissions.earningsByAgent. */
function earnedFromSubmission(s: SubmissionRow): number {
  if (typeof s.paidUsdc === "number" && s.paidUsdc > 0) return s.paidUsdc;
  if (s.status === "approved" || s.status === "verified") return s.payoutAmountUsdc ?? 0;
  return 0;
}

// Clipping vs UGC discriminator, off the joined campaign (see submissions/campaign schema).
const isClipSubmission = (s: SubmissionRow): boolean =>
  !!s.campaign && (s.campaign.category === "clipping" || s.campaign.origin === "clipping_fr" || !!s.campaign.contentRewardId);
const isUgcSubmission = (s: SubmissionRow): boolean => s.campaign?.category === "ugc";

/** Earnings + submissions table for one campaign type (Clipping / UGC). Rendered
 *  on the Earnings tab ONLY when the agent joined at least one campaign of that
 *  type — so it shows up exactly when there's something to show. */
function CampaignEarningsTable({ title, icon, rows, accent }: {
  title: string;
  icon: React.ReactNode;
  rows: SubmissionRow[];
  accent: string;
}) {
  if (rows.length === 0) return null;
  const total = rows.reduce((n, s) => n + earnedFromSubmission(s), 0);
  return (
    <section className="px-6 py-8">
      <div className="flex items-center gap-2 mb-5">
        {icon}
        <h2 className="text-[22px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)]">{title}</h2>
        <span className="text-[13px] text-zinc-600">{rows.length}</span>
        <span className="ml-auto font-mono text-[15px] font-bold tabular-nums" style={{ color: accent }}>${total.toFixed(2)}</span>
      </div>
      <div className="rounded-[1.25rem] border border-white/[0.06] overflow-hidden">
        <table className="w-full text-[14.5px]">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              {["Campaign", "Views", "Status", "Post", "Earned"].map((h, i) => (
                <th key={h} className={`py-3 px-5 font-medium text-zinc-600 text-[13px] ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((sub) => {
              const earned = earnedFromSubmission(sub);
              return (
                <tr key={sub._id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015] transition-colors duration-100">
                  <td className="py-3.5 px-5">
                    {sub.campaign ? (
                      <div className="flex items-center gap-3">
                        {sub.campaign.brandLogoUrl && <img src={sub.campaign.brandLogoUrl} alt="" className="size-6 rounded-[0.65rem] border border-white/[0.08] object-cover shrink-0" />}
                        <div>
                          <p className="font-medium text-white text-[14.5px]">{sub.campaign.title}</p>
                          <p className="text-[12.5px] text-zinc-600">{sub.campaign.brandName}</p>
                        </div>
                      </div>
                    ) : <span className="text-zinc-700">Campaign</span>}
                  </td>
                  <td className="py-3.5 px-5 text-right font-mono text-zinc-300 tabular-nums">{typeof sub.viewCount === "number" ? sub.viewCount.toLocaleString() : "—"}</td>
                  <td className="py-3.5 px-5 text-right"><StatusBadge status={sub.status} /></td>
                  <td className="py-3.5 px-5 text-right">
                    {sub.postUrl ? (
                      <a href={sub.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-[13px] transition-colors">View <ExternalLink className="size-2.5" /></a>
                    ) : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="py-3.5 px-5 text-right font-mono font-semibold tabular-nums" style={{ color: earned > 0 ? accent : "#52525b" }}>{earned > 0 ? `$${earned.toFixed(2)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatCell({ label, value, sub, accent, icon }: {
  label: string; value: string; sub?: string;
  accent?: string; icon?: React.ReactNode;
}) {
  return (
    <div className="bg-[#09090b] px-4 py-3.5">
      <p className="text-[11.5px] text-zinc-600 uppercase tracking-[0.08em] mb-2 flex items-center gap-1.5">{icon}{label}</p>
      <p className={`text-[19px] font-mono font-black tabular-nums tracking-tight ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-[11.5px] text-zinc-700 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Invest panel ─────────────────────────────────────────────────────────────

function InvestPanel({
  influencer, apr, perShareMonthly, isProjected, onInvested,
}: {
  influencer: AIInfluencer;
  apr: number;
  perShareMonthly: number;
  isProjected: boolean;
  onInvested?: () => void;
}) {
  const [shares, setShares] = useState(1);
  const [investing, setInvesting] = useState(false);
  const [investStep, setInvestStep] = useState<"idle" | "building" | "signing" | "confirming" | "recording">("idle");
  const [result, setResult] = useState<{ sharesBought: number; newTvl: number; newSharePrice: number; txSignature: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Privy-aware wallet: resolves the active address + signer whether the user
  // logged in with an external wallet (Phantom/Solflare) OR a Google login that
  // minted an embedded Privy wallet. `useWallet()` alone misses the embedded
  // case and would keep the button stuck on "Connect Wallet" while the header
  // shows the user as connected.
  const { connected, publicKey, signTransaction } = useUnifiedSolanaWallet();
  const { profile, refreshProfile, promptLogin, getFreshToken } = useSupabaseAuth();
  const linkWalletAction = useAction(api.users.linkWallet);

  // Best-effort: link the connected wallet to the signed-in account so the buy can
  // send the auth token (which lets the server attribute the purchase to the
  // account). This is PURELY an optimization — the buy is authorized by the signed
  // on-chain USDC transfer, so it must NEVER block the purchase. A wallet-only
  // login already has its wallet auto-linked by `whoami`, so this usually no-ops.
  //
  // Returns how the link resolved so the caller decides whether to send the token:
  //   linked  → wallet is on the account; safe to send the token
  //   foreign → wallet belongs to a DIFFERENT account; surface that to the user
  // Uses a FRESH token (the cached one can be expired → "Invalid or expired
  // session", which is what was throwing the generic "Couldn't link" error).
  async function ensureWalletLinked(): Promise<{ linked: boolean; foreign: boolean }> {
    if (!publicKey) return { linked: false, foreign: false };
    const pk = publicKey.toBase58();
    if (profile?.walletAddresses?.includes(pk)) return { linked: true, foreign: false };
    const token = await getFreshToken();
    if (!token) return { linked: false, foreign: false }; // wallet-only, no session token
    try {
      await linkWalletAction({ accessToken: token, walletAddress: pk, walletType: "external" });
      await refreshProfile();
      return { linked: true, foreign: false };
    } catch (e) {
      const foreign = /already linked to another account/i.test(e instanceof Error ? e.message : "");
      return { linked: false, foreign };
    }
  }

  const cost = shares * influencer.sharePrice;
  const monthlyYield = shares * perShareMonthly;
  const annualYield = monthlyYield * 12;
  const breakEven = perShareMonthly > 0 ? Math.ceil(influencer.sharePrice / perShareMonthly) : null;

  // Resolve treasury: agent's dedicated wallet → real mint → creator wallet
  const treasuryAddress = (() => {
    if (influencer.agentWallet) {
      try { new PublicKey(influencer.agentWallet); return influencer.agentWallet; } catch { /* invalid */ }
    }
    try { new PublicKey(influencer.id); return influencer.id; } catch { /* not a real pubkey */ }
    if (influencer.creatorWallet) {
      try { new PublicKey(influencer.creatorWallet); return influencer.creatorWallet; } catch { /* invalid */ }
    }
    return null;
  })();

  async function handleBuy() {
    if (!connected || !publicKey) { promptLogin(); return; }
    if (!treasuryAddress) {
      setError("This agent doesn't have an on-chain wallet configured yet.");
      return;
    }
    setInvesting(true); setError(null);
    try {
      // Best-effort link so a signed-in account can claim the purchase. NEVER blocks
      // the buy — the on-chain transfer below is what authorizes it. We only abort
      // if the wallet provably belongs to a DIFFERENT account (the server would 403).
      const link = await ensureWalletLinked();
      if (link.foreign) {
        throw new Error("This wallet is already linked to a different account. Sign in with that account, or connect the wallet you linked here.");
      }
      // Send the auth token ONLY when the wallet is on this account. Otherwise omit
      // it so the server uses the wallet-only path (authorized by the signed USDC
      // transfer) instead of 403-ing on "connected wallet is not linked".
      const authToken = link.linked ? await getFreshToken() : null;

      const connection = new Connection(RPC_URL, "confirmed");
      const treasuryPk = new PublicKey(treasuryAddress);

      setInvestStep("building");

      // Derive ATAs
      const [investorAta, treasuryAta] = await Promise.all([
        getAssociatedTokenAddress(USDC_MINT, publicKey),
        getAssociatedTokenAddress(USDC_MINT, treasuryPk, true),
      ]);

      // Pre-check the INVESTOR actually holds enough USDC of THIS mint. Without
      // this, a missing/empty token account makes the transfer reference a
      // non-existent source → the wallet aborts at simulation with an opaque
      // "Unexpected error". Surface the real reason instead.
      let investorUsdc = 0;
      try {
        const acc = await getAccount(connection, investorAta, "confirmed");
        investorUsdc = Number(acc.amount) / 1_000_000;
      } catch (e) {
        if (e instanceof TokenAccountNotFoundError) {
          throw new Error("Your wallet holds no devnet USDC (mint 4zMMC9…JDncDU). Get free test USDC at faucet.circle.com (select Solana Devnet) to your connected wallet, then retry.");
        }
        throw e;
      }
      if (investorUsdc < cost) {
        throw new Error(`Not enough USDC: you have $${investorUsdc.toFixed(2)} but need $${cost.toFixed(2)}. Top up at faucet.circle.com (Solana Devnet) and retry.`);
      }

      // Check if treasury ATA exists
      const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta);

      const tx = new Transaction();

      // Create treasury ATA if needed (investor pays the rent)
      if (!treasuryAtaInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            publicKey,
            treasuryAta,
            treasuryPk,
            USDC_MINT,
          )
        );
      }

      // Transfer USDC (6 decimals)
      const atomicAmount = BigInt(Math.round(cost * 1_000_000));
      tx.add(
        createTransferInstruction(
          investorAta,
          treasuryAta,
          publicKey,
          atomicAmount,
        )
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      // Pre-simulate on devnet BEFORE the wallet — surfaces the real on-chain
      // reason (no SOL for fees/rent, bad account) instead of the wallet's opaque
      // "Unexpected error". If this passes but the wallet still errors, the wallet
      // is on the wrong network (it must be on Solana Devnet).
      try {
        const sim = await connection.simulateTransaction(tx);
        if (sim.value.err) {
          const logs = sim.value.logs ?? [];
          const tail = logs.length ? ` — ${logs.slice(-3).join(" | ").slice(0, 200)}` : "";
          throw new Error(`This investment would fail on devnet: ${JSON.stringify(sim.value.err)}${tail}. You likely need a little devnet SOL for fees (airdrop at faucet.solana.com), then retry.`);
        }
      } catch (e) {
        if (e instanceof Error && /would fail on devnet/.test(e.message)) throw e;
      }

      setInvestStep("signing");
      // SIGN-ONLY, then broadcast the bytes ourselves to OUR devnet RPC. This
      // bypasses the adapter's sendTransaction (StandardWalletAdapter.sendTransaction),
      // whose internal cluster auto-detection can mis-route a devnet tx and throw
      // an opaque "Unexpected error". We control the send + cluster this way.
      // skipPreflight: the tx already passed our pre-simulation above.
      if (!signTransaction) throw new Error("Your wallet can't sign transactions. Reconnect and retry.");
      const signed = await signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 });

      setInvestStep("confirming");
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

      setInvestStep("recording");
      const resp = await fetch("/api/market/buy-shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          mintAddress: influencer.id,
          investorWallet: publicKey.toBase58(),
          depositUsdc: cost,
          txSignature: signature,
        }),
      });
      const res = await resp.json();
      if (!resp.ok) throw new Error(res.error ?? "buy failed");

      setResult({ ...res, txSignature: signature });
      // Poll vault balance a few times to catch devnet propagation delay
      if (onInvested) {
        setTimeout(onInvested, 1500);
        setTimeout(onInvested, 4000);
        setTimeout(onInvested, 8000);
      }
    } catch (e: unknown) {
      // Surface user-friendly messages for common wallet errors
      const msg = e instanceof Error ? e.message : "Investment failed";
      if (msg.includes("0x1")) setError("Insufficient USDC balance in your wallet.");
      else if (/user rejected/i.test(msg)) setError("Transaction rejected in wallet.");
      else if (/unexpected error/i.test(msg)) setError("Phantom refused to sign, but your USDC and the transaction are valid on devnet (they passed pre-checks). This is a known Phantom devnet quirk. Either set Phantom to Solana Devnet (Settings → Developer Settings → Testnet Mode ON → 'Solana Devnet') and retry, or connect Solflare instead — it signs devnet transfers reliably.");
      else setError(msg);
    } finally {
      setInvesting(false);
      setInvestStep("idle");
    }
  }

  const stepLabel = investStep === "building" ? "Building transaction…"
    : investStep === "signing" ? "Approve in Phantom…"
    : investStep === "confirming" ? "Confirming on-chain…"
    : investStep === "recording" ? "Recording investment…"
    : null;

  if (result) return (
    <div className="space-y-4">
      <div className="rounded-[1.75rem] bg-blue-500/8 border border-blue-500/20 p-5 text-center space-y-2">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
          <CheckCircle2 className="size-8 text-blue-400 mx-auto" />
        </motion.div>
        <p className="text-[15px] font-semibold text-blue-300">Investment confirmed on-chain</p>
        <p className="text-[34px] font-mono font-black text-white">{result.sharesBought}</p>
        <p className="text-[13px] text-zinc-500">shares · ${(result.sharesBought * influencer.sharePrice).toFixed(2)} USDC</p>
        <Separator className="bg-blue-500/15 my-2" />
        <div className="grid grid-cols-2 gap-3 text-left">
          <div><p className="text-[12px] text-zinc-600">Monthly yield</p><p className="text-[14px] font-mono font-bold text-blue-400">+${(result.sharesBought * perShareMonthly).toFixed(4)}</p></div>
          <div><p className="text-[12px] text-zinc-600">New price</p><p className="text-[14px] font-mono font-bold">${result.newSharePrice.toFixed(2)}</p></div>
        </div>
        <a
          href={`https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12.5px] text-zinc-500 hover:text-zinc-300 font-mono mt-1 transition-colors"
        >
          {result.txSignature.slice(0, 8)}…{result.txSignature.slice(-6)}
          <ExternalLink className="size-3" />
        </a>
      </div>
      <button onClick={() => setResult(null)} className="w-full h-9 rounded-[1.25rem] border border-[#27272a] text-[15px] text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors">
        Invest more
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* APR headline */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] text-zinc-600 uppercase tracking-widest mb-0.5">Est. APR {isProjected && <span className="text-zinc-700">· projected</span>}</p>
          <p className="text-[30px] font-mono font-black text-blue-400 tabular-nums leading-none">{apr.toFixed(1)}%</p>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-zinc-600 uppercase tracking-widest mb-0.5">Per share / mo</p>
          <p className="text-[22px] font-mono font-black text-white tabular-nums leading-none">${perShareMonthly.toFixed(4)}</p>
        </div>
      </div>

      <Separator className="bg-[#1e1e24]" />

      {/* Share selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[14px] text-zinc-500">Shares to buy</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setShares(s => Math.max(1, s - 1))} className="h-6 w-6 rounded-[0.9rem] bg-[#1a1a1e] hover:bg-[#252528] text-zinc-300 text-[16px] flex items-center justify-center transition-colors">−</button>
            <span className="text-[17px] font-mono font-bold text-white w-10 text-center tabular-nums">{shares}</span>
            <button onClick={() => setShares(s => Math.min(influencer.availableShares, s + 1))} className="h-6 w-6 rounded-[0.9rem] bg-[#1a1a1e] hover:bg-[#252528] text-zinc-300 text-[16px] flex items-center justify-center transition-colors">+</button>
          </div>
        </div>
        <input
          type="range" min={1} max={Math.min(influencer.availableShares, 100)} value={shares}
          onChange={e => setShares(Number(e.target.value))}
          className="w-full h-1 bg-[#1e1e24] rounded-full appearance-none cursor-pointer accent-blue-500"
        />
        <div className="flex gap-1.5 flex-wrap">
          {[1, 5, 10, 25, 50].map(n => (
            <button key={n} onClick={() => setShares(Math.min(n, influencer.availableShares))}
              className={`px-2.5 py-1 rounded-[0.9rem] text-[13px] font-mono font-semibold border transition-all ${shares === n ? "border-blue-500/50 bg-blue-500/10 text-blue-300" : "border-[#27272a] text-zinc-500 hover:text-zinc-300"}`}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Cost breakdown */}
      <div className="rounded-[1.75rem] bg-[#0a0a0d] border border-[#1e1e24] p-4 space-y-2.5">
        {[
          { label: `${shares} share${shares !== 1 ? "s" : ""} × $${influencer.sharePrice.toFixed(2)}`, value: `$${cost.toFixed(2)} USDC`, highlight: false },
          { label: "Monthly yield", value: `+$${monthlyYield.toFixed(4)}`, highlight: true },
          { label: "Annual yield", value: `+$${annualYield.toFixed(2)}`, highlight: true },
          ...(breakEven ? [{ label: "Break-even", value: `${breakEven} months`, highlight: false }] : []),
        ].map(({ label, value, highlight }) => (
          <div key={label} className="flex justify-between text-[14px]">
            <span className="text-zinc-500">{label}</span>
            <span className={`font-mono font-semibold ${highlight ? "text-blue-400" : "text-white"}`}>{value}</span>
          </div>
        ))}
      </div>

      {error && <p className="text-[13px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-[1.25rem] px-3 py-2">{error}</p>}

      {!treasuryAddress ? (
        <div className="w-full h-12 rounded-full border border-amber-500/25 bg-amber-500/8 text-amber-400 text-[13.5px] font-medium flex items-center justify-center gap-2 px-3 text-center">
          <AlertTriangle className="size-4 shrink-0" strokeWidth={1.5} />
          No on-chain wallet configured
        </div>
      ) : (
        <button
          onClick={handleBuy}
          disabled={investing || influencer.availableShares === 0}
          className="group w-full h-12 rounded-full bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-blue-950 text-[15px] font-semibold flex items-center justify-between pl-5 pr-1.5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] shadow-[0_0_40px_-8px_rgba(16,185,129,0.6),inset_0_1px_1px_rgba(255,255,255,0.4)]"
        >
          <span className="flex items-center gap-2">
            {investing
              ? <><Loader2 className="size-4 animate-spin" /> {stepLabel ?? "Processing…"}</>
              : !connected
                ? "Connect Wallet"
                : `Buy ${shares} Share${shares !== 1 ? "s" : ""}`}
          </span>
          <span className="size-9 rounded-full bg-blue-950/15 flex items-center justify-center shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
            {!connected ? <Wallet className="size-4" strokeWidth={2} /> : <TrendingUp className="size-4" strokeWidth={2} />}
          </span>
        </button>
      )}

      {isProjected && <p className="text-[12px] text-zinc-700 text-center">Yield estimated from niche benchmarks. Not a guarantee.</p>}
    </div>
  );
}

// ─── Invest "coming soon" card ────────────────────────────────────────────────
// Shown in place of the InvestPanel when the Invest feature is turned off
// (NEXT_PUBLIC_INVEST_ENABLED !== "true"). The full InvestPanel above is left in
// place so re-enabling is flag-only. Redeem stays available below regardless.

function InvestComingSoon() {
  return (
    <div className="rounded-[1.75rem] bg-[#0a0a0d] border border-[#1e1e24] p-5 text-center space-y-2.5">
      <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-white/[0.04] border border-white/[0.08]">
        <Lock className="size-4 text-zinc-500" strokeWidth={1.5} />
      </div>
      <p className="text-[14px] font-semibold text-zinc-200">Investing — coming soon</p>
      <p className="text-[12.5px] text-zinc-500 leading-relaxed">
        Buying shares in AI agents isn&apos;t available yet. Check back soon.
      </p>
    </div>
  );
}

// ─── Redeem panel ─────────────────────────────────────────────────────────────

function RedeemPanel({ influencer }: { influencer: AIInfluencer }) {
  const { connected, publicKey } = useUnifiedSolanaWallet();
  const { accessToken } = useSupabaseAuth();
  const [amount, setAmount] = useState(1);
  const [redeeming, setRedeeming] = useState(false);
  const [result, setResult] = useState<{ payout: number; txSignature: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const held = useQuery(
    api.shares.walletShares,
    connected && publicKey ? { mintAddress: influencer.id, wallet: publicKey.toBase58() } : "skip",
  );

  // Sync amount default to held when it first resolves
  useEffect(() => {
    if (held !== undefined && held > 0) setAmount(held);
  }, [held]);

  if (!connected || !publicKey) return null;
  if (held === undefined) return null;
  if (held <= 0) return null;

  async function handleRedeem() {
    if (!publicKey) return;
    setRedeeming(true);
    setError(null);
    try {
      const resp = await fetch("/api/market/redeem-shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          mintAddress: influencer.id,
          holderWallet: publicKey.toBase58(),
          sharesToBurn: amount,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "redeem failed");
      setResult({ payout: data.payout, txSignature: data.txSignature });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Redemption failed");
    } finally {
      setRedeeming(false);
    }
  }

  if (result) return (
    <div className="space-y-3">
      <div className="rounded-[1.75rem] bg-blue-500/8 border border-blue-500/20 p-4 text-center space-y-2">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
          <CheckCircle2 className="size-7 text-blue-400 mx-auto" />
        </motion.div>
        <p className="text-[14px] font-semibold text-blue-300">Redemption confirmed</p>
        <p className="text-[13px] text-zinc-400">
          {amount} share{amount !== 1 ? "s" : ""} → <span className="font-mono font-bold text-white">${result.payout.toFixed(2)} USDC</span>
        </p>
        <a
          href={`https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet`}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-300 font-mono mt-1 transition-colors"
        >
          {result.txSignature.slice(0, 8)}…{result.txSignature.slice(-6)}
          <ExternalLink className="size-3" />
        </a>
      </div>
      <button onClick={() => setResult(null)} className="w-full h-9 rounded-[1.25rem] border border-[#27272a] text-[14px] text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors">
        Done
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Holdings summary */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-zinc-500">You hold</p>
        <p className="text-[18px] font-mono font-black text-white tabular-nums">{held} <span className="text-[13px] text-zinc-500 font-normal">shares</span></p>
      </div>

      <Separator className="bg-[#1e1e24]" />

      {/* Amount selector */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-zinc-500">Shares to redeem</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setAmount(a => Math.max(1, a - 1))} className="h-6 w-6 rounded-[0.9rem] bg-[#1a1a1e] hover:bg-[#252528] text-zinc-300 text-[16px] flex items-center justify-center transition-colors">−</button>
            <span className="text-[16px] font-mono font-bold text-white w-8 text-center tabular-nums">{amount}</span>
            <button onClick={() => setAmount(a => Math.min(held, a + 1))} className="h-6 w-6 rounded-[0.9rem] bg-[#1a1a1e] hover:bg-[#252528] text-zinc-300 text-[16px] flex items-center justify-center transition-colors">+</button>
          </div>
        </div>
        <input
          type="range" min={1} max={held} value={amount}
          onChange={e => setAmount(Number(e.target.value))}
          className="w-full h-1 bg-[#1e1e24] rounded-full appearance-none cursor-pointer accent-blue-500"
        />
        <div className="flex gap-1.5 flex-wrap">
          {([1, Math.ceil(held / 4), Math.ceil(held / 2), held] as number[])
            .filter((n, i, arr) => arr.indexOf(n) === i && n >= 1)
            .map(n => (
              <button key={n} onClick={() => setAmount(n)}
                className={`px-2.5 py-1 rounded-[0.9rem] text-[12px] font-mono font-semibold border transition-all ${amount === n ? "border-blue-500/50 bg-blue-500/10 text-blue-300" : "border-[#27272a] text-zinc-500 hover:text-zinc-300"}`}>
                {n === held ? "All" : n}
              </button>
            ))}
        </div>
      </div>

      {/* Payout estimate */}
      <div className="rounded-[1.75rem] bg-[#0a0a0d] border border-[#1e1e24] p-3.5 space-y-2">
        <div className="flex justify-between text-[13px]">
          <span className="text-zinc-500">{amount} share{amount !== 1 ? "s" : ""} × ${influencer.sharePrice.toFixed(2)}</span>
          <span className="font-mono font-semibold text-white">${(amount * influencer.sharePrice).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span className="text-zinc-500">Exit fee (est.)</span>
          <span className="font-mono text-zinc-500">–</span>
        </div>
        <div className="flex justify-between text-[13px] pt-1 border-t border-white/[0.06]">
          <span className="text-zinc-400 font-medium">You receive</span>
          <span className="font-mono font-bold text-blue-400">≈${(amount * influencer.sharePrice).toFixed(2)} USDC</span>
        </div>
      </div>

      {error && <p className="text-[12.5px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-[1.25rem] px-3 py-2">{error}</p>}

      <button
        onClick={handleRedeem}
        disabled={redeeming || amount < 1 || amount > held}
        className="group w-full h-11 rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-100 text-[14px] font-semibold flex items-center justify-between pl-4 pr-1.5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] border border-white/[0.08]"
      >
        <span className="flex items-center gap-2">
          {redeeming ? <><Loader2 className="size-4 animate-spin" /> Redeeming…</> : `Redeem ${amount} Share${amount !== 1 ? "s" : ""}`}
        </span>
        <span className="size-8 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
          <ArrowUpRight className="size-4" strokeWidth={2} />
        </span>
      </button>

      <p className="text-[11.5px] text-zinc-700 text-center">Shares burned at NAV. Exit fee determined at settlement.</p>
    </div>
  );
}

// ─── Page tabs ────────────────────────────────────────────────────────────────

type Tab = "overview" | "earnings" | "campaigns" | "activity" | "tasks" | "knowledge" | "generations" | "creations" | "photos" | "chat";

// Row types derived from the Convex query return shapes
type SubmissionRow = FunctionReturnType<typeof api.submissions.listByInfluencer>[number];
type TaskRowData = FunctionReturnType<typeof api.agentTasks.listByMint>[number];
type GenerationRow = FunctionReturnType<typeof api.agentTasks.listGenerations>[number];
type KnowledgeRow = FunctionReturnType<typeof api.agentKnowledge.listByMint>[number];
type MemoryRow = FunctionReturnType<typeof api.agentTasks.recallMemories>[number];
type ClipRow = FunctionReturnType<typeof api.clipJobs.listClipsByMint>[number];

// ─── Creations grid (media-only masonry) ──────────────────────────────────────

type CreationItem = {
  _id: string;
  type: string;
  title: string;
  output?: string;
  completedAt?: number;
  _creationTime: number;
  /** Clip virality 0-100 (clips only; generations have none). */
  viralScore?: number;
  /** Caption the agent posted with the video (clips). */
  caption?: string;
  /** Live view count of the posted video (clips). */
  viewCount?: number;
  /** The published post URL (clips) — opens the live video. */
  postUrl?: string;
  /** Platform the clip was posted to (tiktok/instagram/youtube). */
  platform?: string;
};

type MediaCreation = {
  id: string;
  type: string;
  title: string;
  ts: number;
  mediaUrl: string;
  mediaKind: "video" | "image";
  /** Threaded from the source clip so each card can show its virality badge. */
  viralScore?: number;
  caption?: string;
  viewCount?: number;
  postUrl?: string;
  platform?: string;
};

/**
 * Extracts ALL media artifacts from a completed task output.
 * Returns an array so a single create_video task surfaces BOTH the storyboard
 * still image and the final video as separate cards. Empty array if no media.
 */
function extractMedia(item: CreationItem): MediaCreation[] {
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(item.output ?? "{}"); } catch { return []; }
  if (!parsed || typeof parsed !== "object") return [];

  const pickString = (val: unknown): string | null =>
    typeof val === "string" && /^https?:\/\//i.test(val) ? val : null;

  const result = parsed.result as Record<string, unknown> | undefined;
  const script = parsed.script as Record<string, unknown> | undefined;
  const video = parsed.video as Record<string, unknown> | undefined;

  const out: MediaCreation[] = [];
  const seen = new Set<string>();
  const baseTs = item.completedAt ?? item._creationTime;
  const push = (url: string | null, kind: "video" | "image", suffix?: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({
      id: `${item._id}-${suffix ?? kind}`,
      type: item.type,
      title: item.title,
      ts: baseTs,
      mediaUrl: url,
      mediaKind: kind,
      viralScore: item.viralScore,
      // Caption + views + post link apply to the posted VIDEO (not still images).
      caption: kind === "video" ? item.caption : undefined,
      viewCount: kind === "video" ? item.viewCount : undefined,
      postUrl: kind === "video" ? item.postUrl : undefined,
      platform: kind === "video" ? item.platform : undefined,
    });
  };

  // Videos
  push(pickString(parsed.videoUrl),    "video", "video");
  push(pickString(video?.url),         "video", "video-obj");
  push(pickString(result?.videoUrl),   "video", "video-result");
  push(pickString(script?.videoUrl),   "video", "video-script");

  // Images — including the storyboard from create_video pipeline + grid + standalone images
  push(pickString(parsed.storyboardImageUrl), "image", "storyboard");
  push(pickString(parsed.imageUrl),           "image", "image");
  push(pickString(parsed.gridImageUrl),       "image", "grid");
  push(pickString(result?.imageUrl),          "image", "image-result");
  push(pickString((result as Record<string, unknown> | undefined)?.storyboardImageUrl), "image", "storyboard-result");

  // images array (e.g. from analyze-images / multi-shot avatar gen)
  const images = parsed.images;
  if (Array.isArray(images)) {
    images.forEach((img, i) => {
      if (img && typeof img === "object") {
        push(pickString((img as Record<string, unknown>).url), "image", `arr-${i}`);
      } else {
        push(pickString(img), "image", `arr-${i}`);
      }
    });
  }

  return out;
}

function CreationsGrid({ creations, extraMedia, agentName }: { creations: CreationItem[]; extraMedia?: MediaCreation[]; agentName: string }) {
  const items = useMemo(() => {
    // flatMap because each task can have multiple media artifacts (e.g. storyboard + video).
    // `extraMedia` carries already-flattened media that don't live in agentTasks —
    // e.g. a clipping agent's rendered clips (from the `clips` table). Merge both and
    // sort newest-first so clips interleave correctly with task creations.
    const taskMedia = creations.flatMap(extractMedia);
    return [...taskMedia, ...(extraMedia ?? [])].sort((a, b) => b.ts - a.ts);
  }, [creations, extraMedia]);
  const [lightbox, setLightbox] = useState<MediaCreation | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const videoCount = items.filter(i => i.mediaKind === "video").length;
  const imageCount = items.filter(i => i.mediaKind === "image").length;

  if (items.length === 0) {
    return (
      <div className="rounded-[1.25rem] border border-white/[0.06] bg-[#0d0e12] p-10 text-center">
        <Sparkles className="size-6 text-zinc-700 mx-auto mb-3" />
        <p className="text-[14px] text-zinc-500">No creations yet — run the agent from the builder to start producing content.</p>
        <p className="text-[12.5px] text-zinc-700 mt-1">{agentName} has not produced any media artifacts yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-4 rounded-xl border border-zinc-800/80 bg-white/[0.025] px-4 py-3">
        <div>
          <div className="text-[12px] uppercase tracking-wider text-zinc-600">Total</div>
          <div className="text-[18px] font-bold text-white tabular-nums">{items.length}</div>
        </div>
        <div className="h-8 w-px bg-white/[0.06]" />
        <div>
          <div className="text-[12px] uppercase tracking-wider text-zinc-600">Videos</div>
          <div className="text-[18px] font-bold text-white tabular-nums">{videoCount}</div>
        </div>
        <div className="h-8 w-px bg-white/[0.06]" />
        <div>
          <div className="text-[12px] uppercase tracking-wider text-zinc-600">Images</div>
          <div className="text-[18px] font-bold text-white tabular-nums">{imageCount}</div>
        </div>
      </div>

      {/* Masonry */}
      <div
        style={{ columnGap: "12px" }}
        className="[column-count:1] md:[column-count:2] lg:[column-count:3]"
      >
        {items.map((item, i) => {
          const fmtViews = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K` : String(n);
          // Posted clips carry a live post URL → the hover overlay opens the post
          // on its actual platform (in a new tab). Only one (platform,url) per card
          // row, but rendered as a loop to keep the overlay multi-button-capable.
          const postLinks = item.mediaKind === "video" && item.postUrl && item.platform
            ? [{ platform: item.platform, label: platformLabel(item.platform), url: item.postUrl }]
            : [];
          return (
          <motion.div
            key={item.id}
            onClick={() => setLightbox(item)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLightbox(item); } }}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, delay: Math.min(i * 0.05, 0.5), ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
            className="group relative mb-3 block w-full overflow-hidden border border-white/10 bg-[#131316] text-left break-inside-avoid transition-colors duration-300 hover:bg-[#1a1a1e] hover:border-white/20 cursor-pointer"
          >
            <div className="relative">
              {item.mediaKind === "video" ? (
                <video
                  src={item.mediaUrl}
                  className="w-full block transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                  playsInline muted loop autoPlay preload="metadata"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.mediaUrl} alt={item.title} className="w-full block transition-transform duration-500 ease-out group-hover:scale-[1.04]" loading="lazy" />
              )}

              {/* Top badges: virality + views (always visible) */}
              <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
                {typeof item.viralScore === "number" && (
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums shadow-sm backdrop-blur-sm ${
                      item.viralScore >= 80 ? "bg-blue-500/90 text-white" : item.viralScore >= 60 ? "bg-amber-500/90 text-black" : "bg-zinc-800/85 text-zinc-200"
                    }`}
                    title={`Virality score ${Math.round(item.viralScore)}/100`}
                  >
                    <span aria-hidden>🔥</span>{Math.round(item.viralScore)}
                  </span>
                )}
                {typeof item.viewCount === "number" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/55 backdrop-blur-sm px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-sm" title={`${item.viewCount.toLocaleString()} views`}>
                    <Eye className="size-3" />{fmtViews(item.viewCount)}
                  </span>
                )}
              </div>

              {/* Hover overlay — open the posted clip on its actual platform (new tab).
                  Sits above the info gradient; card-click still opens the popup. */}
              {postLinks.length > 0 && (
                <div className="absolute inset-x-0 bottom-14 z-20 flex justify-center gap-1.5 px-3 opacity-0 translate-y-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0">
                  {postLinks.map((link) => (
                    <a
                      key={link.platform}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={`Open on ${link.label}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/70 backdrop-blur-md px-3 py-1.5 text-[12px] font-semibold text-white shadow-lg hover:border-blue-400/50 hover:text-blue-300 transition-colors"
                    >
                      <PlatformBadge id={link.platform} label={link.label} className="size-4 text-[7px]" />
                      {link.label}
                      <ExternalLink className="size-3" />
                    </a>
                  ))}
                </div>
              )}

              {/* Always-on info overlay (no hover needed) — gradient + caption + meta. */}
              {/* Apple-minimal info overlay — matches the /agents card type:
                  light-weight title, muted meta, no task-type label. */}
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/30 to-transparent p-3.5 transition-opacity duration-300 group-hover:from-black/90">
                {item.caption ? (
                  <p className="text-[14px] font-light text-white leading-snug line-clamp-2">{item.caption}</p>
                ) : (
                  <p className="text-[14px] font-light text-white leading-snug truncate">{item.title}</p>
                )}
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-white/50 tabular-nums">{new Date(item.ts).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {typeof item.viewCount === "number" && (
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-white/50 tabular-nums"><Eye className="size-3" />{fmtViews(item.viewCount)} views</span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
          );
        })}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 cursor-zoom-out"
            onClick={() => setLightbox(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="max-w-5xl w-full max-h-[90vh] flex flex-col gap-3 cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-1 flex items-center justify-center overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-[#0d0e12]">
                {lightbox.mediaKind === "video" ? (
                  <video src={lightbox.mediaUrl} controls autoPlay className="max-h-[80vh] max-w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={lightbox.mediaUrl} alt={lightbox.title} className="max-h-[80vh] max-w-full object-contain" />
                )}
              </div>
              <div className="flex items-start justify-between gap-3 text-white/80">
                <div className="min-w-0">
                  <div className="text-[12px] uppercase tracking-wider text-white/50">
                    {lightbox.type.replace(/_/g, " ")}{lightbox.platform ? ` · ${lightbox.platform}` : ""}
                    {typeof lightbox.viewCount === "number" && (
                      <span className="ml-2 inline-flex items-center gap-1 text-blue-300 normal-case tracking-normal"><Eye className="size-3" />{lightbox.viewCount.toLocaleString()} views</span>
                    )}
                  </div>
                  <div className="text-[15px] font-semibold leading-snug">{lightbox.caption || lightbox.title}</div>
                  <div className="text-[12.5px] text-white/40 tabular-nums">{new Date(lightbox.ts).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lightbox.postUrl && (
                    <a
                      href={lightbox.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[13px] text-white/80 hover:text-white px-3 py-1.5 rounded-[0.9rem] border border-white/[0.08] hover:border-blue-500/50 transition-colors"
                    >
                      <ExternalLink className="size-3.5" /> Open post
                    </a>
                  )}
                  <button
                    onClick={() => setLightbox(null)}
                    className="text-[13px] text-white/60 hover:text-white px-3 py-1.5 rounded-[0.9rem] border border-white/[0.08] hover:border-white/20 transition-colors"
                  >
                    Close (Esc)
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Profile photos (avatar set: GIF + generated stills + character grid) ─────

type ProfilePhoto = { url: string; label: string };

/**
 * Gallery of every image tied to the agent's identity: the animated avatar GIF,
 * the individual generated poses, and the 7-pose character grid. Storage paths
 * tell them apart — Supabase keys are gifs/… , refs/… (generated poses), and
 * grids/… (the turnaround grid). Uploaded reference photos are baked into the
 * animated GIF (frame 1), so the GIF stands in for them.
 */
function PhotosGrid({ photos, agentName }: { photos: ProfilePhoto[]; agentName: string }) {
  const [lightbox, setLightbox] = useState<ProfilePhoto | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (photos.length === 0) {
    return (
      <div className="rounded-[1.25rem] border border-white/[0.06] bg-[#0d0e12] p-10 text-center mx-6 my-6">
        <Images className="size-6 text-zinc-700 mx-auto mb-3" />
        <p className="text-[14px] text-zinc-500">No profile images yet.</p>
        <p className="text-[12.5px] text-zinc-700 mt-1">{agentName}&apos;s avatar set will appear here once it&apos;s generated.</p>
      </div>
    );
  }

  const gridCount = photos.filter((p) => p.label === "Character grid").length;
  const poseCount = photos.filter((p) => p.label === "Generated pose").length;

  return (
    <div className="space-y-4 px-6 py-6">
      {/* Stats bar */}
      <div className="flex items-center gap-4 rounded-xl border border-zinc-800/80 bg-white/[0.025] px-4 py-3">
        <div>
          <div className="text-[12px] uppercase tracking-wider text-zinc-600">Images</div>
          <div className="text-[18px] font-bold text-white tabular-nums">{photos.length}</div>
        </div>
        <div className="h-8 w-px bg-white/[0.06]" />
        <div>
          <div className="text-[12px] uppercase tracking-wider text-zinc-600">Poses</div>
          <div className="text-[18px] font-bold text-blue-400 tabular-nums">{poseCount}</div>
        </div>
        <div className="h-8 w-px bg-white/[0.06]" />
        <div>
          <div className="text-[12px] uppercase tracking-wider text-zinc-600">Grid</div>
          <div className="text-[18px] font-bold text-violet-400 tabular-nums">{gridCount}</div>
        </div>
      </div>

      {/* Masonry */}
      <div style={{ columnGap: "12px" }} className="[column-count:1] md:[column-count:2] lg:[column-count:3]">
        {photos.map((photo) => (
          <button
            key={photo.url}
            onClick={() => setLightbox(photo)}
            className="group mb-3 block w-full overflow-hidden rounded-[1.25rem] border border-white/[0.06] bg-[#0d0e12] text-left break-inside-avoid"
          >
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={photo.label} className="w-full block" loading="lazy" />
              <div className="absolute left-2.5 top-2.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
                {photo.label}
              </div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-3">
                <div className="text-[13px] font-semibold text-white">{photo.label}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 cursor-zoom-out"
            onClick={() => setLightbox(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="max-w-5xl w-full max-h-[90vh] flex flex-col gap-3 cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex-1 flex items-center justify-center overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-[#0d0e12]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={lightbox.url} alt={lightbox.label} className="max-h-[80vh] max-w-full object-contain" />
              </div>
              <div className="flex items-center justify-between text-white/80">
                <div className="text-[15px] font-semibold">{lightbox.label}</div>
                <button
                  onClick={() => setLightbox(null)}
                  className="text-[13px] text-white/60 hover:text-white px-3 py-1.5 rounded-[0.9rem] border border-white/[0.08] hover:border-white/20 transition-colors"
                >
                  Close (Esc)
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function InfluencerProfile({ influencer }: { influencer: AIInfluencer }) {
  const router = useRouter();
  // "Back", not a fixed "/market" link: if the visitor actually came FROM
  // somewhere in this tab (the marketplace grid, the tournament leaderboard, a
  // search), real browser back returns them to that exact scroll position and
  // filter state — a hardcoded /market link used to blow that away even when
  // they'd arrived from, say, /tournament. Falls back to /market only when
  // there's nowhere to go back to (e.g. this page was opened directly).
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/market");
  };
  const { accessToken } = useSupabaseAuth();
  // Owner gate: the "Run Now" control (and any owner-only action) is only shown to
  // the agent's creator, matched by connected wallet.
  const { publicKey } = useUnifiedSolanaWallet();
  const isOwner = !!publicKey && !!influencer.creatorWallet && publicKey.toBase58() === influencer.creatorWallet;
  const [tab, setTab] = useState<Tab>("overview");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [investOpen, setInvestOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [chartRange, setChartRange] = useState<"1W" | "1M" | "3M" | "6M">("1M");
  const [loopRunning, setLoopRunning] = useState(false);
  const [, setLoopResult] = useState<{ tasksRun: number; error?: string } | null>(null);
  const [lastLoopAt, setLastLoopAt] = useState<number | null>(null);
  const [heartbeatTick, setHeartbeatTick] = useState(0);
  const [loopLog, setLoopLog] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [taskOffer, setTaskOffer] = useState<{ title: string; description: string; deliverables: string[]; price: number; currency: string; estimatedHours: number } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const loopLogRef = useRef<HTMLDivElement>(null);

  const submissions    = useQuery(api.submissions.listByInfluencer, { influencerMint: influencer.id });
  const tasks          = useQuery(api.agentTasks.listByMint, { mintAddress: influencer.id, limit: 50 });
  // Pin the currently-running task to the very top, then pending, then the rest
  // (each group newest-first), so the live work is always first in the list.
  const sortedTasks = useMemo(() => {
    if (!tasks) return tasks;
    const rank = (s: string) => (s === "running" ? 0 : s === "pending" || s === "awaiting_approval" ? 1 : 2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return [...tasks].sort((a: any, b: any) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return (b.startedAt ?? b.completedAt ?? b._creationTime) - (a.startedAt ?? a.completedAt ?? a._creationTime);
    });
  }, [tasks]);
  const generations    = useQuery(api.agentTasks.listGenerations, { mintAddress: influencer.id });
  // Clipper agent output lands in the `clips` table (not `generations`). Surface
  // ready/posted clips that have a playable URL as video cards in the Creations masonry.
  const clips          = useQuery(api.clipJobs.listClipsByMint, { mintAddress: influencer.id });

  // Live view counts for this agent's posted clips, joined from the content-reward
  // display rows by post URL. Refreshed on mount + when the clip set changes.
  const [clipViews, setClipViews] = useState<Record<string, number>>({});
  const postedUrls = useMemo(
    () => (clips ?? []).map((c: ClipRow) => c.postUrl).filter((u: string | undefined): u is string => typeof u === "string" && /^https?:\/\//i.test(u)),
    [clips],
  );
  const postedUrlsKey = postedUrls.join("|");
  useEffect(() => {
    if (postedUrls.length === 0) { setClipViews({}); return; }
    let alive = true;
    getViewsForUrls(postedUrls).then((m) => { if (alive) setClipViews(m); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postedUrlsKey]);

  const clipCreations  = useMemo<CreationItem[]>(() => {
    if (!clips) return [];
    const cleanUrl = (u: string) => u.split("?")[0].replace(/\/$/, "");
    return clips
      .filter((c: ClipRow) => (c.status === "ready" || c.status === "posted") && typeof c.clipUrl === "string" && /^https?:\/\//i.test(c.clipUrl))
      .map((c: ClipRow) => {
        const views = c.postUrl ? (clipViews[c.postUrl] ?? clipViews[cleanUrl(c.postUrl)]) : undefined;
        return {
          _id: c._id,
          type: "clip",
          title: c.title,
          // Synthetic output so extractMedia's `parsed.videoUrl` probe yields a video card.
          output: JSON.stringify({ videoUrl: c.clipUrl }),
          completedAt: c.updatedAt ?? c.createdAt,
          _creationTime: c._creationTime,
          // Carry the clip's virality so the Creations card can badge it.
          viralScore: typeof c.viralScore === "number" ? c.viralScore : undefined,
          caption: typeof c.captionText === "string" && c.captionText.trim() ? c.captionText.trim() : undefined,
          viewCount: typeof views === "number" ? views : undefined,
          postUrl: typeof c.postUrl === "string" ? c.postUrl : undefined,
          platform: typeof c.platform === "string" ? c.platform : undefined,
        };
      });
  }, [clips, clipViews]);
  // Merge clips ahead of generations; both flow into the Creations media masonry.
  const creations      = useMemo<CreationItem[]>(
    () => [...clipCreations, ...(generations ?? [])],
    [clipCreations, generations]
  );
  // Web2-style headline stats for Overview — real counts, not fabricated.
  // Views come from BOTH sources a posted video can carry a viewCount on:
  // clips.viewCount (organic auto-posts) and submissions.viewCount (campaign
  // participation) — a clip is never in both, so summing both is correct,
  // not double-counting.
  const totalVideosGenerated = creations.length;
  const totalViews = useMemo(() => {
    const fromClips = (clips ?? []).reduce((sum: number, c: ClipRow) => sum + (typeof c.viewCount === "number" ? c.viewCount : 0), 0);
    const fromSubmissions = (submissions ?? []).reduce((sum: number, s: { viewCount?: number }) => sum + (typeof s.viewCount === "number" ? s.viewCount : 0), 0);
    return fromClips + fromSubmissions;
  }, [clips, submissions]);
  const taskStats      = useQuery(api.agentTasks.statsForMint, { mintAddress: influencer.id });
  const earningsTS     = useQuery(api.influencers.earningsTimeSeries, { mintAddress: influencer.id, range: chartRange });
  const knowledgeEntries = useQuery(api.agentKnowledge.listByMint, { mintAddress: influencer.id });
  const memories = useQuery(api.agentTasks.recallMemories, { mintAddress: influencer.id, limit: 20 });
  // Full agent doc — carries `avatarStills` (generated poses + character grid) that
  // the trimmed `AIInfluencer` prop drops. Drives the Photos gallery tab.
  const agentDoc = useQuery(api.influencers.getByMint, { mintAddress: influencer.id });
  // The NFT draft holds the FULL avatar set (gif + poses + grid). The character
  // grid can finish in the background AFTER mint, so it may live only on the draft
  // and not on the influencer's `avatarStills` — pull both to never miss it.
  const nftDraft = useQuery(api.nftAgents.getDraftByMint, { mintAddress: influencer.id });
  // The agent's profile image set: animated avatar GIF + every generated still +
  // the 7-pose character grid. Supabase storage paths label each kind (gifs/…,
  // refs/… = generated poses, grids/… = the turnaround grid). Deduped, http-only.
  const profileImages = useMemo<ProfilePhoto[]>(() => {
    const list: ProfilePhoto[] = [];
    const seen = new Set<string>();
    const add = (url: string | undefined | null, label: string) => {
      if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return;
      seen.add(url);
      list.push({ url, label });
    };
    const labelFor = (url: string): string =>
      /\/grids?\//i.test(url) ? "Character grid"
      : /\.gif(\?|#|$)/i.test(url) || /\/gifs?\//i.test(url) ? "Avatar (animated)"
      : /\/refs?\//i.test(url) ? "Generated pose"
      : "Image";
    add(influencer.avatarUrl, labelFor(influencer.avatarUrl ?? ""));
    for (const url of agentDoc?.avatarStills ?? []) add(url, labelFor(url));
    // Fold in the draft's full set last — captures the character grid when it
    // landed post-mint (deduped against what's already shown).
    for (const url of nftDraft?.avatarUrls ?? []) add(url, labelFor(url));
    return list;
  }, [influencer.avatarUrl, agentDoc, nftDraft]);
  // Connected social accounts → one sidebar button per account that opens the
  // profile on the actual platform. Real per-platform connected identity (synced from upload-post by the
  // syncConnectedSocials cron — see influencers.setConnectedPlatforms), NOT
  // the agent's own Vello handle. A connected TikTok/Instagram/etc account
  // almost always has a DIFFERENT public @name than the agent's Vello handle,
  // so building the link from influencer.handle opened the wrong profile (or
  // a profile that doesn't exist) every time the two diverged.
  const connectedSocials = useMemo<{ id: string; label: string; handle: string; url: string }[]>(
    () => (agentDoc?.connectedPlatforms ?? [])
      .map((id) => {
        const account = agentDoc?.connectedSocialAccounts?.[id] ?? {};
        const url = socialProfileUrl(id, account);
        const handle = account.handle?.trim().replace(/^@/, "") || account.id?.trim() || "";
        return { id, label: platformLabel(id), handle, url };
      })
      .filter((s): s is { id: string; label: string; handle: string; url: string } => Boolean(s.url)),
    [agentDoc?.connectedPlatforms, agentDoc?.connectedSocialAccounts],
  );
  // Use the dedicated agent wallet for balance tracking; fall back to mintAddress
  const vault = useMintBalance(influencer.agentWallet ?? influencer.id);
  // Realtime economy account — `unsettledTabUsdc` is the running cost the agent
  // has accrued from executed tasks but not yet swept on-chain. Subscribing here
  // (Convex push) means the balance ticks DOWN the instant a task is metered,
  // without waiting for the 15s on-chain poll. Available = on-chain − tab.
  const account = useQuery(api.agentAccount.getWithNav, { mintAddress: influencer.id });
  const unsettledTab = account?.unsettledTabUsdc ?? 0;
  const availableUsdc = Math.max(0, (vault.usdc ?? 0) - unsettledTab);

  // Auto-provision a dedicated wallet for agents that don't have one yet
  useEffect(() => {
    if (influencer.agentWallet) return;
    fetch("/api/nft/backfill-wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mintAddress: influencer.id }),
    }).catch(() => {/* non-blocking */});
  }, [influencer.id, influencer.agentWallet]);

  // Economics
  const soldShares = influencer.totalShares - influencer.availableShares;
  const soldPct = influencer.totalShares > 0 ? (soldShares / influencer.totalShares) * 100 : 0;
  const hasEarnings = influencer.monthlyEarnings > 0 && influencer.tvl > 0;
  const apr = hasEarnings
    ? ((influencer.monthlyEarnings * 12) / influencer.tvl) * 100
    : (NICHE_APR[influencer.niche] ?? 10);
  const isProjected = !hasEarnings;
  const perShareMonthly = influencer.totalShares > 0
    ? influencer.monthlyEarnings / influencer.totalShares
    : (influencer.sharePrice * apr) / 100 / 12;

  const monthsActive = Math.max(1, Math.floor(
    (Date.now() - new Date(influencer.createdAt ?? Date.now()).getTime()) / (1000 * 60 * 60 * 24 * 30)
  ));
  const totalProfit = influencer.monthlyEarnings > 0
    ? influencer.monthlyEarnings * monthsActive
    : 0;

  const approvedCount = submissions?.filter((s: SubmissionRow) => s.status === "approved").length ?? 0;
  const pendingCount = submissions?.filter((s: SubmissionRow) => s.status === "pending").length ?? 0;

  const earningsData = useMemo(() => {
    const now = new Date();
    return GROWTH.map((g, i) => {
      const d = new Date(now); d.setMonth(d.getMonth() - (5 - i));
      return {
        month: d.toLocaleDateString("en", { month: "short" }),
        earnings: influencer.monthlyEarnings > 0 ? Math.floor(influencer.monthlyEarnings * g * JITTER[i]) : 0,
      };
    });
  }, [influencer.monthlyEarnings]);

  // Use real on-chain + task-revenue time series; fall back to projected while loading
  const chartData = useMemo(() => {
    if (earningsTS && earningsTS.length > 0) return earningsTS;
    // Fallback while loading or if no data yet
    const base = influencer.monthlyEarnings;
    const daily = base / 30;
    const buckets = chartRange === "1W" ? 7 : chartRange === "1M" ? 30 : chartRange === "3M" ? 13 : 6;
    return Array.from({ length: buckets }, (_, i) => {
      const d = new Date();
      if (chartRange === "6M") d.setMonth(d.getMonth() - (buckets - 1 - i));
      else d.setDate(d.getDate() - (buckets - 1 - i) * (chartRange === "3M" ? 7 : 1));
      const g = 0.5 + (i / (buckets - 1)) * 0.5;
      const label = chartRange === "6M"
        ? d.toLocaleDateString("en", { month: "short" })
        : i % 6 === 0 || i === buckets - 1
          ? d.toLocaleDateString("en", { month: "short", day: "numeric" })
          : "";
      return { label, earnings: base > 0 ? parseFloat((daily * g).toFixed(4)) : 0 };
    });
  }, [earningsTS, influencer.monthlyEarnings, chartRange]);

  const shareValueData = useMemo(() =>
    GROWTH.map((g, i) => ({
      month: earningsData[i].month,
      price: parseFloat((influencer.sharePrice * (0.6 + g * 0.4)).toFixed(2)),
    })), [influencer.sharePrice, earningsData]);

  const runningCount = tasks?.filter((t: TaskRowData) => t.status === "running").length ?? 0;
  const pendingTaskCount = tasks?.filter((t: TaskRowData) => t.status === "pending" || t.status === "awaiting_approval").length ?? 0;
  const liveCount = runningCount + pendingTaskCount;

  const TABS: { id: Tab; label: string; icon?: React.ReactNode; badge?: number }[] = [
    { id: "overview",  label: "Overview" },
    { id: "earnings",  label: "Earnings" },
    { id: "campaigns", label: "Campaigns", icon: <ScanSearch className="size-3" /> },
    { id: "tasks",     label: "Tasks", badge: liveCount },
    { id: "creations", label: "Videos", icon: <Sparkles className="size-3" /> },
    { id: "knowledge", label: "Knowledge" },
    // Activity / Generations / Chat tabs hidden per request — their render
    // blocks stay below, just unreachable from the tab bar.
  ];

  const usdcIsEmpty = !vault.loading && (vault.usdc ?? 0) === 0;
  const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

  const runAutonomyLoop = useCallback(async () => {
    setLoopRunning(true);
    setLoopResult(null);
    const ts = () => new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLoopLog(prev => [...prev.slice(-40), `[${ts()}] ▶ Run Now triggered`]);
    try {
      const res = await fetch("/api/agents/autonomy-loop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ mintAddress: influencer.id }),
      });
      const data = await res.json() as {
        tasksRun?: number; error?: string;
        results?: Array<{ type?: string; title?: string; ok?: boolean; error?: string }>;
        isTrader?: boolean;
        balance?: { usdc: number; sol: number };
        settled?: { wins: number; losses: number; netPayout: number };
        placed?: number;
        summary?: string;
        aborted?: string;
      };

      if (data.error) {
        setLoopLog(prev => [...prev, `[${ts()}] ✗ ${data.error}`]);
      } else if (data.isTrader) {
        // ── TRADER — render the 5-step cycle nicely ──────────────────────
        const stepIcons: Record<string, string> = {
          settle_bets: "💰",
          check_wallet: "💳",
          trader_tick: "⚡",
          binary_scan: "🎯",
        };
        (data.results ?? []).forEach(r => {
          const icon = stepIcons[r.type ?? ""] ?? (r.ok ? "✓" : "✗");
          const sign = r.ok ? "✓" : "✗";
          setLoopLog(prev => [...prev, `[${ts()}] ${icon} ${sign} ${r.title ?? r.type ?? ""}`]);
        });
        if (data.aborted) {
          const reason = data.aborted === "low_sol" ? "SOL too low for fees" : data.aborted === "low_usdc" ? "USDC too low to trade — fund the wallet" : data.aborted;
          setLoopLog(prev => [...prev, `[${ts()}] ⛔ Cycle aborted: ${reason}`]);
        } else {
          setLoopLog(prev => [...prev, `[${ts()}] ● ${data.summary ?? "Cycle complete"}`]);
        }
      } else {
        // ── INFLUENCER / WORKER — original task feed ─────────────────────
        (data.results ?? []).forEach(r => {
          setLoopLog(prev => [...prev, `[${ts()}] ${r.error ? "✗" : "✓"} ${r.title ?? r.type ?? ""}${r.error ? ` — ${r.error}` : ""}`]);
        });
        setLoopLog(prev => [...prev, `[${ts()}] ● Done — ${data.tasksRun ?? 0} tasks executed`]);
      }

      setLoopResult({ tasksRun: data.tasksRun ?? 0, error: data.error });
      setLastLoopAt(Date.now());
    } catch (err) {
      setLoopLog(prev => [...prev, `[${ts()}] ✗ ${String(err)}`]);
      setLoopResult({ tasksRun: 0, error: String(err) });
    } finally {
      setLoopRunning(false);
    }
  }, [influencer.id, accessToken]);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const newMessages = [...chatMessages, { role: "user" as const, content: text }];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    setTaskOffer(null);
    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintAddress: influencer.id, messages: newMessages }),
      });
      const data = await res.json();
      let reply: string = data.message ?? data.error ?? "Something went wrong.";
      // Extract TASK_OFFER if present
      const offerMatch = reply.match(/\[TASK_OFFER\]([\s\S]*?)\[\/TASK_OFFER\]/);
      if (offerMatch) {
        try {
          const offer = JSON.parse(offerMatch[1]);
          setTaskOffer(offer);
        } catch { /* ignore parse errors */ }
        reply = reply.replace(/\[TASK_OFFER\][\s\S]*?\[\/TASK_OFFER\]/, "").trim();
      }
      setChatMessages([...newMessages, { role: "assistant", content: reply }]);
    } catch {
      setChatMessages([...newMessages, { role: "assistant", content: "Connection error. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    loopLogRef.current?.scrollTo({ top: loopLogRef.current.scrollHeight, behavior: "smooth" });
  }, [loopLog]);

  // Heartbeat ticker — updates every second to show elapsed time
  useEffect(() => {
    const id = setInterval(() => setHeartbeatTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // The autonomy loop runs ONLY when the owner clicks "Run Now" — never
  // automatically on tab open. (Previously a useEffect fired runAutonomyLoop when
  // the Tasks tab mounted, which burned tokens without any click.)

  return (
    <div className="h-[calc(100dvh-3.5rem)] overflow-hidden bg-[#050505] text-white flex flex-col relative font-[family-name:var(--font-geist-sans)]">

      {/* ── Ethereal mesh: emerald + violet orbs glowing through OLED black ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-1/4 -left-1/4 size-[60vw] rounded-full blur-[140px] opacity-[0.16]" style={{ background: "radial-gradient(circle, #0A84FF 0%, transparent 70%)" }} />
        <div className="absolute top-1/3 -right-1/4 size-[55vw] rounded-full blur-[150px] opacity-[0.12]" style={{ background: "radial-gradient(circle, #7c3aed 0%, transparent 70%)" }} />
        <div className="absolute -bottom-1/4 left-1/4 size-[45vw] rounded-full blur-[130px] opacity-[0.08]" style={{ background: "radial-gradient(circle, #06b6d4 0%, transparent 70%)" }} />
      </div>
      {/* Film grain — fixed, pointer-events-none */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] opacity-[0.03] mix-blend-overlay" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

      {/* ── Floating glass nav island ── */}
      <div className="shrink-0 z-40 relative px-4 pt-3 pb-2">
        <div className="mx-auto w-full max-w-[1600px] flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] backdrop-blur-2xl px-2.5 py-2 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08),0_8px_40px_-12px_rgba(0,0,0,0.7)]">
          <button type="button" onClick={goBack} className="group flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-zinc-400 hover:text-white hover:bg-white/[0.05] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">
            <ArrowLeft className="size-3.5 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-x-0.5" strokeWidth={1.5} /> Back
          </button>
          <ChevronRight className="size-3 text-white/15" strokeWidth={1.5} />
          <span className="text-[13.5px] text-white font-medium tracking-tight truncate">{influencer.name}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:block text-[11.5px] font-[family-name:var(--font-geist-mono)] text-zinc-500 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 select-all">
              {influencer.id.slice(0, 8)}…{influencer.id.slice(-4)}
            </span>
            <a href={`https://explorer.solana.com/address/${influencer.id}?cluster=devnet`} target="_blank" rel="noopener noreferrer"
              className="size-7 flex items-center justify-center rounded-full text-zinc-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">
              <ExternalLink className="size-3.5" strokeWidth={1.5} />
            </a>
          </div>
        </div>
      </div>

      {/* ── Body: sidebar + main ── */}
      <div className="flex flex-1 overflow-hidden relative z-10">

        {/* ── LEFT SIDEBAR ── */}
        <aside className="w-[288px] shrink-0 border-r border-white/[0.06] bg-white/[0.015] overflow-y-auto scroll-black flex flex-col">

          {/* Invest panel — collapsible, pinned to the top of the sidebar (closed by default) */}
          <div className="px-4 py-4 border-b border-white/[0.06]">
            <button onClick={() => setInvestOpen(o => !o)} className="w-full flex items-center justify-between group">
              <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-1.5"><span className="size-1 rounded-full bg-blue-400/80" />Invest</span>
              <ChevronRight className={`size-3.5 text-zinc-600 group-hover:text-zinc-300 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${investOpen ? "rotate-90" : ""}`} strokeWidth={1.5} />
            </button>
            <AnimatePresence initial={false}>
              {investOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="pt-3 space-y-5">
                    {investEnabled()
                      ? <InvestPanel influencer={influencer} apr={apr} perShareMonthly={perShareMonthly} isProjected={isProjected} onInvested={vault.refresh} />
                      : <InvestComingSoon />}
                    <RedeemPanel influencer={influencer} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Identity — double-bezel avatar */}
          <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center gap-3.5 mb-3.5">
              <div className="relative shrink-0">
                {/* Outer shell */}
                <div className="rounded-[1.1rem] p-1 bg-white/[0.06] ring-1 ring-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]">
                  {/* Inner core */}
                  <div className="size-11 rounded-[0.75rem] overflow-hidden">
                    {influencer.avatarUrl
                      ? <img src={influencer.avatarUrl} alt={influencer.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-zinc-900 flex items-center justify-center text-[18px] font-black text-zinc-600">{influencer.name[0]}</div>
                    }
                  </div>
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-blue-400 ring-2 ring-[#050505] shadow-[0_0_8px_rgba(10,132,255,0.8)]" />
              </div>
              <div className="min-w-0">
                <p className="text-[17px] font-semibold text-white truncate leading-tight tracking-tight font-[family-name:var(--font-space)]">{influencer.name}</p>
                <p className="text-[12.5px] text-zinc-500 font-[family-name:var(--font-geist-mono)]">@{influencer.handle}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] font-medium capitalize text-zinc-300 bg-white/[0.05] border border-white/[0.08] rounded-full px-2.5 py-1">{influencer.niche}</span>
              <span className="text-[11px] font-medium text-zinc-300 bg-white/[0.05] border border-white/[0.08] rounded-full px-2.5 py-1 flex items-center gap-1"><Globe className="size-2.5" strokeWidth={1.5} />{influencer.language}</span>
              <span className="text-[11px] font-medium text-zinc-300 bg-white/[0.05] border border-white/[0.08] rounded-full px-2.5 py-1 flex items-center gap-1"><Star className="size-2.5" strokeWidth={1.5} />{influencer.archetype}</span>
            </div>
            {influencer.description && (
              <p className="text-[12.5px] text-zinc-500 leading-relaxed mt-3 line-clamp-3">{influencer.description}</p>
            )}
          </div>

          {/* Agent Wallet */}
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.2em] mb-3 flex items-center gap-1.5"><span className="size-1 rounded-full bg-blue-400/80" />Agent Wallet</p>
            {usdcIsEmpty && influencer.agentWallet && (
              <div className="flex items-center gap-1.5 mb-2 px-2 py-1.5 rounded-[0.65rem] bg-amber-500/[0.06] border border-amber-500/20">
                <AlertTriangle className="size-3 text-amber-400/70 shrink-0" />
                <p className="text-[11.5px] text-amber-400/70">Wallet unfunded</p>
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-zinc-500">USDC Available</span>
                <div className="flex items-center gap-1">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={vault.loading ? "loading" : availableUsdc.toFixed(2)}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.18 }}
                      className={`text-[14px] font-mono font-bold tabular-nums ${vault.loading ? "text-zinc-700" : availableUsdc === 0 ? "text-amber-400" : "text-white"}`}
                    >
                      {vault.loading ? "—" : `$${availableUsdc.toFixed(2)}`}
                    </motion.span>
                  </AnimatePresence>
                  <button onClick={vault.refresh} disabled={vault.loading} className="text-zinc-700 hover:text-zinc-400"><RefreshCw className={`size-2.5 ${vault.loading ? "animate-spin" : ""}`} /></button>
                </div>
              </div>
              {unsettledTab > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-zinc-500 flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" /> Pending spend
                  </span>
                  <span className="text-[13px] font-mono font-semibold tabular-nums text-amber-400" title="Cost accrued from executed tasks, not yet swept on-chain">
                    −${unsettledTab.toFixed(4)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-zinc-600">On-chain wallet</span>
                <span className="text-[12.5px] font-mono tabular-nums text-zinc-500">{vault.loading ? "—" : `$${(vault.usdc ?? 0).toFixed(2)}`}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-zinc-500">Total Profit</span>
                <span className={`text-[14px] font-mono font-bold tabular-nums ${totalProfit > 0 ? "text-blue-400" : "text-zinc-600"}`}>{fmtUsd(totalProfit)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-zinc-500">Campaigns</span>
                <span className="text-[14px] font-mono font-bold tabular-nums text-white">{approvedCount}{pendingCount > 0 && <span className="text-[11px] text-zinc-600 ml-1">+{pendingCount}</span>}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-zinc-500">Tasks</span>
                <div className="flex items-center gap-1.5">
                  {runningCount > 0 && <span className="size-1.5 rounded-full bg-blue-400 animate-pulse" />}
                  <span className={`text-[14px] font-mono font-bold tabular-nums ${runningCount > 0 ? "text-blue-400" : "text-zinc-600"}`}>{taskStats?.total ?? "—"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Share price */}
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5"><span className="size-1 rounded-full bg-blue-400/80" />Share Price</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="text-[26px] font-mono font-black text-white tabular-nums leading-none">${influencer.sharePrice.toFixed(2)}</p>
              <span className="text-[12px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-[0.65rem] px-1.5 py-0.5">{apr.toFixed(1)}% APR</span>
            </div>
            {isProjected && <p className="text-[11px] text-zinc-700 mt-1">Projected APR</p>}
          </div>

          {/* Stats 2×2 */}
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              {[
                { label: "TVL", value: influencer.tvl > 0 ? fmtUsd(influencer.tvl) : "$0", sub: "USDC locked", em: false },
                { label: "Monthly", value: influencer.monthlyEarnings > 0 ? fmtUsd(influencer.monthlyEarnings) : "$0", sub: "revenue", em: influencer.monthlyEarnings > 0 },
                { label: "Shares Sold", value: soldShares.toLocaleString(), sub: `of ${influencer.totalShares.toLocaleString()}`, em: false },
                { label: "Per Share/mo", value: `$${perShareMonthly.toFixed(4)}`, sub: "USDC", em: true },
              ].map(({ label, value, sub, em }) => (
                <div key={label}>
                  <p className="text-[11px] text-zinc-600 uppercase tracking-[0.07em] mb-0.5">{label}</p>
                  <p className={`text-[14.5px] font-mono font-bold tabular-nums leading-none ${em ? "text-blue-400" : "text-white"}`}>{value}</p>
                  <p className="text-[10.5px] text-zinc-700 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-[11px] text-zinc-700 mb-1">
                <span>{soldPct.toFixed(1)}% sold</span><span>{influencer.availableShares} avail</span>
              </div>
              <div className="h-[2px] bg-white/[0.04] rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(0.5, soldPct)}%` }} transition={{ duration: 1, ease: EASE }} className="h-full bg-blue-500 rounded-full" />
              </div>
            </div>
          </div>

          {/* Token Info — collapsible (closed by default) */}
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <button onClick={() => setTokenOpen(o => !o)} className="w-full flex items-center justify-between group">
              <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-1.5"><span className="size-1 rounded-full bg-blue-400/80" />Token Info</span>
              <ChevronRight className={`size-3.5 text-zinc-600 group-hover:text-zinc-300 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${tokenOpen ? "rotate-90" : ""}`} strokeWidth={1.5} />
            </button>
            <AnimatePresence initial={false}>
              {tokenOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1.5 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-zinc-500">Mint</span>
                      <a href={`https://explorer.solana.com/address/${influencer.id}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-mono text-zinc-400 hover:text-white flex items-center gap-1 transition-colors">
                        {influencer.id.slice(0,4)}…{influencer.id.slice(-4)} <ExternalLink className="size-2.5" strokeWidth={1.5} />
                      </a>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-zinc-500">Creator</span>
                      <span className="text-[12.5px] font-mono text-zinc-500">{influencer.creatorWallet?.slice(0,4)}…{influencer.creatorWallet?.slice(-4)}</span>
                    </div>
                    {influencer.agentWallet && (
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] text-zinc-500">Agent Wallet</span>
                        <span className="text-[12.5px] font-mono text-zinc-500">{influencer.agentWallet.slice(0,4)}…{influencer.agentWallet.slice(-4)}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Actions — island pills with button-in-button trailing icon + magnetic physics */}
          <div className="px-4 py-4 flex flex-col gap-2.5">
            <button onClick={() => setPersonaOpen(true)}
              className="group w-full flex items-center justify-between gap-1.5 pl-4 pr-1.5 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-zinc-300 hover:text-white text-[13.5px] font-medium transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]">
              Full Persona
              <span className="size-7 rounded-full bg-white/[0.08] flex items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
                <Bot className="size-3.5" strokeWidth={1.5} />
              </span>
            </button>
            <button onClick={() => setTab("campaigns")}
              className="group w-full flex items-center justify-between gap-1.5 pl-4 pr-1.5 py-1.5 rounded-full bg-blue-500/[0.12] border border-blue-400/25 text-blue-300 hover:text-blue-200 text-[13.5px] font-medium transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]">
              Scan Campaigns
              <span className="size-7 rounded-full bg-blue-400/20 flex items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105">
                <ScanSearch className="size-3.5" strokeWidth={1.5} />
              </span>
            </button>
          </div>

          {/* Social accounts — one button per connected platform, opens the profile */}
          {connectedSocials.length > 0 && (
            <div className="px-4 py-4 border-t border-white/[0.06]">
              <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.2em] mb-2.5 flex items-center gap-1.5"><span className="size-1 rounded-full bg-blue-400/80" />Socials</p>
              <div className="flex flex-col gap-1.5">
                {connectedSocials.map((s) => (
                  <a
                    key={s.id}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${s.label} profile`}
                    className="group flex items-center gap-2.5 rounded-[0.9rem] border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-zinc-300 hover:text-white hover:border-white/20 transition-all duration-300 hover:bg-white/[0.06]"
                  >
                    <PlatformBadge id={s.id} label={s.label} className="size-6 text-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-tight truncate">{s.label}</span>
                      <span className="block text-[10.5px] text-zinc-600 truncate font-[family-name:var(--font-geist-mono)]">{s.handle ? `@${s.handle}` : "Open profile"}</span>
                    </span>
                    <ExternalLink className="size-3 text-zinc-600 group-hover:text-blue-400 transition-colors" strokeWidth={1.5} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── MAIN CONTENT (right of sidebar) ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Tab bar — floating glass segmented control */}
          <div className="shrink-0 px-5 pt-3 pb-2.5 overflow-x-auto">
            <div className="inline-flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.025] p-1 backdrop-blur-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`relative px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-300 flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-full ${tab === t.id ? "text-white" : "text-zinc-500 hover:text-zinc-200"}`}>
                  {tab === t.id && (
                    <motion.span layoutId="tab-pill"
                      className="absolute inset-0 rounded-full bg-white/[0.08] ring-1 ring-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]"
                      transition={{ duration: 0.5, ease: EASE }}
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    {t.label}
                    {t.badge != null && t.badge > 0 && (
                      <span className="flex items-center gap-0.5 text-[10.5px] font-semibold text-blue-300 bg-blue-500/15 border border-blue-400/25 rounded-full px-1.5 py-0.5 leading-none">
                        <span className="size-1 rounded-full bg-blue-400 animate-pulse inline-block" />{t.badge}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable tab content — width-constrained (not full-bleed) so it
              reads as a focused profile page rather than a dashboard stretched
              edge-to-edge on wide monitors. */}
          <div className="flex-1 overflow-y-auto scroll-black">
           <div className="mx-auto w-full max-w-5xl">
            <AnimatePresence mode="wait">

              {/* Overview */}
              {tab === "overview" && (
                <motion.div key="overview"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="divide-y divide-white/[0.06]">

                  {/* Creator stats — the web2-first headline: what this agent
                      has actually MADE and how many people saw it, ahead of
                      any investor/on-chain framing below. */}
                  <section className="px-6 pt-10 pb-2">
                    <div className="grid grid-cols-2 gap-px rounded-[1.25rem] overflow-hidden bg-white/[0.05]">
                      <div className="bg-[#0a0a0c] px-6 py-7">
                        <div className="flex items-center gap-1.5 mb-3">
                          <Video className="size-3.5 text-blue-400" strokeWidth={1.5} />
                          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-[0.15em]">Videos Generated</span>
                        </div>
                        <p className="text-[36px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)] tabular-nums leading-none">
                          {totalVideosGenerated.toLocaleString()}
                        </p>
                      </div>
                      <div className="bg-[#0a0a0c] px-6 py-7">
                        <div className="flex items-center gap-1.5 mb-3">
                          <Eye className="size-3.5 text-blue-400" strokeWidth={1.5} />
                          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-[0.15em]">Total Views</span>
                        </div>
                        <p className="text-[36px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)] tabular-nums leading-none">
                          {totalViews.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Earnings chart — CoinGecko style */}
                  <section className="px-6 pt-6 pb-0">
                    {/* Top row: title + range selector */}
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-medium text-zinc-400 mb-3">
                          <span className="size-1 rounded-full bg-blue-400" /> Live Revenue
                        </span>
                        <h2 className="text-[28px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)] leading-none">Monthly Earnings</h2>
                        <p className="text-[13px] text-zinc-500 mt-1.5">Revenue flowing into agent vault</p>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {(["1W", "1M", "3M", "6M"] as const).map(r => (
                          <button key={r} onClick={() => setChartRange(r)}
                            className={`px-2.5 py-1 rounded-[0.65rem] text-[13px] font-mono font-semibold transition-all duration-150 ${
                              chartRange === r
                                ? "bg-blue-500/15 border border-blue-500/25 text-blue-400"
                                : "text-zinc-600 hover:text-zinc-400 border border-transparent"
                            }`}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Current value + change */}
                    <div className="mb-5 flex items-end gap-3">
                      <p className="text-[34px] font-mono font-black tabular-nums text-white tracking-[-0.03em] leading-none">
                        {fmtUsd(chartData[chartData.length - 1]?.earnings ?? 0)}
                      </p>
                      {(() => {
                        const first = chartData[0]?.earnings ?? 0;
                        const last = chartData[chartData.length - 1]?.earnings ?? 0;
                        const pct = first > 0 ? ((last - first) / first) * 100 : 0;
                        const up = pct >= 0;
                        return (
                          <div className="pb-1">
                            <span className={`text-[14px] font-mono font-semibold ${up ? "text-blue-400" : "text-red-400"}`}>
                              {up ? "+" : ""}{pct.toFixed(1)}%
                            </span>
                            <span className="text-[13px] text-zinc-700 ml-1.5">{chartRange}</span>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Chart */}
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={chartData} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="earningsLineG" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0A84FF" stopOpacity={0.18} />
                            <stop offset="75%" stopColor="#0A84FF" stopOpacity={0.03} />
                            <stop offset="100%" stopColor="#0A84FF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.03)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fill: "#52525b", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          orientation="right"
                          tick={{ fill: "#52525b", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={v => `$${v}`}
                          width={44}
                          domain={["auto", "auto"]}
                        />
                        <Tooltip
                          content={<ChartTip />}
                          cursor={{ stroke: "rgba(255,255,255,0.07)", strokeWidth: 1, strokeDasharray: "0" }}
                        />
                        <Area
                          type="monotone"
                          dataKey="earnings"
                          stroke="#0A84FF"
                          strokeWidth={1.5}
                          fill="url(#earningsLineG)"
                          dot={false}
                          activeDot={{ r: 3.5, fill: "#0A84FF", stroke: "#09090b", strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>

                    {/* Bottom border between chart and next section */}
                    <div className="h-px bg-white/[0.06] mt-6" />
                  </section>

                  {/* Performance grid — gap-px technique */}
                  <section className="px-6 py-8">
                    <h2 className="text-[22px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)] mb-5">Investor Metrics</h2>
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-px rounded-[1.25rem] overflow-hidden bg-white/[0.05]">
                      {[
                        { label: "Est. APR",      value: `${apr.toFixed(1)}%`,             sub: isProjected ? "niche benchmark" : "annualized",   icon: <TrendingUp className="size-3" />, accent: "text-blue-400" },
                        { label: "Monthly Yield", value: influencer.monthlyEarnings > 0 ? fmtUsd(influencer.monthlyEarnings) : "$0", sub: "agent revenue",  icon: <Sparkles className="size-3" />, accent: influencer.monthlyEarnings > 0 ? "text-blue-400" : "text-zinc-600" },
                        { label: "Total TVL",     value: influencer.tvl > 0 ? fmtUsd(influencer.tvl) : "$0", sub: "USDC locked",     icon: <Lock className="size-3" />,      accent: "text-white" },
                        { label: "Share Price",   value: `$${influencer.sharePrice.toFixed(2)}`,              sub: "current",         icon: <Coins className="size-3" />,     accent: "text-white" },
                        { label: "Break-even",    value: (() => { const b = perShareMonthly > 0 ? Math.ceil(influencer.sharePrice / perShareMonthly) : null; return b ? `${b}mo` : "—"; })(), sub: "per share", icon: <Zap className="size-3" />, accent: "text-white" },
                        { label: "Campaigns",     value: approvedCount.toString(),                            sub: "approved",        icon: <CheckCircle2 className="size-3" />, accent: "text-white" },
                        { label: "Available",     value: influencer.availableShares.toLocaleString(),        sub: `of ${influencer.totalShares.toLocaleString()}`, icon: <Activity className="size-3" />, accent: "text-zinc-300" },
                        { label: "Total Profit",  value: fmtUsd(totalProfit),                                sub: `${monthsActive}mo`, icon: <ArrowUpRight className="size-3" />, accent: totalProfit > 0 ? "text-blue-400" : "text-zinc-600" },
                      ].map(p => <StatCell key={p.label} {...p} />)}
                    </div>
                  </section>

                  {/* Risk */}
                  <section className="px-6 py-6">
                    <div className="flex gap-3 px-4 py-3.5 border border-white/[0.05] bg-white/[0.02] rounded-[1.25rem]">
                      <AlertTriangle className="size-3.5 text-zinc-600 shrink-0 mt-0.5" />
                      <p className="text-[13px] text-zinc-600 leading-relaxed">
                        <span className="text-zinc-500 font-medium">Risk Disclosure — </span>
                        AI agents may fail or stop functioning. Returns are not guaranteed. Investment value can go to zero.
                      </p>
                    </div>
                  </section>
                </motion.div>
              )}

              {/* Earnings */}
              {tab === "earnings" && (
                <motion.div key="earnings"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="divide-y divide-white/[0.06]">

                  <section className="px-6 py-8">
                    <h2 className="text-[22px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)] mb-6">Share Value Progression</h2>
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={shareValueData} margin={{ top: 4, right: 0, left: -22, bottom: 0 }}>
                        <defs>
                          <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0A84FF" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#0A84FF" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="0" stroke="rgba(255,255,255,0.03)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fill: "#3f3f46", fontSize: 10.5 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "#3f3f46", fontSize: 10.5 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} domain={["auto", "auto"]} />
                        <Tooltip content={<ChartTip />} cursor={{ stroke: "rgba(255,255,255,0.08)" }} />
                        <Area type="monotone" dataKey="price" stroke="#0A84FF" strokeWidth={1.5} fill="url(#areaG)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </section>

                  {/* Campaign earnings — Clipping + UGC. Each table renders only when
                      the agent has joined at least one campaign of that type. */}
                  <CampaignEarningsTable
                    title="Clipping Earnings"
                    icon={<Film className="size-5 text-sky-400" />}
                    rows={(submissions ?? []).filter(isClipSubmission)}
                    accent="#38bdf8"
                  />
                  <CampaignEarningsTable
                    title="UGC Earnings"
                    icon={<Video className="size-5 text-blue-400" />}
                    rows={(submissions ?? []).filter(isUgcSubmission)}
                    accent="#a3e635"
                  />

                  <section className="px-6 py-8">
                    <div className="flex items-center gap-2 mb-5">
                      <h2 className="text-[22px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)]">Yield Projections</h2>
                      <span className="text-[13px] text-zinc-600">per 1 share · ${influencer.sharePrice.toFixed(2)}</span>
                    </div>
                    <div className="rounded-[1.25rem] border border-white/[0.06] overflow-hidden">
                      <table className="w-full text-[14.5px]">
                        <thead>
                          <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                            {["Period", "Yield", "Total Value", "ROI"].map((h, i) => (
                              <th key={h} className={`py-3 px-5 font-medium text-zinc-600 text-[13px] ${i > 0 ? "text-right" : "text-left"}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[{ l: "1 Month", m: 1 }, { l: "3 Months", m: 3 }, { l: "6 Months", m: 6 }, { l: "1 Year", m: 12 }].map(({ l, m }) => {
                            const y = perShareMonthly * m;
                            const roi = influencer.sharePrice > 0 ? (y / influencer.sharePrice) * 100 : 0;
                            return (
                              <tr key={l} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015] transition-colors duration-100">
                                <td className="py-3.5 px-5 text-zinc-400">{l}</td>
                                <td className="py-3.5 px-5 text-right font-mono text-blue-400 font-semibold">+${y.toFixed(4)}</td>
                                <td className="py-3.5 px-5 text-right font-mono text-white tabular-nums">${(influencer.sharePrice + y).toFixed(4)}</td>
                                <td className={`py-3.5 px-5 text-right font-mono font-bold tabular-nums ${roi > 0 ? "text-blue-400" : "text-zinc-600"}`}>{roi.toFixed(2)}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </motion.div>
              )}

              {/* Campaigns */}
              {tab === "campaigns" && (
                <motion.div key="campaigns"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}>
                  <section className="px-6 py-8">
                    <div className="mb-6">
                      <h2 className="text-[22px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)] flex items-center gap-2 mb-1.5">
                        <ScanSearch className="size-3.5 text-zinc-600" /> Campaigns Joined
                      </h2>
                      <p className="text-[13.5px] text-zinc-600">
                        Campaigns this agent has joined and submitted to.
                      </p>
                    </div>
                    {(() => {
                      const joined = (submissions ?? []).filter((s: SubmissionRow) => s.campaign);
                      if (submissions === undefined) {
                        return <div className="py-16 flex justify-center"><Loader2 className="size-4 animate-spin text-zinc-700" /></div>;
                      }
                      if (joined.length === 0) {
                        return (
                          <div className="py-16 text-center space-y-2">
                            <ScanSearch className="size-7 text-zinc-800 mx-auto" />
                            <p className="text-[15px] text-zinc-500">No campaigns joined yet</p>
                            <p className="text-[13px] text-zinc-700">This agent hasn&apos;t joined any campaigns.</p>
                          </div>
                        );
                      }
                      return (
                        <div className="space-y-3">
                          {joined.map((sub: SubmissionRow) => (
                            <Link
                              key={sub._id}
                              href={`/stage/${sub.campaign!._id}`}
                              className="flex items-center gap-4 rounded-[1.25rem] border border-white/[0.06] bg-white/[0.02] p-4 hover:border-white/[0.12] hover:bg-white/[0.04] transition-colors duration-100"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={sub.campaign!.brandLogoUrl} alt="" className="size-11 rounded-[0.85rem] border border-white/[0.08] object-cover shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-white text-[15px] truncate">{sub.campaign!.title}</p>
                                <p className="text-[12.5px] text-zinc-600 truncate">{sub.campaign!.brandName}</p>
                              </div>
                              <div className="hidden sm:flex flex-col items-end shrink-0">
                                <p className="font-mono text-[14px] text-zinc-300 tabular-nums">${sub.campaign!.budget.toLocaleString()}</p>
                                <p className="text-[12px] text-zinc-600">
                                  {new Date(sub.campaign!.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                </p>
                              </div>
                              <StatusBadge status={sub.status} />
                              <ChevronRight className="size-4 text-zinc-700 shrink-0" />
                            </Link>
                          ))}
                        </div>
                      );
                    })()}
                  </section>
                </motion.div>
              )}

              {/* Activity */}
              {tab === "activity" && (
                <motion.div key="activity"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}>
                  <section className="px-6 py-8">
                    <div className="flex items-center gap-2 mb-5">
                      <h2 className="text-[22px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)]">Campaign Participations</h2>
                      {submissions && <span className="text-[13px] text-zinc-600">{submissions.length} total</span>}
                    </div>
                    {submissions === undefined ? (
                      <div className="py-16 flex justify-center"><Loader2 className="size-4 animate-spin text-zinc-700" /></div>
                    ) : submissions.length === 0 ? (
                      <div className="py-16 text-center space-y-2">
                        <Activity className="size-7 text-zinc-800 mx-auto" />
                        <p className="text-[15px] text-zinc-500">No campaigns yet</p>
                        <p className="text-[13px] text-zinc-700">This agent hasn&apos;t participated in any campaigns.</p>
                      </div>
                    ) : (
                      <div className="rounded-[1.25rem] border border-white/[0.06] overflow-hidden">
                        <table className="w-full text-[14.5px]">
                          <thead>
                            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                              {["Campaign", "Budget", "Deadline", "Status", "Payout"].map((h, i) => (
                                <th key={h} className={`py-3 px-5 font-medium text-zinc-600 text-[13px] ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {submissions.map((sub: SubmissionRow) => (
                              <tr key={sub._id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015] transition-colors duration-100">
                                <td className="py-3.5 px-5">
                                  {sub.campaign ? (
                                    <div className="flex items-center gap-3">
                                      <img src={sub.campaign.brandLogoUrl} alt="" className="size-6 rounded-[0.65rem] border border-white/[0.08] object-cover shrink-0" />
                                      <div>
                                        <p className="font-medium text-white text-[14.5px]">{sub.campaign.title}</p>
                                        <p className="text-[12.5px] text-zinc-600">{sub.campaign.brandName}</p>
                                      </div>
                                    </div>
                                  ) : <span className="text-zinc-700">—</span>}
                                </td>
                                <td className="py-3.5 px-5 text-right font-mono text-zinc-300 tabular-nums">{sub.campaign ? `$${sub.campaign.budget.toLocaleString()}` : "—"}</td>
                                <td className="py-3.5 px-5 text-right text-zinc-600">{sub.campaign ? new Date(sub.campaign.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
                                <td className="py-3.5 px-5 text-right"><StatusBadge status={sub.status} /></td>
                                <td className="py-3.5 px-5 text-right">
                                  {sub.payoutTxSignature ? (
                                    <a href={`https://explorer.solana.com/tx/${sub.payoutTxSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-mono text-[13px] transition-colors">
                                      {sub.payoutTxSignature.slice(0, 6)}…<ExternalLink className="size-2.5" />
                                    </a>
                                  ) : <span className="text-zinc-700">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </motion.div>
              )}

              {/* Tasks */}
              {tab === "tasks" && (
                <motion.div key="tasks"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="divide-y divide-white/[0.06]">

                  {/* ── Heartbeat header ── */}
                  <section className="px-6 py-4 bg-[#0a0a0d]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Pulse */}
                        <div className="relative flex items-center justify-center size-8">
                          {loopRunning && <span className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />}
                          <span className={`size-2.5 rounded-full ${loopRunning ? "bg-blue-400 animate-pulse" : lastLoopAt ? "bg-blue-600" : "bg-zinc-700"}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-[15px] font-bold text-white">
                              {loopRunning ? "Running…" : lastLoopAt ? "Standby" : "Idle"}
                            </p>
                            {loopRunning && <Loader2 className="size-3.5 text-blue-400 animate-spin" />}
                          </div>
                          <p className="text-[12.5px] text-zinc-600 font-mono mt-0.5">
                            {lastLoopAt
                              ? `Last run ${Math.floor((Date.now() - lastLoopAt + heartbeatTick * 0) / 1000)}s ago · next in ${Math.max(0, 300 - Math.floor((Date.now() - lastLoopAt) / 1000))}s`
                              : "Wallet check → Job scan → Content → Campaigns"
                            }
                          </p>
                        </div>
                      </div>
                      {/* Owner-only: only the agent's creator can trigger a run. */}
                      {isOwner && (
                        <button
                          onClick={runAutonomyLoop}
                          disabled={loopRunning}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[0.9rem] bg-blue-500/10 border border-blue-500/25 text-blue-400 hover:bg-blue-500/18 hover:border-blue-500/40 text-[13.5px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {loopRunning ? <><Loader2 className="size-3.5 animate-spin" /> Running</> : <><Play className="size-3.5" /> Run Now</>}
                        </button>
                      )}
                    </div>

                    {/* Terminal log */}
                    {loopLog.length > 0 && (
                      <div
                        ref={loopLogRef}
                        className="mt-3 rounded-[0.9rem] bg-black/60 border border-white/[0.06] px-3 py-2.5 h-28 overflow-y-auto font-mono"
                      >
                        {loopLog.map((line, i) => (
                          <p key={i} className={`text-[12.5px] leading-relaxed ${line.includes("✗") ? "text-red-400" : line.includes("●") ? "text-blue-400 font-bold" : line.includes("✓") ? "text-blue-300" : "text-zinc-500"}`}>
                            {line}
                          </p>
                        ))}
                        {loopRunning && (
                          <p className="text-[12.5px] text-zinc-600 animate-pulse">▌</p>
                        )}
                      </div>
                    )}
                  </section>

                  {/* ── Economic stats ── */}
                  <section className="px-6 py-4">
                    {taskStats ? (
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-px rounded-[1.25rem] overflow-hidden bg-white/[0.04]">
                        {[
                          { label: "Tasks",     value: taskStats.total.toString(),                                             accent: "text-white" },
                          { label: "Running",   value: taskStats.running.toString(),                                           accent: taskStats.running > 0 ? "text-blue-400" : "text-zinc-600" },
                          { label: "Done",      value: taskStats.succeeded.toString(),                                         accent: taskStats.succeeded > 0 ? "text-blue-400" : "text-zinc-600" },
                          { label: "Failed",    value: taskStats.failed.toString(),                                            accent: taskStats.failed > 0 ? "text-red-400" : "text-zinc-600" },
                          { label: "Revenue",   value: `$${taskStats.totalRevenue.toFixed(2)}`,                                accent: taskStats.totalRevenue > 0 ? "text-blue-400" : "text-zinc-600" },
                          { label: "Net P&L",   value: `$${(taskStats.totalRevenue - taskStats.totalCost).toFixed(2)}`,        accent: taskStats.totalRevenue >= taskStats.totalCost ? "text-blue-400" : "text-red-400" },
                        ].map(({ label, value, accent }) => (
                          <div key={label} className="bg-[#0d0e12] px-3 py-3">
                            <p className="text-[11px] text-zinc-600 uppercase tracking-[0.08em] mb-1">{label}</p>
                            <p className={`text-[18px] font-mono font-black tabular-nums ${accent}`}>{value}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex justify-center py-4"><Loader2 className="size-4 animate-spin text-zinc-700" /></div>
                    )}
                  </section>

                  {/* ── Live tasks ── */}
                  {tasks && tasks.filter((t: TaskRowData) => t.status === "running" || t.status === "pending" || t.status === "awaiting_approval").length > 0 && (
                    <section className="px-6 py-4">
                      <h2 className="text-[13px] font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <span className="size-1.5 rounded-full bg-blue-400 animate-pulse inline-block" /> Live
                      </h2>
                      <div className="space-y-2">
                        {tasks.filter((t: TaskRowData) => t.status === "running" || t.status === "pending" || t.status === "awaiting_approval").map((task: TaskRowData) => (
                          <TaskRow key={task._id} task={task} />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* ── History ── */}
                  <section className="px-6 py-5">
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-[19px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)]">Task History</h2>
                      {tasks && <span className="text-[13px] text-zinc-600">{tasks.length} total</span>}
                    </div>
                    {tasks === undefined ? (
                      <div className="py-12 flex justify-center"><Loader2 className="size-4 animate-spin text-zinc-700" /></div>
                    ) : tasks.length === 0 ? (
                      <div className="py-16 text-center space-y-3">
                        <div className="size-10 rounded-[1.25rem] bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto">
                          <Bot className="size-5 text-zinc-700" />
                        </div>
                        <p className="text-[14.5px] text-zinc-500">No tasks yet</p>
                        <p className="text-[13px] text-zinc-700">Fund the agent wallet to start executing tasks.</p>
                      </div>
                    ) : (
                      <div className="rounded-[1.25rem] border border-white/[0.06] overflow-hidden">
                        <table className="w-full text-[14.5px]">
                          <thead>
                            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                              {["Task", "Type", "Cost", "Revenue", "Started", "Status"].map((h, i) => (
                                <th key={h} className={`py-3 px-5 font-medium text-zinc-600 text-[13px] ${i === 0 || i === 1 ? "text-left" : "text-right"}`}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(sortedTasks ?? tasks).map((task: TaskRowData) => (
                              <tr key={task._id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.015] transition-colors duration-100">
                                <td className="py-3.5 px-5 max-w-[200px]">
                                  <p className="font-medium text-white leading-tight truncate">{task.title}</p>
                                  {task.errorMessage && <p className="text-[12px] text-red-400 mt-0.5 truncate">{task.errorMessage}</p>}
                                  {task.triggeredBy && <p className="text-[11.5px] text-zinc-700 mt-0.5">via {task.triggeredBy}</p>}
                                </td>
                                <td className="py-3.5 px-5">
                                  <span className="inline-flex items-center gap-1 text-[12px] font-mono text-zinc-600 bg-white/[0.03] border border-white/[0.06] rounded-[0.65rem] px-1.5 py-0.5 whitespace-nowrap">
                                    {TASK_TYPE_ICONS[task.type] ?? <Activity className="size-2.5" />}
                                    {task.type.replace(/_/g, " ")}
                                  </span>
                                </td>
                                <td className="py-3.5 px-5 text-right font-mono text-zinc-600 tabular-nums">{task.cost != null ? `$${task.cost.toFixed(4)}` : "—"}</td>
                                <td className={`py-3.5 px-5 text-right font-mono tabular-nums ${(task.revenue ?? 0) > 0 ? "text-blue-400 font-semibold" : "text-zinc-600"}`}>
                                  {task.revenue != null ? `+$${task.revenue.toFixed(4)}` : "—"}
                                </td>
                                <td className="py-3.5 px-5 text-right text-zinc-600 text-[13px] tabular-nums">
                                  {task.startedAt ? taskTimeAgo(task.startedAt) : "—"}
                                </td>
                                <td className="py-3.5 px-5 text-right"><TaskStatusBadge status={task.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </motion.div>
              )}

              {/* Generations */}
              {tab === "generations" && (
                <motion.div key="generations"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="flex flex-col h-full"
                >
                  {/* Terminal header */}
                  <div className="px-6 py-3 border-b border-white/[0.06] bg-[#0a0a0d] flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
                      <span className="text-[13px] font-mono text-zinc-500">{influencer.name.toLowerCase().replace(/\s+/g, "_")}@vello:~$ generations</span>
                    </div>
                    <span className="text-[12px] font-mono text-zinc-700">{generations?.length ?? 0} artifacts</span>
                  </div>

                  {/* Terminal feed */}
                  <div className="flex-1 overflow-y-auto bg-[#080a0d] font-mono">
                    {generations === undefined && (
                      <div className="px-6 py-4 text-[13px] text-zinc-600 animate-pulse">Loading generations…</div>
                    )}
                    {generations?.length === 0 && (
                      <div className="px-6 py-8 text-center">
                        <p className="text-[13px] text-zinc-700 font-mono">No generations yet. Run the autonomy loop to produce content.</p>
                      </div>
                    )}
                    {generations?.map((task: GenerationRow, i: number) => {
                      let parsed: Record<string, unknown> = {};
                      try { parsed = JSON.parse(task.output ?? "{}"); } catch {}

                      const isVideo = task.type === "create_video";
                      const isPost = task.type === "post_content";
                      const isTrend = task.type === "analyze_trend";
                      const isWallet = task.type === "check_wallet";
                      const isJobs = task.type === "find_jobs";
                      const isResearch = task.type === "research";
                      const isCampaign = task.type === "campaign_submit";

                      // Format timestamp
                      const ts = task.completedAt ?? task.startedAt ?? task._creationTime;
                      const timeStr = new Date(ts).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

                      // Color per type
                      const typeColor = isVideo ? "text-violet-400" : isPost ? "text-sky-400" : isTrend ? "text-amber-400" : isWallet ? "text-blue-400" : isJobs ? "text-cyan-400" : isResearch ? "text-fuchsia-400" : "text-zinc-400";

                      // Extract meaningful output
                      const script = parsed.script ?? parsed.summary ?? parsed.content;
                      const decision = parsed.decision;
                      const walletData = parsed.walletData as { usdc: number; sol: number } | undefined;
                      const campaigns = parsed.campaigns as Array<{ title: string; brandName: string; budget: number }> | undefined;

                      return (
                        <div key={task._id} className={`border-b border-white/[0.03] px-6 py-4 hover:bg-white/[0.015] transition-colors ${i === 0 ? "bg-white/[0.02]" : ""}`}>
                          {/* Header line */}
                          <div className="flex items-start gap-3 mb-2">
                            <span className="text-[11.5px] text-zinc-700 shrink-0 mt-0.5 tabular-nums w-36">[{timeStr}]</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[12px] font-bold uppercase tracking-wider ${typeColor}`}>{task.type.replace(/_/g, "_")}</span>
                                <span className="text-[13px] text-white font-semibold truncate">{task.title}</span>
                              </div>
                              {(task.cost != null || task.revenue != null) && (
                                <div className="flex items-center gap-3 mt-1">
                                  {task.cost != null && task.cost > 0 && <span className="text-[11.5px] text-red-400 font-mono">-${task.cost.toFixed(3)}</span>}
                                  {task.revenue != null && task.revenue > 0 && <span className="text-[11.5px] text-blue-400 font-mono">+${task.revenue.toFixed(3)}</span>}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Content specific to type */}
                          <div className="ml-[9.5rem] space-y-2">
                            {isVideo && typeof script === "object" && script !== null && (
                              <div className="space-y-1.5">
                                {"hook" in (script as object) && (
                                  <div className="rounded-[0.65rem] bg-violet-500/[0.08] border border-violet-500/[0.15] px-3 py-2">
                                    <p className="text-[11px] text-violet-400 uppercase tracking-widest mb-1">Hook</p>
                                    <p className="text-[13.5px] text-white leading-relaxed">{String((script as Record<string, unknown>).hook)}</p>
                                  </div>
                                )}
                                {"script" in (script as object) && (
                                  <div className="rounded-[0.65rem] bg-black/40 border border-white/[0.06] px-3 py-2 max-h-24 overflow-y-auto">
                                    <p className="text-[11px] text-zinc-600 uppercase tracking-widest mb-1">Script</p>
                                    <p className="text-[12.5px] text-zinc-300 leading-relaxed whitespace-pre-wrap">{String((script as Record<string, unknown>).script).slice(0, 400)}</p>
                                  </div>
                                )}
                                {"caption" in (script as object) && (
                                  <p className="text-[12.5px] text-sky-300 italic">&ldquo;{String((script as Record<string, unknown>).caption).slice(0, 120)}&rdquo;</p>
                                )}
                                {"estimated_views_low" in (script as object) && (
                                  <p className="text-[11.5px] text-zinc-600">Est. views: {(script as Record<string, number | undefined>).estimated_views_low?.toLocaleString()}–{(script as Record<string, number | undefined>).estimated_views_high?.toLocaleString()}</p>
                                )}
                              </div>
                            )}

                            {isPost && (
                              <div className="rounded-[0.65rem] bg-sky-500/[0.06] border border-sky-500/[0.12] px-3 py-2">
                                <p className="text-[11px] text-sky-400 uppercase tracking-widest mb-1">Published · {String(parsed.platform ?? "platform")}</p>
                                <p className="text-[13px] text-zinc-200 leading-relaxed">{String(parsed.content ?? parsed.text ?? "Post submitted")}</p>
                              </div>
                            )}

                            {isTrend && typeof parsed.result === "object" && parsed.result !== null && (
                              <div className="rounded-[0.65rem] bg-amber-500/[0.06] border border-amber-500/[0.12] px-3 py-2">
                                <p className="text-[11px] text-amber-400 uppercase tracking-widest mb-1">Trend Analysis</p>
                                <p className="text-[12.5px] text-zinc-300 leading-relaxed line-clamp-4">
                                  {typeof (parsed.result as Record<string, unknown>)?.summary === "string"
                                    ? String((parsed.result as Record<string, unknown>).summary)
                                    : JSON.stringify(parsed.result).slice(0, 300)}
                                </p>
                              </div>
                            )}

                            {isWallet && walletData && (
                              <div className="rounded-[0.65rem] bg-blue-500/[0.06] border border-blue-500/[0.12] px-3 py-2">
                                <div className="flex items-center gap-4 mb-2">
                                  <div><p className="text-[11px] text-zinc-600">USDC</p><p className="text-[15px] font-mono font-bold text-white">${walletData.usdc.toFixed(2)}</p></div>
                                  <div><p className="text-[11px] text-zinc-600">SOL</p><p className="text-[15px] font-mono font-bold text-white">{walletData.sol.toFixed(4)}</p></div>
                                  {typeof decision === "object" && decision !== null && "status" in decision && (
                                    <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-[0.65rem] ${String((decision as Record<string, unknown>).status) === "healthy" ? "bg-blue-500/20 text-blue-400" : String((decision as Record<string, unknown>).status) === "low" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
                                      {String((decision as Record<string, unknown>).status)}
                                    </span>
                                  )}
                                </div>
                                {typeof decision === "object" && decision !== null && "message" in decision && (
                                  <p className="text-[12.5px] text-zinc-400 italic">&ldquo;{String((decision as Record<string, unknown>).message)}&rdquo;</p>
                                )}
                              </div>
                            )}

                            {isJobs && campaigns && (
                              <div className="space-y-1">
                                {campaigns.slice(0, 4).map((c, ci) => (
                                  <div key={ci} className="flex items-center justify-between text-[12.5px] bg-cyan-500/[0.04] border border-cyan-500/[0.1] rounded-[0.65rem] px-2.5 py-1.5">
                                    <span className="text-zinc-200 truncate mr-2">{c.title}</span>
                                    <span className="text-blue-400 font-mono shrink-0">${c.budget}</span>
                                  </div>
                                ))}
                                {typeof decision === "object" && decision !== null && "strategy" in decision && (
                                  <p className="text-[12px] text-zinc-500 italic mt-1">Strategy: {String((decision as Record<string, unknown>).strategy)}</p>
                                )}
                              </div>
                            )}

                            {isResearch && (
                              <div className="rounded-[0.65rem] bg-fuchsia-500/[0.05] border border-fuchsia-500/[0.1] px-3 py-2">
                                <p className="text-[12.5px] text-zinc-300 leading-relaxed line-clamp-4">
                                  {typeof parsed.answer === "string" ? parsed.answer : typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed).slice(0, 300)}
                                </p>
                              </div>
                            )}

                            {isCampaign && (
                              <div className="rounded-[0.65rem] bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                                <p className="text-[11px] text-zinc-600 uppercase tracking-widest mb-1">Submission</p>
                                <p className="text-[12.5px] text-zinc-300">{typeof parsed.submittedContent === "string" ? parsed.submittedContent.slice(0, 200) : "Campaign submission processed"}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Photos — full avatar set: GIF + generated poses + character grid */}
              {tab === "photos" && (
                <motion.div key="photos"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}
                >
                  <PhotosGrid photos={profileImages} agentName={influencer.name} />
                </motion.div>
              )}

              {/* Knowledge */}
              {tab === "knowledge" && (
                <motion.div key="knowledge"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="divide-y divide-white/[0.06]"
                >
                  {/* Stats bar */}
                  <section className="px-6 py-5 grid grid-cols-3 gap-px bg-white/[0.04] rounded-[1.25rem] overflow-hidden mx-6 mt-6">
                    {[
                      { label: "Knowledge Entries", value: knowledgeEntries?.length ?? "—" },
                      { label: "Categories", value: knowledgeEntries ? [...new Set(knowledgeEntries.map((e: KnowledgeRow) => e.category))].length : "—" },
                      { label: "Memories", value: memories?.length ?? "—" },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-[#09090b] px-5 py-4">
                        <p className="text-[11.5px] text-zinc-600 uppercase tracking-[0.08em] mb-1">{label}</p>
                        <p className="text-[26px] font-mono font-black text-white tabular-nums">{value}</p>
                      </div>
                    ))}
                  </section>

                  {/* Capabilities derived from task types */}
                  <section className="px-6 py-6">
                    <h2 className="text-[19px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)] mb-4 flex items-center gap-2">
                      <Sparkles className="size-3.5 text-blue-400" /> Capabilities
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {([
                        ...(tasks ? [...new Set(tasks.map((t: TaskRowData) => t.type.replace(/_/g, " ")))] : []),
                        ...(knowledgeEntries ? [...new Set(knowledgeEntries.map((e: KnowledgeRow) => e.category))] : []),
                      ] as string[]).slice(0, 16).map((cap: string) => (
                        <span key={cap} className="px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[13px] text-zinc-300 capitalize">{cap}</span>
                      ))}
                      {(!tasks || tasks.length === 0) && (!knowledgeEntries || knowledgeEntries.length === 0) && (
                        <p className="text-[14px] text-zinc-600">No capabilities recorded yet</p>
                      )}
                    </div>
                  </section>

                  {/* Knowledge entries grouped by category */}
                  <section className="px-6 py-6">
                    <h2 className="text-[19px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)] mb-4 flex items-center gap-2">
                      <BookOpen className="size-3.5 text-sky-400" /> Knowledge Base
                    </h2>
                    {knowledgeEntries === undefined ? (
                      <div className="py-8 flex justify-center"><Loader2 className="size-4 animate-spin text-zinc-700" /></div>
                    ) : knowledgeEntries.length === 0 ? (
                      <p className="text-[14px] text-zinc-600 py-4">No knowledge uploaded yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {knowledgeEntries.slice(0, 20).map((entry: KnowledgeRow) => (
                          <div key={entry._id} className="rounded-[1.25rem] border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[12px] font-semibold text-sky-400 uppercase tracking-wide">{entry.category}</span>
                              {entry.tags.slice(0, 3).map((tag: string) => (
                                <span key={tag} className="text-[11px] bg-zinc-800 text-zinc-500 rounded-[0.65rem] px-1.5 py-0.5">{tag}</span>
                              ))}
                            </div>
                            <p className="text-[14.5px] font-semibold text-white leading-snug">{entry.title}</p>
                            <p className="text-[13px] text-zinc-500 mt-1 line-clamp-2 leading-relaxed">{entry.content.slice(0, 200)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Episodic memories */}
                  <section className="px-6 py-6">
                    <h2 className="text-[19px] font-semibold text-white tracking-tight font-[family-name:var(--font-space)] mb-4 flex items-center gap-2">
                      <MessageSquare className="size-3.5 text-fuchsia-400" /> Memory
                    </h2>
                    {memories === undefined ? (
                      <div className="py-8 flex justify-center"><Loader2 className="size-4 animate-spin text-zinc-700" /></div>
                    ) : memories.length === 0 ? (
                      <p className="text-[14px] text-zinc-600 py-4">No episodic memories yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {memories.map((mem: MemoryRow) => (
                          <div key={mem._id} className="flex items-start gap-3 rounded-[1.25rem] border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-[14px] text-zinc-200 leading-snug">{mem.summary}</p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[11px] text-zinc-600 capitalize bg-zinc-800 border border-zinc-700 rounded-[0.65rem] px-1.5 py-0.5">{mem.kind}</span>
                                <span className="text-[11px] text-zinc-700">importance {mem.importance}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </motion.div>
              )}

              {/* Chat */}
              {tab === "chat" && (
                <motion.div key="chat"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="flex flex-col h-full min-h-0"
                >
                  {/* Messages area */}
                  <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
                    {chatMessages.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-20">
                        <div className="size-16 rounded-[1.75rem] overflow-hidden border border-white/10">
                          {influencer.avatarUrl ? (
                            <img src={influencer.avatarUrl} alt={influencer.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center">
                              <span className="text-[26px] font-black text-white/40">{influencer.name[0]}</span>
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-[17px] font-bold text-white">{influencer.name}</p>
                          <p className="text-[14px] text-zinc-500 mt-1">@{influencer.handle} · {influencer.niche}</p>
                        </div>
                        <p className="text-[14.5px] text-zinc-500 max-w-sm">
                          Chat with {influencer.name}. You can ask her to create content, collaborate on campaigns, or perform tasks — she&apos;ll quote a price.
                        </p>
                        {/* Starter prompts */}
                        <div className="flex flex-wrap gap-2 justify-center mt-2">
                          {[
                            `Make a 30s product video for my brand`,
                            `Write an Instagram caption for my launch`,
                            `What can you create for me?`,
                            `Create a campaign strategy`,
                          ].map(s => (
                            <button key={s} onClick={() => setChatInput(s)}
                              className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[13.5px] text-zinc-400 hover:text-white hover:border-white/20 transition-all">
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        {msg.role === "assistant" && (
                          <div className="size-7 rounded-full overflow-hidden shrink-0 mt-0.5 border border-white/10">
                            {influencer.avatarUrl ? (
                              <img src={influencer.avatarUrl} alt={influencer.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-zinc-800 flex items-center justify-center text-[12px] font-bold text-white">{influencer.name[0]}</div>
                            )}
                          </div>
                        )}
                        <div className={`max-w-[75%] rounded-[1.75rem] px-4 py-2.5 text-[15px] leading-relaxed ${
                          msg.role === "user"
                            ? "bg-blue-600/20 border border-blue-500/25 text-white rounded-br-sm"
                            : "bg-white/[0.05] border border-white/[0.08] text-zinc-200 rounded-bl-sm"
                        }`}>
                          {msg.content}
                        </div>
                      </div>
                    ))}

                    {chatLoading && (
                      <div className="flex gap-3 justify-start">
                        <div className="size-7 rounded-full overflow-hidden shrink-0 mt-0.5 border border-white/10">
                          {influencer.avatarUrl ? (
                            <img src={influencer.avatarUrl} alt={influencer.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-zinc-800 flex items-center justify-center text-[12px] font-bold text-white">{influencer.name[0]}</div>
                          )}
                        </div>
                        <div className="bg-white/[0.05] border border-white/[0.08] rounded-[1.75rem] rounded-bl-sm px-4 py-3 flex items-center gap-1">
                          <span className="size-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="size-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="size-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    )}

                    {/* Task offer card */}
                    {taskOffer && !chatLoading && (
                      <div className="mx-auto max-w-sm rounded-[1.75rem] border border-blue-500/25 bg-blue-500/[0.06] p-5 space-y-3">
                        <div className="flex items-center gap-2">
                          <CreditCard className="size-4 text-blue-400 shrink-0" />
                          <p className="text-[15px] font-bold text-white">{taskOffer.title}</p>
                        </div>
                        <p className="text-[13.5px] text-zinc-400 leading-relaxed">{taskOffer.description}</p>
                        {taskOffer.deliverables?.length > 0 && (
                          <ul className="space-y-1">
                            {taskOffer.deliverables.map((d, i) => (
                              <li key={i} className="flex items-center gap-2 text-[13px] text-zinc-300">
                                <CheckCircle className="size-3 text-blue-400 shrink-0" />{d}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                          <div>
                            <p className="text-[26px] font-mono font-black text-blue-400">${taskOffer.price}</p>
                            <p className="text-[12px] text-zinc-600">{taskOffer.currency} · ~{taskOffer.estimatedHours}h</p>
                          </div>
                          <button
                            onClick={() => {
                              setChatMessages(m => [...m, { role: "user", content: `I'd like to pay $${taskOffer!.price} USDC to proceed with "${taskOffer!.title}".` }]);
                              setTaskOffer(null);
                            }}
                            className="px-5 py-2.5 rounded-[1.25rem] font-bold text-[15px] text-white"
                            style={{ background: "#65c000", boxShadow: "0 3px 0 #3d7a00" }}
                          >
                            Pay ${taskOffer.price} USDC
                          </button>
                        </div>
                      </div>
                    )}

                    <div ref={chatEndRef} />
                  </div>

                  {/* Input bar */}
                  <div className="px-6 py-4 border-t border-white/[0.06] bg-[#09090b]">
                    <div className="flex gap-3 items-end">
                      <div className="flex-1 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] focus-within:border-white/20 transition-colors px-4 py-3">
                        <textarea
                          value={chatInput}
                          onChange={e => setChatInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                          placeholder={`Message ${influencer.name}…`}
                          rows={1}
                          className="w-full bg-transparent text-[15.5px] text-zinc-200 placeholder:text-zinc-600 resize-none outline-none leading-relaxed max-h-28"
                        />
                      </div>
                      <button
                        onClick={sendChat}
                        disabled={!chatInput.trim() || chatLoading}
                        className="size-10 rounded-[1.25rem] flex items-center justify-center transition-all disabled:opacity-30"
                        style={{ background: chatInput.trim() && !chatLoading ? "#65c000" : undefined, backgroundColor: !chatInput.trim() || chatLoading ? "rgb(39 39 42)" : undefined }}
                      >
                        <Send className="size-4 text-white" />
                      </button>
                    </div>
                    <p className="text-[12px] text-zinc-700 mt-2 text-center">
                      Responses use {influencer.name}&apos;s persona and knowledge base · Payments processed via USDC
                    </p>
                  </div>
                </motion.div>
              )}

              {tab === "creations" && (
                <motion.div key="creations"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  className="p-6"
                >
                  <CreationsGrid creations={creations ?? []} agentName={influencer.name} />
                </motion.div>
              )}

            </AnimatePresence>
           </div>
          </div>
        </div>
      </div>

      <PersonaModal influencer={influencer} open={personaOpen} onClose={() => setPersonaOpen(false)} />
    </div>
  );
}
