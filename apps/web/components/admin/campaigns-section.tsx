"use client";

import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useSupabaseAuth } from "@/providers/supabase-auth-provider";
import { Loader2, X, ArrowDownToLine, AlertTriangle, ExternalLink, ShieldCheck, Pencil, Check } from "lucide-react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { buildEscrowProgram, topUpCampaignTx } from "@/lib/escrow";
import { getTxExplorerUrl } from "@/lib/solana/network";
import { MigrateVaultModal } from "@/components/campaign/migrate-vault-modal";
import { fmtUsd, shortAddr } from "./util";
import { parseAmount } from "./adminActionGuards";
import { campaignIsFunded, deadlineToDateInput, dateInputToDeadline } from "./campaignEdit";
import { Landmark } from "lucide-react";

const STATUSES = ["active", "pending", "completed", "expired"];

// Shared styling for the inline edit controls (match the table's existing inputs/buttons).
const EDIT_BTN =
  "inline-flex items-center gap-1 rounded-md border border-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors";
const SAVE_BTN =
  "inline-flex items-center gap-1 rounded-md border border-emerald-800/60 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40";
const CANCEL_BTN =
  "inline-flex items-center rounded-md border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-white";
const EDIT_INPUT =
  "bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[11.5px] text-white font-mono focus:outline-none focus:border-zinc-600";

/** A funded v2 campaign has an on-chain escrow vault we can deposit into. */
const isFundedV2 = campaignIsFunded;

/** Human-friendly deadline for the read cell — the parseable date, else the raw
 *  stored value, else an em-dash. Pure (a fixed date formats deterministically). */
function formatDeadline(deadline?: string | null): string {
  if (!deadline) return "—";
  const ms = Date.parse(deadline);
  if (!Number.isFinite(ms)) return deadline;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── Real ON-CHAIN escrow deposit (top_up) ──────────────────────────────────
 * Reuses the SAME audited path as the campaign detail page's Fund box:
 * topUpCampaignTx signed by the admin's connected wallet → the campaign escrow
 * PDA, then mirrored into Convex via /api/campaigns/topup (which VERIFIES the
 * on-chain transfer before crediting). No new signing/tx code. */
function EscrowDepositModal({ campaign, onClose }: { campaign: Doc<"campaigns">; onClose: () => void }) {
  const unified = useUnifiedSolanaWallet();
  const [amountStr, setAmountStr] = useState("50");
  const [step, setStep] = useState<"idle" | "submitting" | "success">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);

  const parsed = parseAmount(amountStr);
  const walletReady = !!unified.publicKey && !!unified.signTransaction;
  const canDeposit = parsed.valid && walletReady && step !== "submitting";

  async function deposit() {
    const pk = unified.publicKey;
    const signTx = unified.signTransaction;
    if (!pk || !signTx) { setErr("Connect your wallet first."); return; }
    if (!parsed.valid) { setErr("Enter a positive amount."); return; }
    setStep("submitting"); setErr(null); setTx(null);
    try {
      // Same signer shim the campaign-detail Reclaim path uses (unified wallet →
      // Anchor provider). buildEscrowProgram + topUpCampaignTx are the existing,
      // audited helpers — nothing new is signed here.
      const program = buildEscrowProgram({
        publicKey: pk,
        signTransaction: signTx,
        signAllTransactions: async (txs) => {
          const out = [];
          for (const t of txs) out.push(await signTx(t));
          return out;
        },
      });
      // Derive the PDA from the CREATOR (its on-chain seed), not the admin funder —
      // an admin funding another creator's campaign must pass campaign.creatorWallet
      // or the tx reverts AccountNotInitialized. The admin still pays; only the seed
      // must be the creator. (Mirrors campaign-detail.tsx handleFund.)
      const { txSignature } = await topUpCampaignTx(program, String(campaign._id), parsed.amount, campaign.creatorWallet);
      // Mirror into Convex through the deposit-verified route (topUpBudget is
      // secret-gated; this route re-verifies the on-chain transfer server-side).
      const resp = await fetch("/api/campaigns/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign._id, amount: parsed.amount, txSignature, funderWallet: pk.toBase58() }),
      });
      if (!resp.ok) {
        throw new Error((await resp.json().catch(() => ({}))).error || "Top-up mirror failed");
      }
      setTx(txSignature);
      setStep("success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Deposit failed");
      setStep("idle");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-emerald-900/50 bg-[#0d0d10] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="inline-flex items-center gap-2 text-[15px] font-bold text-white">
            <ShieldCheck className="size-4 text-emerald-400" /> Deposit to escrow
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="size-4" /></button>
        </div>
        <p className="text-[12px] text-zinc-400 leading-relaxed">
          <span className="font-semibold text-emerald-300">ON-CHAIN.</span> Your connected wallet signs a real USDC
          transfer into <span className="font-semibold text-white">{campaign.title}</span>&apos;s escrow vault
          {campaign.pdaAddress ? <> (<span className="font-mono text-zinc-300">{shortAddr(campaign.pdaAddress)}</span>)</> : null}.
          Distinct from the DB edits in the table.
        </p>

        {step === "success" ? (
          <div className="mt-4 rounded-xl border border-emerald-800/50 bg-emerald-950/30 px-4 py-3">
            <p className="text-[13px] font-semibold text-emerald-300">+{fmtUsd(parsed.amount)} locked in escrow</p>
            {tx && (
              <a href={getTxExplorerUrl(tx)} target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-400 hover:underline">
                View transaction <ExternalLink className="size-3" />
              </a>
            )}
            <button onClick={onClose} className="mt-3 w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12.5px] font-semibold py-2">Done</button>
          </div>
        ) : (
          <>
            <label className="block mt-4 text-[11px] text-zinc-500">
              Amount (USDC)
              <input
                type="number" min={0} step="0.01" autoFocus
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[13px] text-white font-mono focus:outline-none focus:border-emerald-700"
              />
            </label>
            {err && (
              <p className="mt-3 inline-flex items-start gap-1.5 text-[11.5px] text-amber-400">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> {err}
              </p>
            )}
            {!walletReady && <p className="mt-2 text-[11.5px] text-amber-500">Connect your wallet to deposit.</p>}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white text-[12.5px]">Cancel</button>
              <button
                onClick={deposit}
                disabled={!canDeposit}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12.5px] font-semibold inline-flex items-center gap-2"
              >
                {step === "submitting" ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowDownToLine className="size-3.5" />}
                Deposit {parsed.valid ? fmtUsd(parsed.amount) : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function CampaignsSection() {
  const { accessToken } = useSupabaseAuth();
  const campaigns = useQuery(api.campaigns.list);
  const updateCampaignAction = useAction(api.admin.updateCampaign);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [depositing, setDepositing] = useState<Doc<"campaigns"> | null>(null);
  const [migrating, setMigrating] = useState<Doc<"campaigns"> | null>(null);
  // At most one inline editor (rate / deadline / status of one row) is open at a
  // time. `value` is the working draft; Cancel discards it, Save patches the DB.
  const [editing, setEditing] = useState<{ id: string; field: "rate" | "deadline" | "status"; value: string } | null>(null);

  const updateCampaign = (args: { campaignId: unknown; status?: string; budget?: number; deadline?: string; ratePerThousandViews?: number }) =>
    updateCampaignAction({ accessToken: accessToken!, ...args } as never);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(null); }
  }

  const isEditing = (id: string, field: "rate" | "deadline" | "status") =>
    editing !== null && editing.id === id && editing.field === field;
  const openEdit = (id: string, field: "rate" | "deadline" | "status", value: string) =>
    setEditing({ id, field, value });
  const cancelEdit = () => setEditing(null);

  // Save the current inline edit as a DB-ONLY patch (reuses admin.updateCampaign),
  // skipping the round-trip when the value is unchanged/invalid. On success the
  // reactive Convex query refreshes the cell; we just clear the local draft.
  async function saveEdit(c: Doc<"campaigns">) {
    if (!editing || editing.id !== c._id) return;
    const key = `${editing.field}-${c._id}`;
    if (editing.field === "rate") {
      const val = Number(editing.value);
      if (Number.isFinite(val) && val !== c.ratePerThousandViews) {
        await run(key, () => updateCampaign({ campaignId: c._id, ratePerThousandViews: val }));
      }
    } else if (editing.field === "deadline") {
      const iso = dateInputToDeadline(editing.value);
      // Compare on the date-input form so an unchanged date (whose stored ISO may
      // carry a time component) is a no-op instead of a spurious 00:00Z rewrite.
      if (iso && editing.value !== deadlineToDateInput(c.deadline)) {
        await run(key, () => updateCampaign({ campaignId: c._id, deadline: iso }));
      }
    } else if (editing.field === "status") {
      if (editing.value !== c.status) {
        await run(key, () => updateCampaign({ campaignId: c._id, status: editing.value }));
      }
    }
    setEditing(null);
  }

  if (campaigns === undefined) {
    return <div className="py-20 flex justify-center"><Loader2 className="size-5 animate-spin text-zinc-700" /></div>;
  }

  return (
    <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] overflow-hidden">
      <div className="px-6 py-4 border-b border-[#18181c] flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-white">Campaigns</h2>
          <p className="text-[11.5px] text-zinc-600 mt-0.5">{campaigns.length} total</p>
        </div>
        {err && <span className="text-[11px] text-amber-400">{err}</span>}
      </div>
      {/* Honest DB-vs-onchain banner: the inline editors below write the Convex row
          ONLY. Moving real USDC is the separate "Deposit to escrow" on-chain action. */}
      <div className="px-6 py-2.5 border-b border-[#18181c] bg-amber-500/[0.06] flex items-start gap-2">
        <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-amber-500/80" />
        <p className="text-[11px] leading-relaxed text-amber-200/70">
          <span className="font-semibold text-amber-200">Budget, Rate, Deadline, Status are display / DB only</span> — editing them
          does NOT move on-chain escrow. To move real USDC use <span className="font-semibold text-emerald-300">Deposit to escrow</span> (funded v2 campaigns only).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-[#1e1e24] bg-[#0a0a0d] text-zinc-600">
              <th className="py-3 px-4 text-left font-medium">Campaign</th>
              <th className="py-3 px-4 text-left font-medium">Budget <span className="text-[9px] text-zinc-700">(DB)</span></th>
              <th className="py-3 px-4 text-left font-medium">Rate/1K <span className="text-[9px] text-zinc-700">(DB)</span></th>
              <th className="py-3 px-4 text-right font-medium">Subs</th>
              <th className="py-3 px-4 text-left font-medium">Deadline <span className="text-[9px] text-zinc-700">(DB)</span></th>
              <th className="py-3 px-4 text-left font-medium">Status <span className="text-[9px] text-zinc-700">(DB)</span></th>
              <th className="py-3 px-4 text-left font-medium">Creator</th>
              <th className="py-3 px-4 text-right font-medium">Escrow <span className="text-[9px] text-emerald-700">(on-chain)</span></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c: Doc<"campaigns">) => (
              <tr key={c._id} className="border-b border-[#16161a] last:border-0 hover:bg-white/[0.015]">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5">
                    <div className="size-7 rounded-lg overflow-hidden border border-[#27272a] shrink-0 bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {c.brandLogoUrl ? <img src={c.brandLogoUrl} alt="" className="w-full h-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white leading-tight truncate max-w-[220px]">{c.title}</p>
                      <p className="text-[10.5px] text-zinc-600">{c.brandName}</p>
                    </div>
                  </div>
                </td>
                {/* Budget — READ-ONLY (DB-only display; editing never moved escrow). */}
                <td className="py-3 px-4">
                  <span className="font-mono text-[11.5px] text-white">{fmtUsd(c.budget)}</span>
                </td>
                {/* Rate/1K — display + Edit; funded rows note the DB edit is display-only. */}
                <td className="py-3 px-4">
                  {isEditing(c._id, "rate") ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.01"
                          autoFocus
                          value={editing!.value}
                          onChange={(e) => setEditing({ id: c._id, field: "rate", value: e.target.value })}
                          className={`w-20 ${EDIT_INPUT}`}
                        />
                        <button onClick={() => saveEdit(c)} disabled={busy === `rate-${c._id}`} className={SAVE_BTN}>
                          {busy === `rate-${c._id}` ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Save
                        </button>
                        <button onClick={cancelEdit} className={CANCEL_BTN}>Cancel</button>
                      </div>
                      {isFundedV2(c) && (
                        <span className="text-[9.5px] leading-tight text-amber-300/70">Display only — funded; on-chain rate changes only via update_campaign_rate.</span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11.5px] text-white">{c.ratePerThousandViews}</span>
                      <button
                        onClick={() => openEdit(c._id, "rate", String(c.ratePerThousandViews))}
                        title={isFundedV2(c) ? "Edit the DB rate label (display only — the funded campaign pays on its on-chain rate)" : "Edit the DB rate"}
                        className={EDIT_BTN}
                      >
                        <Pencil className="size-2.5" /> Edit
                      </button>
                    </div>
                  )}
                </td>
                <td className="py-3 px-4 text-right font-mono text-zinc-400">{c.submissionsCount}</td>
                {/* Deadline — display + Edit; funded rows note the on-chain deadline is immutable. */}
                <td className="py-3 px-4">
                  {isEditing(c._id, "deadline") ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          autoFocus
                          value={editing!.value}
                          onChange={(e) => setEditing({ id: c._id, field: "deadline", value: e.target.value })}
                          className={`w-36 ${EDIT_INPUT} text-zinc-300`}
                        />
                        <button onClick={() => saveEdit(c)} disabled={busy === `deadline-${c._id}`} className={SAVE_BTN}>
                          {busy === `deadline-${c._id}` ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Save
                        </button>
                        <button onClick={cancelEdit} className={CANCEL_BTN}>Cancel</button>
                      </div>
                      {isFundedV2(c) && (
                        <span className="text-[9.5px] leading-tight text-amber-300/70">Display only — the on-chain deadline is immutable for funded campaigns.</span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[11.5px] text-zinc-300">{formatDeadline(c.deadline)}</span>
                      <button
                        onClick={() => openEdit(c._id, "deadline", deadlineToDateInput(c.deadline))}
                        title={isFundedV2(c) ? "Edit the DB deadline label (display only — the on-chain deadline can't change for funded campaigns)" : "Edit the DB deadline"}
                        className={EDIT_BTN}
                      >
                        <Pencil className="size-2.5" /> Edit
                      </button>
                    </div>
                  )}
                </td>
                {/* Status — display + Edit. */}
                <td className="py-3 px-4">
                  {isEditing(c._id, "status") ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        autoFocus
                        value={editing!.value}
                        onChange={(e) => setEditing({ id: c._id, field: "status", value: e.target.value })}
                        className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[11.5px] text-zinc-300 focus:outline-none focus:border-zinc-600"
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => saveEdit(c)} disabled={busy === `status-${c._id}`} className={SAVE_BTN}>
                        {busy === `status-${c._id}` ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Save
                      </button>
                      <button onClick={cancelEdit} className={CANCEL_BTN}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[11.5px] text-zinc-300 capitalize">{c.status}</span>
                      <button onClick={() => openEdit(c._id, "status", c.status)} title="Edit the DB status" className={EDIT_BTN}>
                        <Pencil className="size-2.5" /> Edit
                      </button>
                    </div>
                  )}
                </td>
                <td className="py-3 px-4 font-mono text-zinc-600 text-[10.5px]">{shortAddr(c.creatorWallet)}</td>
                <td className="py-3 px-4 text-right">
                  {isFundedV2(c) ? (
                    <button
                      onClick={() => setDepositing(c)}
                      title="Deposit real USDC into this campaign's on-chain escrow vault"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/60 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:border-emerald-600 hover:bg-emerald-500/15 transition-colors"
                    >
                      <ArrowDownToLine className="size-3" /> Deposit
                    </button>
                  ) : (
                    <button
                      onClick={() => setMigrating(c)}
                      title="Escrow-ify this campaign: create a funded on-chain USDC vault (deposit + rate only; metadata intact). Signs with the creator wallet."
                      className="inline-flex items-center gap-1.5 rounded-lg border border-violet-800/60 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-300 hover:border-violet-600 hover:bg-violet-500/15 transition-colors"
                    >
                      <Landmark className="size-3" /> Migrate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr><td colSpan={8} className="py-12 text-center text-zinc-700">No campaigns yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {depositing && <EscrowDepositModal campaign={depositing} onClose={() => setDepositing(null)} />}
      {migrating && (
        <MigrateVaultModal
          campaignId={String(migrating._id)}
          creatorWallet={migrating.creatorWallet}
          title={migrating.title}
          existingDeadline={migrating.deadline}
          onClose={() => setMigrating(null)}
        />
      )}
    </div>
  );
}
