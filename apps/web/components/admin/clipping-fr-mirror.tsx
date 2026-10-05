"use client";

/**
 * Admin panel: mirror jobtepi clipping campaigns into "Clipping FR" — one
 * funded on-chain USDC campaign treasury per clipping content_reward, at the
 * RM 100 → 1 USDC scale (RM 5,000 budget → 50 USDC vault, RM 8/1K → 0.08/1K).
 *
 * The connected admin wallet is the creator AND funder: each pending campaign
 * costs one wallet signature and deposits its converted budget into its own
 * vault PDA. All money-path decisions live in lib/clippingFr (unit-tested);
 * this component only wires them to the real Convex mutation + escrow client.
 * The run reuses the launch form's double-charge safety: verify the vault
 * on-chain before signing, and re-verify after a sign error.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useWalletUsdc, useWalletSol, checkFunding, SOL_GAS_FLOOR } from "@/lib/client/usdcClient";
import { buildEscrowProgram, createCampaignTx, checkVaultFunded, getCampaignPda } from "@/lib/escrow";
import { getContentRewards, type ContentReward } from "@/lib/content-rewards";
import {
  MYR_PER_USDC,
  CLIPPING_FR_DURATION_MS,
  planClippingFrMirror,
  runClippingFrMirror,
  resolveMirrorAmounts,
  resolveMirrorDeadline,
  type ClippingFrCreateArgs,
  type MirrorCampaignRow,
  type MirrorItemResult,
  type MirrorOps,
  type MirrorOverride,
} from "@/lib/clippingFr";
import { campaignDeadlineError } from "@/lib/client/launchMachine";
import {
  Scissors, Loader2, Wallet, CheckCircle2, AlertTriangle, ArrowRight, Landmark, XCircle, Clock,
} from "lucide-react";

const fmtUsdc = (n: number) =>
  `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
const fmtSrc = (n: number, currency?: string) =>
  `${(currency ?? "MYR").toUpperCase() === "MYR" ? "RM" : "$"}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Epoch ms → the local "YYYY-MM-DDTHH:mm" a <input type="datetime-local"> wants.
 *  datetime-local carries no timezone, so it round-trips through the local clock:
 *  `new Date(str)` parses it back as local time. */
const msToLocalInput = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const RESULT_META: Record<MirrorItemResult["status"], { label: string; className: string }> = {
  funded: { label: "Funded", className: "bg-emerald-500/12 text-emerald-400" },
  "already-funded": { label: "Already funded", className: "bg-zinc-500/12 text-zinc-400" },
  failed: { label: "Failed", className: "bg-red-500/12 text-red-400" },
  skipped: { label: "Skipped", className: "bg-zinc-500/12 text-zinc-500" },
  "halted-funds": { label: "Needs funds", className: "bg-amber-500/12 text-amber-400" },
};

export function ClippingFrMirror() {
  const { publicKey, signTransaction, connected } = useUnifiedSolanaWallet();
  const rawCampaigns = useQuery(api.campaigns.list);
  const createCampaign = useMutation(api.campaigns.create);
  const { usdc, refresh: refreshUsdc } = useWalletUsdc();
  const { sol, refresh: refreshSol } = useWalletSol();

  const [rewards, setRewards] = useState<ContentReward[] | null>(null);
  const [running, setRunning] = useState(false);
  // The content-reward id of the single row being mirrored, or null for a batch /
  // idle run. Drives the per-row spinner without changing the shared `running` gate.
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<MirrorItemResult[]>([]);
  const [haltReason, setHaltReason] = useState<"usdc" | "sol" | null>(null);
  // Per-campaign manual override of deposit/rate/deadline, keyed by content-reward
  // id. Raw strings so the inputs stay fully editable; parsed at display/run. A
  // field absent (or blank) from a row's entry = "use the auto value" (RM→USDC for
  // deposit/rate, now+180d for the deadline).
  const [overrides, setOverrides] = useState<Record<string, { budget?: string; rate?: string; deadline?: string }>>({});
  // Mount-time clock: react-compiler forbids Date.now() in render, so the deadline
  // picker default (now+180d) and its window validation read this instead. The run
  // itself re-reads the real clock; a long-open panel just means a slightly stale
  // default, and the orchestrator re-validates against run-time now regardless.
  const [nowMs, setNowMs] = useState(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    setNowMs(Date.now());
    let alive = true;
    getContentRewards()
      .then((data) => { if (alive) setRewards(data); })
      .catch(() => { if (alive) setRewards([]); });
    return () => { alive = false; };
  }, []);

  // Isolate the planner from stale _generated types: map docs to the exact row
  // shape it reads (`origin` is new in the schema until the next codegen).
  const campaignRows: MirrorCampaignRow[] = useMemo(
    () =>
      (rawCampaigns ?? []).map((c: NonNullable<typeof rawCampaigns>[number]) => ({
        _id: String(c._id),
        contentRewardId: c.contentRewardId,
        origin: (c as { origin?: string }).origin,
        pdaAddress: c.pdaAddress,
        onchainVersion: c.onchainVersion,
        budget: c.budget,
        ratePerThousandViews: c.ratePerThousandViews,
        deadline: c.deadline,
      })),
    [rawCampaigns],
  );

  const wallet58 = publicKey?.toBase58() ?? "";
  const displayPlan = useMemo(() => {
    if (!rewards) return null;
    // nowMs: 0 keeps this render-path plan PURE (react-compiler forbids
    // Date.now() in render). Only item kinds/budgets/rates are displayed —
    // deadlines are re-locked from the real clock inside run().
    return planClippingFrMirror(rewards, campaignRows, {
      creatorWallet: wallet58 || "pending-wallet",
      nowMs: 0,
    });
  }, [rewards, campaignRows, wallet58]);

  const loading = rewards === null || rawCampaigns === undefined;
  const pending = useMemo(() => (displayPlan ?? []).filter((i) => i.kind !== "done"), [displayPlan]);
  const mirrored = (displayPlan?.length ?? 0) - pending.length;

  // Pair every pending item with its RM→USDC auto terms, the operator's raw
  // override strings, the resolved EFFECTIVE deposit/rate, and per-field validity
  // (deposit > 0 AND rate > 0). One place drives the row UI, the funds total, and
  // the run gate.
  const rows = useMemo(() => {
    // Auto deadline default is now+180d, computed from the mount clock (0 until the
    // mount effect runs — the picker/validation stay inert for that first frame).
    const defaultDeadlineMs = nowMs > 0 ? nowMs + CLIPPING_FR_DURATION_MS : 0;
    return pending.map((item) => {
      const auto =
        item.kind === "create"
          ? { budget: item.args.budget, rate: item.args.ratePerThousandViews }
          : item.kind === "resume"
            ? { budget: item.budget, rate: item.ratePerThousandViews }
            : { budget: 0, rate: 0 };
      const ov = overrides[item.reward.id];
      const budgetTouched = ov?.budget !== undefined;
      const rateTouched = ov?.rate !== undefined;
      const budgetNum = budgetTouched ? Number(ov?.budget) : auto.budget;
      const rateNum = rateTouched ? Number(ov?.rate) : auto.rate;
      const budgetValid = Number.isFinite(budgetNum) && budgetNum > 0;
      const rateValid = Number.isFinite(rateNum) && rateNum > 0;
      const resolved = resolveMirrorAmounts(
        { budgetUsdc: auto.budget, ratePerThousandViews: auto.rate },
        {
          budgetUsdc: budgetTouched && budgetValid ? budgetNum : undefined,
          ratePerThousandViews: rateTouched && rateValid ? rateNum : undefined,
        },
      );

      // Deadline: a blank/absent box uses the now+180d default; a picked value
      // overrides it. Validate the EFFECTIVE deadline against the on-chain window
      // with the SAME validator the run uses, so a bad pick blocks this row's
      // buttons (matching the orchestrator's refusal) before it can revert on-chain.
      const deadlineTouched = ov?.deadline !== undefined && ov.deadline !== "";
      const effDeadlineMs = deadlineTouched ? new Date(ov!.deadline as string).getTime() : defaultDeadlineMs;
      const deadlineError =
        nowMs > 0 ? campaignDeadlineError(effDeadlineMs, nowMs) : null;
      const deadlineValid = deadlineError === null;
      const deadlineStr = deadlineTouched
        ? (ov!.deadline as string)
        : defaultDeadlineMs > 0
          ? msToLocalInput(defaultDeadlineMs)
          : "";

      return {
        item,
        rewardId: item.reward.id,
        budgetStr: ov?.budget ?? String(auto.budget),
        rateStr: ov?.rate ?? String(auto.rate),
        deadlineStr,
        effDeadlineMs,
        budgetValid,
        rateValid,
        deadlineValid,
        deadlineError,
        valid: budgetValid && rateValid && deadlineValid,
        effBudget: resolved.budgetUsdc,
        effRate: resolved.ratePerThousandViews,
        overridden: resolved.overridden || budgetTouched || rateTouched || deadlineTouched,
      };
    });
  }, [pending, overrides, nowMs]);

  const hasInvalid = rows.some((r) => !r.valid);
  const pendingUsdc = rows.reduce((s, r) => s + (r.budgetValid ? r.effBudget : 0), 0);

  const setOverride = (id: string, field: "budget" | "rate" | "deadline", value: string) =>
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  // Mirror the whole pending batch, or — when `onlyRewardId` is passed — just that
  // ONE row (a pure slice of the same plan). The single-row path reuses every ops
  // wire, gate, and double-charge safety unchanged; it only narrows the plan.
  async function run(onlyRewardId?: string) {
    if (inFlightRef.current || !rewards || !publicKey || !signTransaction) return;
    if (onlyRewardId) {
      const r = rows.find((x) => x.rewardId === onlyRewardId);
      if (!r || !r.valid) return; // that one row's deposit/rate/deadline must be valid
    } else if (hasInvalid) {
      return;
    }
    inFlightRef.current = true;
    setRunning(true);
    setRunningId(onlyRewardId ?? null);
    setResults([]);
    setHaltReason(null);
    try {
      // Re-plan at run time so deadlines are locked from NOW, not from mount.
      const runNowMs = Date.now();
      const plan = planClippingFrMirror(rewards, campaignRows, {
        creatorWallet: publicKey.toBase58(),
        nowMs: runNowMs,
      })
        .filter((i) => i.kind !== "done")
        .filter((i) => (onlyRewardId ? i.reward.id === onlyRewardId : true));

      const program = buildEscrowProgram({
        publicKey,
        signTransaction,
        signAllTransactions: async (txs) => {
          const signed = [];
          for (const t of txs) signed.push(await signTransaction(t));
          return signed;
        },
      });

      // Cast: `origin`/`campaignImageUrl` are new create() args; _generated
      // mutation types lag until the next codegen. Runtime-validated by Convex.
      const createRow = createCampaign as unknown as (args: ClippingFrCreateArgs) => Promise<string>;

      const ops: MirrorOps = {
        createRow: async (args) => String(await createRow(args)),
        checkFunding: async (budget) => {
          const [u, s] = await Promise.all([refreshUsdc(), refreshSol()]);
          return checkFunding({ usdc: u ?? usdc, sol: s ?? sol, budget });
        },
        vaultFunded: async (campaignId, budget) =>
          (await checkVaultFunded(campaignId, publicKey, budget)).funded,
        signCreateCampaign: async (campaignId, budget, rate, deadlineUnix) => {
          const res = await createCampaignTx(program, campaignId, budget, rate, deadlineUnix);
          return { pdaAddress: res.pdaAddress };
        },
        derivePda: (campaignId) => getCampaignPda(campaignId, publicKey)[0].toBase58(),
        finalize: async (campaignId, pdaAddress, terms) => {
          // SIWS-gated route → secret-gated updateCampaignPda (flips the row to
          // the funded v2 rail + links the content reward).
          const resp = await fetch("/api/campaigns/set-pda", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaignId,
              pdaAddress,
              onchainVersion: 2,
              budget: terms.budget,
              ratePerThousandViews: terms.ratePerThousandViews,
              deadline: terms.deadline,
              contentRewardId: terms.contentRewardId,
            }),
          });
          if (!resp.ok) {
            throw new Error((await resp.json().catch(() => ({}))).error || `Finalize failed (${resp.status})`);
          }
        },
      };

      // Per-campaign manual overrides, keyed by content-reward id. Only touched
      // fields are threaded through; an absent field keeps the auto value (RM→USDC
      // for deposit/rate, now+180d for the deadline). A blank deadline box = auto.
      const overrideMap: Record<string, MirrorOverride> = {};
      for (const [id, ov] of Object.entries(overrides)) {
        overrideMap[id] = {
          budgetUsdc: ov.budget !== undefined ? Number(ov.budget) : undefined,
          ratePerThousandViews: ov.rate !== undefined ? Number(ov.rate) : undefined,
          overrideDeadlineMs:
            ov.deadline !== undefined && ov.deadline !== "" ? new Date(ov.deadline).getTime() : undefined,
        };
      }

      const out = await runClippingFrMirror(plan, ops, (done) => setResults([...done]), overrideMap, runNowMs);
      setHaltReason(out.haltReason);
    } finally {
      inFlightRef.current = false;
      setRunning(false);
      setRunningId(null);
      void refreshUsdc();
      void refreshSol();
    }
  }

  return (
    <section className="space-y-4 pt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Scissors className="size-4 text-violet-400" />
        <h2 className="text-[15px] font-bold text-white">Clipping FR — on-chain mirror</h2>
        <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-violet-500/12 text-violet-300">
          RM {MYR_PER_USDC} → 1 USDC
        </span>
        {!loading && (
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/12 text-emerald-400">
            {mirrored}/{displayPlan?.length ?? 0} mirrored
          </span>
        )}
      </div>
      <p className="text-[12px] text-zinc-600 -mt-1 max-w-3xl">
        Mints one on-chain USDC campaign treasury per jobtepi <span className="text-zinc-400">clipping</span> campaign
        (budget and reward rate ÷ {MYR_PER_USDC}), linked back via its content-reward id so agent clips are paid from
        that vault per 1,000 verified views. Your connected admin wallet funds each vault — one signature per campaign.
        The legacy Clipping tab keeps running untouched.
      </p>

      <div className="rounded-2xl border border-[#1e1e24] bg-[#0d0d10] p-4 space-y-3">
        {loading ? (
          <span className="inline-flex items-center gap-2 text-[12.5px] text-zinc-600">
            <Loader2 className="size-4 animate-spin" /> Reading clipping campaigns + treasuries…
          </span>
        ) : pending.length === 0 ? (
          <span className="inline-flex items-center gap-2 text-[12.5px] text-emerald-400">
            <CheckCircle2 className="size-4" /> Every active clipping campaign already has its own funded USDC treasury.
          </span>
        ) : (
          <>
            <div className="space-y-2.5">
              {rows.map((r) => {
                const item = r.item;
                const rowResult = results.find((x) => x.rewardId === r.rewardId);
                const rowMeta = rowResult ? RESULT_META[rowResult.status] : null;
                return (
                  <div key={r.rewardId} className="space-y-1">
                    <div className="flex items-center gap-2.5 text-[12.5px] flex-wrap">
                      <Landmark className="size-3.5 text-zinc-600 shrink-0" />
                      <span className="font-semibold text-white truncate max-w-[240px]">{item.reward.campaign_name}</span>
                      {item.kind === "resume" && (
                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/12 text-amber-400">resume draft</span>
                      )}
                      <span className="font-mono tabular-nums text-zinc-500">
                        {fmtSrc(Number(item.reward.budget) || 0, item.reward.currency)}
                      </span>
                      <ArrowRight className="size-3 text-zinc-700" />
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                          r.overridden ? "bg-amber-500/12 text-amber-400" : "bg-zinc-500/12 text-zinc-500"
                        }`}
                      >
                        {r.overridden ? "Custom" : "Auto RM→USDC"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pl-6 text-[11px]">
                      <label className="inline-flex items-center gap-1.5 text-zinc-500">
                        Deposit
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={r.budgetStr}
                          onChange={(e) => setOverride(r.rewardId, "budget", e.target.value)}
                          disabled={running}
                          className={`w-24 h-7 rounded-md bg-[#08080a] border px-2 font-mono tabular-nums text-[12px] text-emerald-300 outline-none focus:border-violet-500/50 disabled:opacity-60 ${
                            r.budgetValid ? "border-[#26262c]" : "border-red-500/50"
                          }`}
                        />
                        <span className="text-zinc-600">USDC</span>
                      </label>
                      <span className="text-zinc-700">·</span>
                      <label className="inline-flex items-center gap-1.5 text-zinc-500">
                        Rate
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={r.rateStr}
                          onChange={(e) => setOverride(r.rewardId, "rate", e.target.value)}
                          disabled={running}
                          className={`w-20 h-7 rounded-md bg-[#08080a] border px-2 font-mono tabular-nums text-[12px] text-emerald-300 outline-none focus:border-violet-500/50 disabled:opacity-60 ${
                            r.rateValid ? "border-[#26262c]" : "border-red-500/50"
                          }`}
                        />
                        <span className="text-zinc-600">$/1K views</span>
                      </label>
                      {r.budgetValid && r.rateValid ? (
                        <span className="text-zinc-600">
                          → deposits <span className="font-mono tabular-nums text-emerald-400">{fmtUsdc(r.effBudget)}</span>{" "}
                          + ~<span className="font-mono tabular-nums text-zinc-400">{SOL_GAS_FLOOR}</span> SOL gas
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-400">
                          <AlertTriangle className="size-3" /> Deposit and rate must both be greater than 0
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pl-6 text-[11px]">
                      <label className="inline-flex items-center gap-1.5 text-zinc-500">
                        Deadline
                        <input
                          type="datetime-local"
                          value={r.deadlineStr}
                          onChange={(e) => setOverride(r.rewardId, "deadline", e.target.value)}
                          disabled={running}
                          className={`h-7 rounded-md bg-[#08080a] border px-2 text-[12px] text-emerald-300 outline-none focus:border-violet-500/50 disabled:opacity-60 [color-scheme:dark] ${
                            r.deadlineValid ? "border-[#26262c]" : "border-red-500/50"
                          }`}
                        />
                      </label>
                      {r.deadlineError && (
                        <span className="inline-flex items-center gap-1 text-red-400">
                          <AlertTriangle className="size-3" /> {r.deadlineError}
                        </span>
                      )}
                      <span className="flex-1" />
                      {rowMeta && (
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${rowMeta.className}`}>
                          {rowMeta.label}
                        </span>
                      )}
                      <button
                        onClick={() => void run(r.rewardId)}
                        disabled={!connected || !publicKey || running || !r.valid}
                        title={r.valid ? "Mirror just this campaign on-chain" : "Fix this row's deposit / rate / deadline first"}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-bold bg-violet-500/12 text-violet-300 border border-violet-500/20 hover:bg-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {running && runningId === r.rewardId ? (
                          <><Loader2 className="size-3 animate-spin" /> Mirroring…</>
                        ) : (
                          <><Scissors className="size-3" /> Mirror</>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-3 flex-wrap pt-1">
              <button
                onClick={() => void run()}
                disabled={!connected || !publicKey || running || hasInvalid}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[12px] font-bold bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {running
                  ? (<><Loader2 className="size-3.5 animate-spin" /> Mirroring… approve each deposit in your wallet</>)
                  : connected
                    ? (<><Scissors className="size-3.5" /> Mirror {pending.length} campaign{pending.length === 1 ? "" : "s"} on-chain</>)
                    : (<><Wallet className="size-3.5" /> Connect a wallet to mirror</>)}
              </button>
              {hasInvalid ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
                  <AlertTriangle className="size-3" /> Fix the highlighted deposit/rate/deadline before mirroring
                </span>
              ) : (
                <span className="text-[11px] text-zinc-600">
                  needs ~<span className="text-zinc-400 font-mono tabular-nums">{fmtUsdc(pendingUsdc)}</span> + SOL gas ·{" "}
                  {pending.length} wallet approval{pending.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </>
        )}

        {haltReason && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-900/40 bg-amber-500/[0.05] px-3 py-2.5 text-[12px] text-amber-300">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              Stopped: the admin wallet needs more {haltReason.toUpperCase()} to fund the next vault. Top it up and run
              the mirror again — finished vaults are kept and never charged twice.
            </span>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-1.5 border-t border-[#16161a] pt-3">
            {results.map((r) => {
              const meta = RESULT_META[r.status];
              const Icon = r.status === "funded" || r.status === "already-funded"
                ? CheckCircle2
                : r.status === "failed" ? XCircle
                : r.status === "halted-funds" ? AlertTriangle
                : Clock;
              return (
                <div key={r.rewardId} className="flex items-start gap-2 text-[12px]">
                  <Icon className={`size-3.5 shrink-0 mt-0.5 ${r.status === "funded" ? "text-emerald-400" : r.status === "failed" ? "text-red-400" : "text-zinc-500"}`} />
                  <span className="text-zinc-300 font-semibold">{r.title}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${meta.className}`}>{meta.label}</span>
                  {r.error && <span className="text-zinc-600 min-w-0 break-words">{r.error}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
