"use client";

import { useEffect, useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import Link from "next/link";
import { Loader2, Pencil, Power, Zap, X, Coins, Trash2, ArrowDownToLine, ArrowUpFromLine, AlertTriangle } from "lucide-react";
import DepositModal from "@/components/builder/DepositModal";
import WithdrawModal from "@/components/builder/WithdrawModal";
import { fmtUsd, cronLabel } from "./util";
import { confirmMatches } from "./adminActionGuards";

type Agent = {
  _id: string;
  mintAddress: string;
  creatorWallet?: string;
  name: string;
  handle: string;
  avatarUrl: string;
  niche: string;
  language: string;
  archetype: string;
  agentType?: string;
  description: string;
  tvl: number;
  monthlyEarnings: number;
  sharePrice: number;
  totalShares: number;
  availableShares: number;
  agentWallet?: string;
  paperUsdcBalance?: number;
  heartbeatEnabled?: boolean;
  heartbeatCron?: string;
};

/* ── Edit modal ─────────────────────────────────────────────────────────── */

const TEXT_FIELDS: { key: keyof Agent; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "handle", label: "Handle" },
  { key: "niche", label: "Niche" },
  { key: "agentType", label: "Type (influencer/trader/worker)" },
  { key: "language", label: "Language" },
  { key: "archetype", label: "Archetype" },
  { key: "avatarUrl", label: "Avatar URL" },
];
const NUM_FIELDS: { key: keyof Agent; label: string }[] = [
  { key: "tvl", label: "TVL" },
  { key: "monthlyEarnings", label: "Monthly earnings" },
  { key: "sharePrice", label: "Share price" },
  { key: "totalShares", label: "Total shares" },
  { key: "availableShares", label: "Available shares" },
];

function EditModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { accessToken } = useSupabaseAuth();
  const updateAgent = useAction(api.admin.updateAgent);
  const adjustBalance = useAction(api.admin.adjustAgentPaperBalance);
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    [...TEXT_FIELDS, ...NUM_FIELDS].forEach(({ key }) => {
      const v = agent[key];
      f[key as string] = v === undefined || v === null ? "" : String(v);
    });
    f.description = agent.description ?? "";
    return f;
  });
  const [balanceDelta, setBalanceDelta] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!accessToken) { setErr("Not signed in"); return; }
    setSaving(true); setErr(null);
    try {
      const patch: Record<string, unknown> = {};
      TEXT_FIELDS.forEach(({ key }) => { patch[key as string] = form[key as string]; });
      NUM_FIELDS.forEach(({ key }) => { patch[key as string] = Number(form[key as string]); });
      patch.description = form.description;
      await updateAgent({ accessToken, mintAddress: agent.mintAddress, patch: patch as never });
      const delta = Number(balanceDelta);
      if (Number.isFinite(delta) && delta !== 0) {
        await adjustBalance({ accessToken, mintAddress: agent.mintAddress, amount: delta });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-bold text-white">Edit agent · {agent.name}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="size-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {TEXT_FIELDS.map(({ key, label }) => (
            <label key={key as string} className="text-[11px] text-zinc-500">
              {label}
              <input
                value={form[key as string]}
                onChange={(e) => setForm((f) => ({ ...f, [key as string]: e.target.value }))}
                className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[12.5px] text-white focus:outline-none focus:border-zinc-600"
              />
            </label>
          ))}
          {NUM_FIELDS.map(({ key, label }) => (
            <label key={key as string} className="text-[11px] text-zinc-500">
              {label}
              <input
                type="number"
                value={form[key as string]}
                onChange={(e) => setForm((f) => ({ ...f, [key as string]: e.target.value }))}
                className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[12.5px] text-white font-mono focus:outline-none focus:border-zinc-600"
              />
            </label>
          ))}
        </div>

        <label className="block mt-3 text-[11px] text-zinc-500">
          Description
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={3}
            className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[12.5px] text-white focus:outline-none focus:border-zinc-600"
          />
        </label>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="text-[11px] text-zinc-500">
            Adjust paper balance (±USDC) · now {fmtUsd(agent.paperUsdcBalance ?? 0)}
            <input
              type="number"
              value={balanceDelta}
              placeholder="e.g. 500 or -200"
              onChange={(e) => setBalanceDelta(e.target.value)}
              className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[12.5px] text-white font-mono focus:outline-none focus:border-zinc-600"
            />
          </label>
        </div>

        {err && <p className="mt-3 text-[11.5px] text-amber-400">{err}</p>}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white text-[12.5px]">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12.5px] font-semibold inline-flex items-center gap-2">
            {saving && <Loader2 className="size-3.5 animate-spin" />} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Delete confirm (type-to-confirm; destructive) ──────────────────────── */

function DeleteAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { accessToken } = useSupabaseAuth();
  const deleteAgent = useAction(api.admin.deleteAgent);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Type-to-confirm on the agent handle (short, exact) — armed only on a match.
  const ready = confirmMatches(confirm, agent.handle);

  async function doDelete() {
    if (!accessToken) { setErr("Not signed in"); return; }
    if (!ready) return;
    setDeleting(true); setErr(null);
    try {
      await deleteAgent({ accessToken, mintAddress: agent.mintAddress });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-rose-900/60 bg-[#0d0d10] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="inline-flex items-center gap-2 text-[15px] font-bold text-white">
            <AlertTriangle className="size-4 text-rose-400" /> Delete agent
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="size-4" /></button>
        </div>
        <p className="text-[12.5px] text-zinc-400 leading-relaxed">
          This removes the app record for <span className="font-semibold text-white">{agent.name}</span> (@{agent.handle})
          so it leaves the marketplace and admin lists. The on-chain NFT and the agent&apos;s wallet (and any USDC in it)
          <span className="text-zinc-200"> persist</span> — this only deletes the Vello database row and can&apos;t be undone.
        </p>
        <label className="block mt-4 text-[11px] text-zinc-500">
          Type the handle <span className="font-mono text-zinc-300">{agent.handle}</span> to confirm
          <input
            autoFocus
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={agent.handle}
            className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[12.5px] text-white font-mono focus:outline-none focus:border-rose-700"
          />
        </label>
        {err && <p className="mt-3 text-[11.5px] text-amber-400">{err}</p>}
        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white text-[12.5px]">Cancel</button>
          <button
            onClick={doDelete}
            disabled={!ready || deleting || !accessToken}
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12.5px] font-semibold inline-flex items-center gap-2"
          >
            {deleting && <Loader2 className="size-3.5 animate-spin" />} Delete agent
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Section ────────────────────────────────────────────────────────────── */

export function AgentsSection() {
  const { accessToken } = useSupabaseAuth();
  const agents = (useQuery(api.influencers.listAll) ?? []) as unknown as Agent[];
  const setHeartbeat = useAction(api.admin.setAgentHeartbeat);
  const fireNow = useAction(api.admin.fireHeartbeatNow);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [depositing, setDepositing] = useState<Agent | null>(null);
  const [withdrawing, setWithdrawing] = useState<Agent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [walletBal, setWalletBal] = useState<Record<string, number>>({});

  // Live on-chain USDC for agents that have a dedicated wallet.
  useEffect(() => {
    const withWallet = agents.filter((a) => a.agentWallet);
    if (withWallet.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      await Promise.all(withWallet.map(async (a) => {
        try {
          const res = await fetch(`/api/agent-wallet-balance?wallet=${a.agentWallet}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data?.ok) next[a.agentWallet!] = data.usdc;
        } catch { /* ignore */ }
      }));
      if (!cancelled) setWalletBal(next);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try { await fn(); } catch { /* surfaced elsewhere */ } finally { setBusy(null); }
  }

  return (
    <>
      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#18181c]">
          <h2 className="text-[15px] font-bold text-white">Agents</h2>
          <p className="text-[11.5px] text-zinc-600 mt-0.5">{agents.length} total · edit fields, paper balance, heartbeats · on-chain deposit/withdraw · delete</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
                <th className="py-3 px-4 text-left font-medium">Agent</th>
                <th className="py-3 px-4 text-left font-medium">Type</th>
                <th className="py-3 px-4 text-right font-medium">TVL</th>
                <th className="py-3 px-4 text-right font-medium">Monthly</th>
                <th className="py-3 px-4 text-right font-medium">Paper</th>
                <th className="py-3 px-4 text-right font-medium">Wallet USDC</th>
                <th className="py-3 px-4 text-left font-medium">Heartbeat</th>
                <th className="py-3 px-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a._id} className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.015]">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="size-7 rounded-lg overflow-hidden border border-[#27272a] shrink-0 bg-zinc-900">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {a.avatarUrl ? <img src={a.avatarUrl} alt="" className="w-full h-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white leading-tight truncate">{a.name}</p>
                        <p className="text-[10.5px] text-zinc-600 font-mono">@{a.handle}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 capitalize text-zinc-400">{a.agentType ?? "influencer"}</td>
                  <td className="py-3 px-4 text-right font-mono text-white">{fmtUsd(a.tvl)}</td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-400">{fmtUsd(a.monthlyEarnings)}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">{fmtUsd(a.paperUsdcBalance ?? 0)}</td>
                  <td className="py-3 px-4 text-right font-mono text-zinc-300">
                    {a.agentWallet ? (walletBal[a.agentWallet] !== undefined ? fmtUsd(walletBal[a.agentWallet]) : <span className="text-zinc-700">…</span>) : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`text-[10px] font-semibold rounded-md px-1.5 py-0.5 border ${a.heartbeatEnabled ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-zinc-500 bg-zinc-500/10 border-zinc-700"}`}>
                      {a.heartbeatEnabled ? cronLabel(a.heartbeatCron ?? "manual") : "off"}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button title="Edit" onClick={() => setEditing(a)} className="p-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-white transition-colors">
                        <Pencil className="size-3.5" />
                      </button>
                      <button title={a.heartbeatEnabled ? "Pause heartbeat" : "Enable heartbeat"} disabled={busy === `t-${a.mintAddress}` || !accessToken}
                        onClick={() => run(`t-${a.mintAddress}`, () => setHeartbeat({ accessToken: accessToken!, mintAddress: a.mintAddress, enabled: !a.heartbeatEnabled }))}
                        className="p-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-white transition-colors">
                        {busy === `t-${a.mintAddress}` ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                      </button>
                      <button title="Fire heartbeat" disabled={busy === `f-${a.mintAddress}` || !accessToken}
                        onClick={() => run(`f-${a.mintAddress}`, () => fireNow({ accessToken: accessToken!, mintAddress: a.mintAddress }))}
                        className="p-1.5 rounded-lg border border-emerald-800/60 hover:border-emerald-600 text-emerald-400 transition-colors">
                        {busy === `f-${a.mintAddress}` ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                      </button>
                      {a.agentWallet && (
                        <>
                          <button title="Deposit USDC (your wallet → agent, on-chain)" onClick={() => setDepositing(a)}
                            className="p-1.5 rounded-lg border border-emerald-800/60 hover:border-emerald-600 text-emerald-400 transition-colors">
                            <ArrowDownToLine className="size-3.5" />
                          </button>
                          <button title="Withdraw USDC (agent → owner wallet, on-chain)" onClick={() => setWithdrawing(a)}
                            className="p-1.5 rounded-lg border border-sky-800/60 hover:border-sky-600 text-sky-400 transition-colors">
                            <ArrowUpFromLine className="size-3.5" />
                          </button>
                        </>
                      )}
                      <Link href={`/admin/investments/${encodeURIComponent(a.mintAddress)}`} title="Escrow & investments"
                        className="p-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-white transition-colors">
                        <Coins className="size-3.5" />
                      </Link>
                      <button title="Delete agent (app record only)" onClick={() => setDeleting(a)}
                        className="p-1.5 rounded-lg border border-rose-900/60 hover:border-rose-600 text-rose-400 transition-colors">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {agents.length === 0 && (
                <tr><td colSpan={8} className="py-12 text-center text-zinc-700">No agents minted yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <EditModal agent={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteAgentModal agent={deleting} onClose={() => setDeleting(null)} />}

      {/* Real on-chain deposit — the ADMIN's connected wallet signs + funds the
          agent wallet (reuses the Earnings-card DepositModal; no new tx code). */}
      {depositing?.agentWallet && (
        <DepositModal
          open
          agentName={depositing.name}
          agentWallet={depositing.agentWallet}
          onClose={() => setDepositing(null)}
          onFunded={(bal) => setWalletBal((prev) => ({ ...prev, [depositing.agentWallet!]: bal.usdc }))}
        />
      )}

      {/* Real on-chain withdraw — reuses the audited /api/agents/withdraw route
          (custodial-signed) which ALWAYS sends to the agent's OWNER wallet. That
          route is SIWS owner-gated, so it only succeeds when the connected admin
          wallet is (or is linked to) the agent's owner — the destination is never
          admin-supplied. safeWithdrawable is seeded from the on-chain read; the
          server recomputes the authoritative cap. */}
      {withdrawing?.agentWallet && (
        <WithdrawModal
          open
          agentName={withdrawing.name}
          agentWallet={withdrawing.agentWallet}
          ownerWallet={withdrawing.creatorWallet}
          mintAddress={withdrawing.mintAddress}
          safeWithdrawable={walletBal[withdrawing.agentWallet] ?? 0}
          onClose={() => setWithdrawing(null)}
          onWithdrawn={(bal) => setWalletBal((prev) => ({ ...prev, [withdrawing.agentWallet!]: bal.usdc }))}
        />
      )}
    </>
  );
}
