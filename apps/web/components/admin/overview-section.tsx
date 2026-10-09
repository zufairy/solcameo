"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Landmark, ExternalLink } from "lucide-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from "@solana/spl-token";
import { getRpcUrl, getUsdcMint, getAccountExplorerUrl, getNetworkLabel } from "@/lib/solana/network";
import { fmtUsd } from "./util";
import { Dot, LimeHero, LimeLayout, LimeTile } from "./lime-panels";
import { summarizeUsers, type OverviewRow } from "./users-overview";

const USDC_DECIMALS = 6;


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

/** The platform treasury: live on-chain balance of the official wallet, in the same lime as the other tiles. */
function TreasuryTile() {
  const bal = useTreasuryBalance();
  return (
    <div className="rounded-2xl bg-[#e4ff59] p-5 text-[#10140a]">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#10140a]/60">
        <Landmark className="size-3.5" />Treasury
        <span className="ml-auto inline-flex items-center gap-1" title={`Live on-chain · ${getNetworkLabel()}`}><span className="size-1.5 animate-pulse rounded-full bg-[#10140a]" />Live</span>
      </p>
      <p className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{!TREASURY ? "—" : bal === null ? "…" : fmtUsd(bal.usdc)}</p>
      <p className="mt-2 flex items-center justify-between gap-1 text-[12px] font-medium text-[#10140a]/65">
        <span className="tabular-nums">{bal === null ? "USDC" : `${bal.sol.toFixed(3)} SOL`}</span>
        {TREASURY ? (
          <a href={getAccountExplorerUrl(TREASURY)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-mono hover:text-black" title="View treasury wallet on Solana explorer">
            {TREASURY.slice(0, 4)}…{TREASURY.slice(-4)}<ExternalLink className="size-2.5" />
          </a>
        ) : <span>wallet unset</span>}
      </p>
    </div>
  );
}

const nf = (n: number) => n.toLocaleString("en-US");

/** Admin home, trimmed to what this app runs on: people, influencers, videos, campaigns and the treasury. */
export function OverviewSection() {
  const { accessToken } = useSupabaseAuth();
  const agents = useQuery(api.influencers.listAll) ?? [];
  const campaigns = useQuery(api.campaigns.list) ?? [];
  const listUsers = useAction(api.admin.listUsers);
  const [users, setUsers] = useState<OverviewRow[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!accessToken) return;
    listUsers({ accessToken }).then((rows) => { setUsers(rows as OverviewRow[]); setNow(Date.now()); }).catch(() => setUsers(null));
  }, [accessToken, listUsers]);

  const s = useMemo(() => summarizeUsers(users ?? [], now), [users, now]);
  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;
  const loading = users === null;
  const bars = s.daily.map((d) => ({ key: d.from, label: new Date(d.from).toLocaleDateString("en-US", { month: "short", day: "numeric" }), count: d.count }));
  const trend = s.weekChange === null ? null : `${s.weekChange >= 0 ? "+" : ""}${s.weekChange}% vs last week`;

  return (
    <LimeLayout label="Platform overview" hero={
      <LimeHero label="Total users" value={loading ? "…" : nf(s.total)} bars={bars} barsCaption={`New users per day · ${nf(s.thisMonth)} this month`}
        line={<><span>+{nf(s.thisWeek)} this week</span><Dot /><span>+{nf(s.today)} today</span>{trend && <><Dot /><span>{trend}</span></>}</>} />
    }>
      <LimeTile label="Online now" value={loading ? "…" : nf(s.online)} note={`${nf(s.active24h)} active in 24h`} />
      <LimeTile label="Active this week" value={loading ? "…" : nf(s.active7d)} note={s.total ? `${Math.round((s.active7d / s.total) * 100)}% of users` : undefined} />
      <LimeTile label="Influencers" value={nf(agents.length)} note={loading ? undefined : `${nf(s.creators)} creators`} />
      <LimeTile label="Videos posted" value={loading ? "…" : nf(s.clipsPosted)} note={loading ? undefined : `${nf(s.clipsProduced)} produced`} />
      <LimeTile label="Campaigns" value={nf(activeCampaigns)} note={`of ${nf(campaigns.length)} total`} />
      <TreasuryTile />
    </LimeLayout>
  );
}
