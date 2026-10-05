"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getTxExplorerUrl, getAccountExplorerUrl, getNetworkLabel } from "@/lib/solana/network";
import type { UsdcTransfer } from "@/lib/solana/usdcTransfers";
import {
  ArrowLeftRight, RefreshCw, ExternalLink, Loader2, Landmark, Bot, Scissors,
  Coins, Activity, Users, ArrowRight, AlertTriangle,
} from "lucide-react";

// ── shared display atoms (mirror components/admin/treasuries-section.tsx) ──────
const fmtUsd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;
const short = (a?: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "—");

function Kpi({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] px-5 py-4 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-zinc-600 text-[10px] uppercase tracking-widest">{icon}<span>{label}</span></div>
      <p className={`text-[22px] font-mono font-black tabular-nums tracking-tight leading-none ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-[10.5px] text-zinc-700">{sub}</p>}
    </div>
  );
}
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-600 ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}
function Td({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${right ? "text-right" : ""} ${className}`}>{children}</td>;
}

// ── tracked-wallet model ──────────────────────────────────────────────────────
type WalletKind = "treasury" | "agent" | "campaign";
type Tracked = { address: string; name: string; kind: WalletKind };

const TREASURY = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET?.trim() ?? "";
const ROUTE_MAX_WALLETS = 40; // must match the /api/solana/usdc-transfers cap
const PER_WALLET_LIMIT = 25;

function kindIcon(kind: WalletKind) {
  if (kind === "treasury") return <Landmark className="size-3 text-emerald-400" />;
  if (kind === "agent") return <Bot className="size-3 text-fuchsia-300" />;
  return <Scissors className="size-3 text-violet-300" />;
}

/** Unix-seconds → compact "2h ago" style, with an ISO title for the exact time. */
function timeAgo(sec: number | null): { rel: string; abs: string } {
  if (!sec) return { rel: "—", abs: "" };
  const ms = sec * 1000;
  const diff = Date.now() - ms;
  const abs = new Date(ms).toLocaleString();
  if (diff < 0) return { rel: "just now", abs };
  const s = Math.floor(diff / 1000);
  if (s < 60) return { rel: `${s}s ago`, abs };
  const m = Math.floor(s / 60);
  if (m < 60) return { rel: `${m}m ago`, abs };
  const h = Math.floor(m / 60);
  if (h < 24) return { rel: `${h}h ago`, abs };
  const d = Math.floor(h / 24);
  return { rel: d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }), abs };
}

function dedupeKey(t: UsdcTransfer) {
  return `${t.signature}|${t.from ?? ""}|${t.to ?? ""}|${t.amountUsdc}`;
}

/** One party cell — friendly name (+kind icon) for a tracked wallet, else a
 *  short mono address. Always links to the account on the explorer. */
function Party({ addr, byAddress }: { addr: string | null; byAddress: Map<string, Tracked> }) {
  if (!addr) return <span className="text-zinc-700 text-[11px]">unknown</span>;
  const t = byAddress.get(addr);
  return (
    <a
      href={getAccountExplorerUrl(addr)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white max-w-[220px]"
      title={addr}
    >
      {t ? kindIcon(t.kind) : null}
      <span className={`truncate ${t ? "font-semibold" : "font-mono text-[11.5px] text-zinc-400"}`}>
        {t ? t.name : short(addr)}
      </span>
      <ExternalLink className="size-3 shrink-0 text-zinc-600" />
    </a>
  );
}

export function TransactionsSection() {
  const influencers = useQuery(api.influencers.listAll);
  const campaigns = useQuery(api.campaigns.list);
  const dataReady = influencers !== undefined && campaigns !== undefined;

  // Build the tracked-wallet set: platform treasury + every agent wallet + every
  // funded campaign escrow PDA. Deduped by address (an address keeps its first
  // friendly label).
  const tracked = useMemo<Tracked[]>(() => {
    const list: Tracked[] = [];
    const seen = new Set<string>();
    const push = (address: string | null | undefined, name: string, kind: WalletKind) => {
      const a = address?.trim();
      if (!a || seen.has(a)) return;
      seen.add(a);
      list.push({ address: a, name, kind });
    };
    push(TREASURY, "Platform Treasury", "treasury");
    for (const inf of influencers ?? []) push(inf.agentWallet, inf.name ?? "Agent", "agent");
    for (const c of campaigns ?? []) push(c.pdaAddress, c.title ?? c.brandName ?? "Campaign escrow", "campaign");
    return list;
  }, [influencers, campaigns]);

  const byAddress = useMemo(() => {
    const m = new Map<string, Tracked>();
    for (const t of tracked) m.set(t.address, t);
    return m;
  }, [tracked]);

  const addrKey = useMemo(() => tracked.map((t) => t.address).join(","), [tracked]);

  const [transfers, setTransfers] = useState<UsdcTransfer[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const addresses = addrKey ? addrKey.split(",") : [];
    if (addresses.length === 0) {
      setTransfers([]);
      setStatus("idle");
      setUpdatedAt(Date.now());
      return;
    }
    setStatus("loading");
    try {
      // Chunk to stay under the route's wallet cap; the global fetch interceptor
      // attaches the Privy auth token automatically.
      const chunks: string[][] = [];
      for (let i = 0; i < addresses.length; i += ROUTE_MAX_WALLETS) chunks.push(addresses.slice(i, i + ROUTE_MAX_WALLETS));
      const all: UsdcTransfer[] = [];
      let ok = true;
      for (const chunk of chunks) {
        const res = await fetch(
          `/api/solana/usdc-transfers?wallets=${encodeURIComponent(chunk.join(","))}&limit=${PER_WALLET_LIMIT}`,
        );
        const data = (await res.json()) as { transfers?: UsdcTransfer[] };
        // A failed chunk returns ok:false with NO `transfers` — treat the whole
        // read as unavailable rather than show a confident partial (never a
        // fake "no transfers").
        if (!Array.isArray(data.transfers)) { ok = false; break; }
        all.push(...data.transfers);
      }
      if (!ok) {
        setStatus("error");
        return;
      }
      const seen = new Set<string>();
      const deduped = all
        .filter((t) => {
          const k = dedupeKey(t);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
      setTransfers(deduped);
      setStatus("idle");
      setUpdatedAt(Date.now());
    } catch {
      setStatus("error");
    }
  }, [addrKey]);

  // Manual refresh + a slow 60s poll (rate-limit discipline — never a fast poll).
  useEffect(() => {
    if (!dataReady) return;
    let alive = true;
    void refresh();
    const id = setInterval(() => { if (alive) void refresh(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [dataReady, refresh]);

  const rows = transfers ?? [];
  const summary = useMemo(() => {
    let volume = 0;
    const wallets = new Set<string>();
    for (const t of rows) {
      volume += t.amountUsdc;
      if (t.from) wallets.add(t.from);
      if (t.to) wallets.add(t.to);
    }
    return { volume, count: rows.length, wallets: wallets.size };
  }, [rows]);

  const loadingFirst = !dataReady || (status === "loading" && transfers === null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[18px] font-bold text-white">Transactions</h1>
        <p className="text-[12px] text-zinc-600">On-chain USDC transfers between the platform treasury, agent wallets, and campaign escrows.</p>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="size-4 text-emerald-400" />
            <h2 className="text-[15px] font-bold text-white">Wallet-to-wallet USDC</h2>
            <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/12 text-emerald-400">
              On-chain · {getNetworkLabel()}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600">
              <span className={`size-1.5 rounded-full ${status === "error" ? "bg-red-400" : "bg-emerald-400 animate-pulse"}`} />
              {status === "error"
                ? "read failed"
                : updatedAt
                ? `live · ${Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s ago`
                : "reading chain…"}
            </span>
            <button
              onClick={() => refresh()}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold border border-[#1e1e24] bg-[#0d0d10] text-zinc-500 hover:text-zinc-300"
            >
              <RefreshCw className={`size-3.5 ${status === "loading" ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        <p className="text-[12px] text-zinc-600 -mt-1">
          Read live from the chain across <span className="text-zinc-400">{tracked.length}</span> tracked wallet
          {tracked.length === 1 ? "" : "s"}. A transfer between two tracked wallets is shown once. Amounts and
          counterparties are recovered from token-balance deltas.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi icon={<Coins className="size-3" />} label="Volume" value={fmtUsd(summary.volume)} sub="USDC moved (shown window)" accent="text-emerald-400" />
          <Kpi icon={<Activity className="size-3" />} label="Transfers" value={`${summary.count}`} sub="wallet-to-wallet" />
          <Kpi icon={<Users className="size-3" />} label="Wallets" value={`${summary.wallets}`} sub="distinct parties" accent="text-sky-300" />
          <Kpi icon={<ArrowLeftRight className="size-3" />} label="Tracked" value={`${tracked.length}`} sub="treasury · agents · escrows" accent="text-violet-300" />
        </div>

        <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[880px]">
              <thead><tr className="border-b border-[#16161a]">
                <Th>From</Th><Th></Th><Th>To</Th><Th right>Amount</Th><Th>Token</Th><Th>Time</Th><Th right>Signature</Th>
              </tr></thead>
              <tbody className="divide-y divide-[#121215]">
                {loadingFirst ? (
                  <tr><Td className="text-zinc-600"><span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Reading transfers from the chain…</span></Td></tr>
                ) : status === "error" && rows.length === 0 ? (
                  <tr><Td className="text-amber-400"><span className="inline-flex items-center gap-2"><AlertTriangle className="size-4" /> Couldn&apos;t read the chain right now (RPC rate-limited or unavailable). Try Refresh.</span></Td></tr>
                ) : rows.length === 0 ? (
                  <tr><Td className="text-zinc-600">No USDC transfers found for the tracked wallets yet.</Td></tr>
                ) : rows.map((t) => {
                  const ta = timeAgo(t.blockTime);
                  return (
                    <tr key={`${t.signature}:${t.from ?? ""}:${t.to ?? ""}:${t.amountUsdc}`} className="hover:bg-white/[0.015]">
                      <Td><Party addr={t.from} byAddress={byAddress} /></Td>
                      <Td><ArrowRight className="size-3.5 text-zinc-700" /></Td>
                      <Td><Party addr={t.to} byAddress={byAddress} /></Td>
                      <Td right><span className="font-mono tabular-nums font-bold text-emerald-400">{fmtUsd(t.amountUsdc)}</span></Td>
                      <Td><span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-sky-500/12 text-sky-300"><Coins className="size-2.5" /> USDC</span></Td>
                      <Td><span className="text-zinc-500 tabular-nums" title={ta.abs}>{ta.rel}</span></Td>
                      <Td right>
                        <a href={getTxExplorerUrl(t.signature)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-white">
                          {short(t.signature)}<ExternalLink className="size-3" />
                        </a>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {!TREASURY && (
          <p className="text-[11px] text-amber-500/80">
            <AlertTriangle className="inline size-3 mr-1" />
            <code>NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET</code> is not set — treasury transfers are excluded from this view.
          </p>
        )}
      </section>
    </div>
  );
}
