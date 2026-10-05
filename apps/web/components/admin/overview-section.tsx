"use client";

import { useEffect, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Coins, TrendingUp, Cpu, Briefcase, Users, Landmark, ExternalLink } from "lucide-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from "@solana/spl-token";
import { getRpcUrl, getUsdcMint, getAccountExplorerUrl, getNetworkLabel } from "@/lib/solana/network";
import { fmtUsd } from "./util";

const USDC_DECIMALS = 6;

type AdminUserRow = FunctionReturnType<typeof api.admin.listUsers>[number];
type AgentRow = FunctionReturnType<typeof api.influencers.listAll>[number];
type CampaignRow = FunctionReturnType<typeof api.campaigns.list>[number];

// The official Vello platform treasury wallet — receives agent service-fee sweeps
// and escrow protocol fees. Public env so the balance can be read client-side.
const TREASURY = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET?.trim() ?? "";

/** USDC mint for the active cluster (honors a NEXT_PUBLIC_USDC_MINT override). */
function usdcMint(): PublicKey {
  const override = process.env.NEXT_PUBLIC_USDC_MINT?.trim();
  return new PublicKey(override && override.length > 0 ? override : getUsdcMint());
}

/**
 * Classify a USDC token-account read failure (H13/BUG-036): a genuinely
 * missing/never-created ATA is a real `0`; anything else (RPC 429/timeout/
 * socket drop on the same Helius/public RPC this app documents as
 * rate-limit-prone) is UNKNOWN and must NOT be treated as 0 — the false-zero
 * class this app hardened against elsewhere (getUsdcBalanceStrict in
 * lib/trader/usdcTransfer.ts, useWalletUsdc in lib/client/usdcClient.ts).
 */
export function classifyUsdcReadError(e: unknown): 0 | undefined {
  return e instanceof TokenAccountNotFoundError ? 0 : undefined;
}

/**
 * Merge one poll's result into the treasury balance state. `usdcRead ===
 * undefined` means the USDC leg's read failed/is unknown — keep the LAST
 * known usdc value (or null if there isn't one yet) instead of overwriting it
 * with a confident 0. A real read — including a genuine empty-account 0 —
 * always replaces the previous value.
 */
export function nextTreasuryBalance(
  prev: { usdc: number | null; sol: number } | null,
  usdcRead: number | undefined,
  lamports: number,
): { usdc: number | null; sol: number } {
  return { usdc: usdcRead === undefined ? prev?.usdc ?? null : usdcRead, sol: lamports / 1e9 };
}

/** Live on-chain USDC + SOL balance of the treasury wallet, polled every 25s. */
function useTreasuryBalance() {
  const [bal, setBal] = useState<{ usdc: number | null; sol: number } | null>(null);
  useEffect(() => {
    if (!TREASURY) return;
    let alive = true;
    let owner: PublicKey;
    try { owner = new PublicKey(TREASURY); } catch { return; }
    const load = async () => {
      try {
        const conn = new Connection(getRpcUrl(), "confirmed");
        const ata = await getAssociatedTokenAddress(usdcMint(), owner, true);
        const [lamports, usdcRead] = await Promise.all([
          conn.getBalance(owner, "confirmed"),
          getAccount(conn, ata, "confirmed")
            .then((acc) => Number(acc.amount) / 10 ** USDC_DECIMALS)
            .catch(classifyUsdcReadError),
        ]);
        if (alive) setBal((prev) => nextTreasuryBalance(prev, usdcRead, lamports));
      } catch {
        /* keep last known balance on a transient RPC error */
      }
    };
    void load();
    const id = setInterval(() => void load(), 25_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return bal;
}

function Kpi({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub: string; accent: string;
}) {
  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] px-5 py-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-zinc-600 text-[10px] uppercase tracking-widest">
        {icon}<span>{label}</span>
      </div>
      <p className={`text-[22px] font-mono font-black tabular-nums tracking-tight leading-none ${accent}`}>{value}</p>
      <p className="text-[10.5px] text-zinc-700">{sub}</p>
    </div>
  );
}

/** The Vello Treasury KPI — live on-chain balance of the official platform wallet. */
function TreasuryKpi() {
  const bal = useTreasuryBalance();
  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] px-5 py-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-zinc-600 text-[10px] uppercase tracking-widest">
        <Landmark className="size-3" /><span>Vello Treasury</span>
        <span className="ml-auto inline-flex items-center gap-1 text-emerald-500/80" title={`Live on-chain · ${getNetworkLabel()}`}>
          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </span>
      </div>
      <p className="text-[22px] font-mono font-black tabular-nums tracking-tight leading-none text-emerald-400">
        {!TREASURY ? "—" : bal === null ? "…" : fmtUsd(bal.usdc)}
      </p>
      <div className="flex items-center justify-between gap-1 text-[10.5px] text-zinc-700">
        <span className="tabular-nums">{bal === null ? "USDC" : `${bal.sol.toFixed(3)} SOL`}</span>
        {TREASURY ? (
          <a
            href={getAccountExplorerUrl(TREASURY)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-mono hover:text-zinc-400 transition-colors"
            title="View treasury wallet on Solana explorer"
          >
            {TREASURY.slice(0, 4)}…{TREASURY.slice(-4)}<ExternalLink className="size-2.5" />
          </a>
        ) : (
          <span className="text-rose-500">wallet unset</span>
        )}
      </div>
    </div>
  );
}

export function OverviewSection() {
  const { accessToken } = useSupabaseAuth();
  const agents = useQuery(api.influencers.listAll) ?? [];
  const campaigns = useQuery(api.campaigns.list) ?? [];
  const listUsers = useAction(api.admin.listUsers);
  const [userStats, setUserStats] = useState<{ total: number; admins: number } | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    listUsers({ accessToken })
      .then((us) =>
        setUserStats({
          total: us.length,
          admins: us.filter((u: AdminUserRow) => u.isAdmin).length,
        }),
      )
      .catch(() => setUserStats(null));
  }, [accessToken, listUsers]);

  const totalTvl = agents.reduce((s: number, a: AgentRow) => s + a.tvl, 0);
  const totalMonthly = agents.reduce((s: number, a: AgentRow) => s + a.monthlyEarnings, 0);
  const activeCampaigns = campaigns.filter((c: CampaignRow) => c.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={<Users className="size-3" />} label="Users" value={userStats ? userStats.total.toString() : "…"} sub={userStats ? `${userStats.admins} admin${userStats.admins === 1 ? "" : "s"}` : "loading"} accent="text-white" />
        <Kpi icon={<Coins className="size-3" />} label="Total TVL" value={fmtUsd(totalTvl)} sub="USDC locked" accent="text-emerald-400" />
        <Kpi icon={<TrendingUp className="size-3" />} label="Monthly" value={fmtUsd(totalMonthly)} sub="across agents" accent="text-emerald-300" />
        <Kpi icon={<Cpu className="size-3" />} label="Agents" value={agents.length.toString()} sub="minted" accent="text-violet-400" />
        <Kpi icon={<Briefcase className="size-3" />} label="Campaigns" value={activeCampaigns.toString()} sub={`of ${campaigns.length} total`} accent="text-sky-400" />
        <TreasuryKpi />
      </div>
    </div>
  );
}
