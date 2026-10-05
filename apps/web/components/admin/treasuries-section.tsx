"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getRpcUrl, getUsdcMint, getAccountExplorerUrl, getNetworkLabel } from "@/lib/solana/network";
import { getContentRewards, getAllContentRewardSubmissions, type ContentReward, type AdminRewardSubmission } from "@/lib/content-rewards";
import { CLIPPING_FR_ORIGIN } from "@/lib/clippingFr";
import {
  Landmark, Lock, RefreshCw, ExternalLink, Loader2, Globe, Scissors, Clapperboard,
  CircleDollarSign, ArrowUpRight, Wallet, CheckCircle2, Clock, Bot, Users,
  Megaphone, Trophy, ChevronRight,
} from "lucide-react";

// The mirror panel pulls the Anchor/wallet bundle — keep this read-only view
// light by only loading it when the admin opens the panel.
const ClippingFrMirror = dynamic(
  () => import("./clipping-fr-mirror").then((m) => m.ClippingFrMirror),
  {
    ssr: false,
    loading: () => (
      <p className="inline-flex items-center gap-2 text-[12px] text-zinc-600">
        <Loader2 className="size-4 animate-spin" /> Loading the Clipping FR mirror…
      </p>
    ),
  },
);

// ── USDC mint for the escrow ATAs (same resolution lib/escrow uses), inlined so
//    this read-only admin view doesn't pull the Anchor/crypto bundle. ──────────
function escrowUsdcMint(): PublicKey {
  const override = process.env.NEXT_PUBLIC_USDC_MINT?.trim();
  return new PublicKey(override && override.length > 0 ? override : getUsdcMint());
}

const fmtUsd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;
const short = (a?: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "—");

// ── Live on-chain balance reader (batched, IDL-independent token-account read) ─
function parseUiAmount(acc: { data: unknown } | null): number {
  if (!acc) return 0;
  const data = acc.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } };
  const ui = data?.parsed?.info?.tokenAmount?.uiAmount;
  return typeof ui === "number" ? ui : 0;
}

function useTreasuryBalances(pdas: { id: string; pda: string }[]) {
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const key = useMemo(() => pdas.map((p) => `${p.id}:${p.pda}`).sort().join(","), [pdas]);

  const refresh = useCallback(async () => {
    const list = key ? key.split(",").map((s) => { const [id, pda] = s.split(":"); return { id, pda }; }) : [];
    if (list.length === 0) { setBalances({}); setLoading(false); setUpdatedAt(Date.now()); return; }
    try {
      const conn = new Connection(getRpcUrl(), "confirmed");
      const mint = escrowUsdcMint();
      const atas = await Promise.all(list.map((t) => getAssociatedTokenAddress(mint, new PublicKey(t.pda), true)));
      const next: Record<string, number> = {};
      for (let i = 0; i < atas.length; i += 100) {
        const res = await conn.getMultipleParsedAccounts(atas.slice(i, i + 100));
        res.value.forEach((acc, j) => { next[list[i + j].id] = parseUiAmount(acc as { data: unknown } | null); });
      }
      setBalances(next); setUpdatedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void refresh();
    const id = setInterval(() => { if (alive) void refresh(); }, 25_000);
    return () => { alive = false; clearInterval(id); };
  }, [refresh]);

  return { balances, loading, updatedAt, refresh };
}

type CampaignDoc = FunctionReturnType<typeof api.campaigns.list>[number];

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

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-600 ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}
function Td({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${right ? "text-right" : ""} ${className}`}>{children}</td>;
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 1 — On-chain campaign treasuries
// ════════════════════════════════════════════════════════════════════════════
function OnchainTreasuries() {
  const rawCampaigns = useQuery(api.campaigns.list);
  const loading = rawCampaigns === undefined;
  const campaigns: CampaignDoc[] = useMemo(() => rawCampaigns ?? [], [rawCampaigns]);

  const fundedPdas = useMemo(
    () => campaigns.filter((c) => !!c.pdaAddress).map((c) => ({ id: c._id as string, pda: c.pdaAddress! })),
    [campaigns],
  );
  const { balances, loading: balLoading, updatedAt, refresh } = useTreasuryBalances(fundedPdas);

  const ordered = useMemo(() =>
    [...campaigns].sort((a, b) => {
      const af = a.pdaAddress ? 1 : 0, bf = b.pdaAddress ? 1 : 0;
      if (af !== bf) return bf - af;
      return (b._creationTime ?? 0) - (a._creationTime ?? 0);
    }), [campaigns]);

  const summary = useMemo(() => {
    let totalLocked = 0, totalBudget = 0, totalPaid = 0, funded = 0, clippingFr = 0;
    for (const c of campaigns) {
      totalBudget += c.budget ?? 0;
      const bal = balances[c._id as string];
      if (c.pdaAddress) { funded += 1; if (typeof bal === "number") totalLocked += bal; }
      if ((c as { origin?: string }).origin === CLIPPING_FR_ORIGIN) clippingFr += 1;
      totalPaid += typeof c.spentUsdc === "number" ? c.spentUsdc
        : (c.pdaAddress && typeof bal === "number" ? Math.max(0, (c.budget ?? 0) - bal) : 0);
    }
    return { totalLocked, totalBudget, totalPaid, funded, clippingFr, pending: campaigns.length - funded, total: campaigns.length };
  }, [campaigns, balances]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Landmark className="size-4 text-emerald-400" />
          <h2 className="text-[15px] font-bold text-white">On-Chain Campaign Treasuries</h2>
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/12 text-emerald-400">
            On-chain · {getNetworkLabel()}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {updatedAt ? `live · ${Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s ago` : "reading chain…"}
          </span>
          <button onClick={() => refresh()} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold border border-[#1e1e24] bg-[#0d0d10] text-zinc-500 hover:text-zinc-300">
            <RefreshCw className={`size-3.5 ${balLoading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      <p className="text-[12px] text-zinc-600 -mt-1">
        Each campaign locks its budget into a Solana USDC escrow PDA (Anchor program) at launch. Creator payouts
        are deducted on-chain via the claim keeper — the locked balance below is read live from the chain.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={<Lock className="size-3" />} label="Total locked" value={fmtUsd(summary.totalLocked)} sub="on-chain USDC" accent="text-emerald-400" />
        <Kpi icon={<CircleDollarSign className="size-3" />} label="Total budget" value={fmtUsd(summary.totalBudget)} sub={`${summary.total} campaigns`} />
        <Kpi icon={<ArrowUpRight className="size-3" />} label="Paid out" value={fmtUsd(summary.totalPaid)} sub="to creators" accent="text-emerald-300" />
        <Kpi icon={<CheckCircle2 className="size-3" />} label="Funded" value={`${summary.funded}`} sub="on-chain vaults" accent="text-emerald-400" />
        <Kpi icon={<Clock className="size-3" />} label="Pending" value={`${summary.pending}`} sub="awaiting funding" accent="text-amber-400" />
        <Kpi icon={<Scissors className="size-3" />} label="Clipping FR" value={`${summary.clippingFr}`} sub="mirrored campaigns" accent="text-violet-300" />
      </div>

      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[1120px]">
            <thead><tr className="border-b border-[#16161a]">
              <Th>Campaign</Th><Th>Type</Th><Th>Owner</Th><Th right>Budget</Th><Th right>Rate</Th><Th right>Locked</Th>
              <Th right>Paid out</Th><Th right>Subs</Th><Th>Status</Th><Th>Deadline</Th><Th right>Treasury</Th>
            </tr></thead>
            <tbody className="divide-y divide-[#121215]">
              {loading ? (
                <tr><Td className="text-zinc-600"><span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading campaigns…</span></Td></tr>
              ) : ordered.length === 0 ? (
                <tr><Td className="text-zinc-600">No campaigns yet.</Td></tr>
              ) : ordered.map((c) => {
                const onchain = !!c.pdaAddress;
                const bal = balances[c._id as string];
                const budget = c.budget ?? 0;
                const paid = typeof c.spentUsdc === "number" ? c.spentUsdc : (onchain && typeof bal === "number" ? Math.max(0, budget - bal) : 0);
                const locked = onchain && typeof bal === "number" ? bal : 0;
                const deadlineMs = Date.parse(c.deadline);
                const deadline = Number.isFinite(deadlineMs) ? new Date(deadlineMs).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
                const isFr = (c as { origin?: string }).origin === CLIPPING_FR_ORIGIN;
                return (
                  <tr key={c._id as string} className="hover:bg-white/[0.015]">
                    <Td>
                      <div className="flex items-center gap-2.5 max-w-[260px]">
                        <div className="size-7 rounded-md overflow-hidden shrink-0 ring-1 ring-white/10 bg-zinc-800">
                          {c.brandLogoUrl
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={c.brandLogoUrl} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-[11px] font-black text-white/40">{c.brandName?.[0]?.toUpperCase() ?? "?"}</div>}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">{c.title}</p>
                          <p className="text-[11px] text-zinc-600 truncate">{c.brandName}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {isFr
                        ? <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-violet-500/12 text-violet-300"><Scissors className="size-2.5" /> Clipping FR</span>
                        : c.campaignType === "bounty"
                        ? <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/12 text-amber-300"><Trophy className="size-2.5" /> Bounty</span>
                        : c.campaignType === "agent_task"
                        ? <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-fuchsia-500/12 text-fuchsia-300"><Bot className="size-2.5" /> Agent Task</span>
                        : c.campaignType === "marketing"
                        ? <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-sky-500/12 text-sky-300"><Megaphone className="size-2.5" /> Marketing</span>
                        : <span className="text-zinc-700 text-[11px]">—</span>}
                    </Td>
                    <Td>
                      <a href={getAccountExplorerUrl(c.creatorWallet)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11.5px] text-zinc-400 hover:text-white">
                        {short(c.creatorWallet)} <ExternalLink className="size-3" />
                      </a>
                    </Td>
                    <Td right><span className="font-mono tabular-nums text-zinc-300">{fmtUsd(budget)}</span></Td>
                    <Td right><span className="font-mono tabular-nums text-zinc-400">{(c.ratePerThousandViews ?? 0) > 0 ? `$${c.ratePerThousandViews}/1K` : "—"}</span></Td>
                    <Td right><span className="font-mono tabular-nums font-bold text-emerald-400">{onchain ? (balLoading && bal === undefined ? "···" : fmtUsd(locked)) : "—"}</span></Td>
                    <Td right><span className="font-mono tabular-nums text-zinc-300">{fmtUsd(paid)}</span></Td>
                    <Td right><span className="tabular-nums text-zinc-400">{c.submissionsCount ?? 0}</span></Td>
                    <Td>
                      {onchain
                        ? <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/12 text-emerald-400"><Lock className="size-2.5" /> Funded</span>
                        : <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/12 text-amber-400"><Clock className="size-2.5" /> Pending</span>}
                    </Td>
                    <Td><span className="text-zinc-500 tabular-nums">{deadline}</span></Td>
                    <Td right>
                      {onchain
                        ? <a href={getAccountExplorerUrl(c.pdaAddress!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-white"><Wallet className="size-3" />{short(c.pdaAddress)}<ExternalLink className="size-3" /></a>
                        : <span className="text-zinc-700 text-[11px]">no vault</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION 2 — Jobtepi campaigns (Web2 · off-chain): clipping + UGC
// ════════════════════════════════════════════════════════════════════════════
function JobtepiCampaigns() {
  const [rewards, setRewards] = useState<ContentReward[]>([]);
  const [agentSubs, setAgentSubs] = useState<AdminRewardSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    // Pull the campaigns AND the Vello-agent content-reward submissions in parallel.
    // The agent submissions (scoped to vello.gg accounts) give us each agent clip's
    // view-based reward value so we can split human payouts from AI-agent rewards.
    Promise.all([getContentRewards(), getAllContentRewardSubmissions()])
      .then(([rw, subs]) => { if (alive) { setRewards(rw); setAgentSubs(subs); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Per-campaign AI-agent reward value = Σ (views × reward rate) across every clip
  // a Vello agent posted to that content reward (`supposedPayout`, computed live
  // from views — NOT on-chain). Keyed by content_reward id.
  const agentByReward = useMemo(() => {
    const m = new Map<string, { value: number; count: number }>();
    for (const s of agentSubs) {
      if (!s.contentRewardId) continue;
      const prev = m.get(s.contentRewardId) ?? { value: 0, count: 0 };
      prev.value += Number(s.supposedPayout) || 0;
      prev.count += 1;
      m.set(s.contentRewardId, prev);
    }
    return m;
  }, [agentSubs]);

  const summary = useMemo(() => {
    const clipping = rewards.filter((r) => r.type?.toLowerCase() === "clipping").length;
    const ugc = rewards.length - clipping;
    const budget = rewards.reduce((s, r) => s + (Number(r.budget) || 0), 0);
    const subs = rewards.reduce((s, r) => s + (r.total_submissions ?? 0), 0);
    let aiValue = 0, humansPaid = 0, agentClips = 0;
    for (const r of rewards) {
      const a = agentByReward.get(r.id);
      const ai = a?.value ?? 0;
      agentClips += a?.count ?? 0;
      aiValue += ai;
      humansPaid += Math.max(0, (Number(r.paidOut) || 0) - ai);
    }
    return { clipping, ugc, budget, humansPaid, aiValue, agentClips, subs, total: rewards.length };
  }, [rewards, agentByReward]);

  return (
    <section className="space-y-4 pt-2">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-sky-400" />
        <h2 className="text-[15px] font-bold text-white">Jobtepi Campaigns</h2>
        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-sky-500/12 text-sky-400">Web2 · off-chain</span>
      </div>
      <p className="text-[12px] text-zinc-600 -mt-1">
        Clipping &amp; UGC campaigns sourced from jobtepi. These are <span className="text-zinc-400">not backed by an on-chain treasury</span> —
        budgets and payouts are tracked in the jobtepi (Supabase) backend, separate from the Solana escrow rail above.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={<CircleDollarSign className="size-3" />} label="Total budget" value={fmtUsd(summary.budget)} sub={`${summary.total} campaigns`} accent="text-sky-400" />
        <Kpi icon={<Users className="size-3" />} label="Humans paid" value={fmtUsd(summary.humansPaid)} sub="off-chain" />
        <Kpi icon={<Bot className="size-3" />} label="AI agents" value={fmtUsd(summary.aiValue)} sub={`${summary.agentClips} agent clip${summary.agentClips === 1 ? "" : "s"}`} accent="text-emerald-400" />
        <Kpi icon={<Scissors className="size-3" />} label="Clipping" value={`${summary.clipping}`} />
        <Kpi icon={<Clapperboard className="size-3" />} label="UGC" value={`${summary.ugc}`} />
        <Kpi icon={<CheckCircle2 className="size-3" />} label="Submissions" value={`${summary.subs}`} sub="total" />
      </div>

      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[940px]">
            <thead><tr className="border-b border-[#16161a]">
              <Th>Campaign</Th><Th>Type</Th><Th>Owner</Th><Th right>Budget</Th>
              <Th right>Humans Paid</Th><Th right>AI Agents</Th><Th right>Subs</Th><Th>Status</Th>
            </tr></thead>
            <tbody className="divide-y divide-[#121215]">
              {loading ? (
                <tr><Td className="text-zinc-600"><span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading jobtepi campaigns…</span></Td></tr>
              ) : rewards.length === 0 ? (
                <tr><Td className="text-zinc-600">No jobtepi campaigns found.</Td></tr>
              ) : rewards.map((r) => {
                const isClip = r.type?.toLowerCase() === "clipping";
                const ai = agentByReward.get(r.id);
                const aiValue = ai?.value ?? 0;
                const humansPaid = Math.max(0, (Number(r.paidOut) || 0) - aiValue);
                return (
                  <tr key={r.id} className="hover:bg-white/[0.015]">
                    <Td>
                      <div className="flex items-center gap-2.5 max-w-[260px]">
                        <div className="size-7 rounded-md overflow-hidden shrink-0 ring-1 ring-white/10 bg-zinc-800">
                          {r.thumbnail_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={r.thumbnail_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-[11px] font-black text-white/40">{r.campaign_name?.[0]?.toUpperCase() ?? "?"}</div>}
                        </div>
                        <p className="font-semibold text-white truncate">{r.campaign_name}</p>
                      </div>
                    </Td>
                    <Td>
                      {isClip
                        ? <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-violet-500/12 text-violet-300"><Scissors className="size-2.5" /> Clipping</span>
                        : <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-sky-500/12 text-sky-300"><Clapperboard className="size-2.5" /> UGC</span>}
                    </Td>
                    <Td><span className="text-zinc-400 truncate inline-block max-w-[160px]">{r.communityName ?? r.ownerName ?? "—"}</span></Td>
                    <Td right><span className="font-mono tabular-nums text-zinc-300">{fmtUsd(Number(r.budget) || 0)}</span></Td>
                    <Td right><span className="font-mono tabular-nums text-zinc-400 inline-flex items-center gap-1 justify-end"><Users className="size-3 text-zinc-600" />{fmtUsd(humansPaid)}</span></Td>
                    <Td right>
                      <span className="inline-flex items-center gap-1.5 justify-end" title={ai ? `${ai.count} AI agent clip${ai.count === 1 ? "" : "s"} · view-based reward value` : "No AI agents on this campaign yet"}>
                        <span className="font-mono tabular-nums inline-flex items-center gap-1" style={{ color: aiValue > 0 ? "#34d399" : "#5b606b" }}>
                          <Bot className="size-3" />{fmtUsd(aiValue)}
                        </span>
                        {ai && ai.count > 0 && <span className="text-[10px] text-zinc-600 tabular-nums">· {ai.count} clip{ai.count === 1 ? "" : "s"}</span>}
                      </span>
                    </Td>
                    <Td right><span className="tabular-nums text-zinc-400">{r.total_submissions ?? 0}</span></Td>
                    <Td><span className="text-zinc-500 capitalize">{r.status ?? "—"}</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function TreasuriesSection() {
  const [mirrorOpen, setMirrorOpen] = useState(false);
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-[18px] font-bold text-white">Treasuries</h1>
        <p className="text-[12px] text-zinc-600">On-chain campaign escrows and off-chain jobtepi campaigns.</p>
      </div>
      <OnchainTreasuries />
      <div className="border-t border-[#16161a]" />
      {mirrorOpen ? (
        <ClippingFrMirror />
      ) : (
        <button
          onClick={() => setMirrorOpen(true)}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[12.5px] font-semibold border border-violet-500/25 bg-violet-500/[0.06] text-violet-300 hover:bg-violet-500/15"
        >
          <Scissors className="size-3.5" />
          Clipping FR — mirror jobtepi clipping campaigns into on-chain USDC treasuries
          <ChevronRight className="size-3.5" />
        </button>
      )}
      <div className="border-t border-[#16161a]" />
      <JobtepiCampaigns />
    </div>
  );
}
