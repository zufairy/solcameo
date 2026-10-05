"use client";

/**
 * "Migrate to on-chain vault" — escrow-ify an EXISTING off-chain campaign
 * (jobtepi/content-reward or v1 row with no funded vault) WITHOUT re-entering
 * any metadata. The operator enters only a deposit (USDC) + a per-1k rate; the
 * campaign's existing title/brief/requirements/images/links/platforms stay
 * exactly as they are. It becomes the SAME campaign row, now with a payout vault.
 *
 * NO new signing/tx code: reuses the audited create+fund path —
 *   buildEscrowProgram → createCampaignTx (create_campaign transfers the deposit
 *   into the PDA vault) → the SIWS-gated /api/campaigns/set-pda finalizer
 *   (secret-gated updateCampaignPda) — identical to CampaignForm.onSubmit and
 *   the Clipping-FR mirror. The double-charge safety is mirrored too: verify the
 *   vault on-chain before signing, and re-verify after a sign error so a landed-
 *   but-timed-out deposit finalizes with NO re-charge.
 *
 * The on-chain `create_campaign` binds the vault's creator to the SIGNER and the
 * PDA seed is [b"campaign", signer, campaignId]. The oracle/crank/Reclaim all
 * derive the PDA from `campaign.creatorWallet`, so the signing wallet MUST equal
 * the campaign's creator wallet — enforced here (an admin on a different wallet
 * is told to switch), else the vault would be unreachable by the payout rail.
 */

import { useMemo, useState } from "react";
import { useUnifiedSolanaWallet } from "@/hooks/use-solana-wallet";
import { useSiwsSession } from "@/hooks/use-siws-session";
import {
  buildEscrowProgram,
  createCampaignTx,
  checkVaultFunded,
  getCampaignPda,
} from "@/lib/escrow";
import {
  campaignDeadlineError,
  classifyLaunchError,
  CAMPAIGN_LAUNCH_SOL_ESTIMATE,
} from "@/lib/client/launchMachine";
import { deadlineForMigrationMs } from "@/lib/campaignMigrate";
import { getNetwork, getTxExplorerUrl, getAccountExplorerUrl } from "@/lib/solana/network";
import {
  Loader2, X, ShieldCheck, AlertTriangle, ExternalLink, ArrowUpRight, CheckCircle2,
} from "lucide-react";

interface MigrateVaultModalProps {
  /** The Convex campaign `_id` string — the SAME id used as the on-chain
   *  campaign_id / PDA seed by getCampaignPda + createCampaignTx everywhere. */
  campaignId: string;
  /** The campaign's creator wallet — MUST match the connected signing wallet. */
  creatorWallet: string;
  title: string;
  /** The campaign's existing deadline (ISO). Pre-fills the deadline input when
   *  it still falls inside the program's [now + 6h, now + 365d] window. */
  existingDeadline?: string;
  onClose: () => void;
  /** Fired after a successful migrate with the funded vault PDA. */
  onMigrated?: (pdaAddress: string) => void;
}

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const toDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function MigrateVaultModal({
  campaignId,
  creatorWallet,
  title,
  existingDeadline,
  onClose,
  onMigrated,
}: MigrateVaultModalProps) {
  const unified = useUnifiedSolanaWallet();
  const { ensureSiwsSession } = useSiwsSession();

  // Mount-time clock: keeps the render-path deadline validation PURE (no Date.now()
  // in render — react-compiler discipline). The modal is short-lived, so a few
  // minutes of drift is immaterial for a 6h..365d window; migrate() re-validates
  // against a fresh clock, and the on-chain program is the final authority.
  const [nowMs] = useState(() => Date.now());
  const [deposit, setDeposit] = useState("50");
  const [rate, setRate] = useState("3");
  // Pre-fill the deadline from the row when it's still program-valid, else +30d.
  const [deadline, setDeadline] = useState(() =>
    toDateInput(deadlineForMigrationMs(existingDeadline ? Date.parse(existingDeadline) : null, nowMs)),
  );
  const [phase, setPhase] = useState<"form" | "confirm">("form");
  const [step, setStep] = useState<"idle" | "signing" | "verifying" | "finalizing" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [pda, setPda] = useState<string | null>(null);

  const activeAddr = unified.publicKey?.toBase58() ?? null;
  const activeIsCreator = !!activeAddr && activeAddr === creatorWallet;

  const depositNum = Number(deposit);
  const rateNum = Number(rate);
  const depositValid = Number.isFinite(depositNum) && depositNum > 0;
  const rateValid = Number.isFinite(rateNum) && rateNum > 0;
  const deadlineErr = deadline
    ? campaignDeadlineError(new Date(deadline).getTime(), nowMs)
    : "Deadline required";
  const inputsValid = depositValid && rateValid && !deadlineErr;

  // Derive the escrow PDA the SAME way the create/oracle/reclaim paths do:
  // [b"campaign", creatorWallet, campaignId]. Shown before signing.
  const derivedPda = useMemo(() => {
    try {
      return getCampaignPda(campaignId, creatorWallet)[0].toBase58();
    } catch {
      return null;
    }
  }, [campaignId, creatorWallet]);

  const busy = step === "signing" || step === "verifying" || step === "finalizing";

  async function finalize(pdaAddress: string) {
    setStep("finalizing");
    // Re-bind SIWS to the active wallet right before the ownership-gated finalize
    // (no-op when still valid) so the server proves ownership against THIS wallet.
    if ((await ensureSiwsSession().catch(() => null)) === null) {
      throw new Error("Please approve the wallet signature to finalize.");
    }
    const resp = await fetch("/api/campaigns/set-pda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        pdaAddress,
        onchainVersion: 2,
        // Persist the terms ACTUALLY locked on-chain so the row mirrors the vault.
        budget: depositNum,
        ratePerThousandViews: rateNum,
        deadline: new Date(deadline).toISOString(),
      }),
    });
    if (!resp.ok) {
      throw new Error((await resp.json().catch(() => ({}))).error || "Finalize failed");
    }
  }

  async function migrate() {
    const pk = unified.publicKey;
    const signTx = unified.signTransaction;
    if (!unified.connected || !pk || !signTx) { setError("Connect your wallet first."); return; }
    if (!activeIsCreator) {
      setError(`Switch to the creator wallet (${shortAddr(creatorWallet)}) to migrate — the vault is bound to it.`);
      return;
    }
    // Re-validate against a FRESH clock (event handler — Date.now() is fine here)
    // so a deadline that drifted below the 6h floor while the modal sat open is
    // caught before prompting the wallet for a tx the program would revert.
    const freshDeadlineErr = deadline
      ? campaignDeadlineError(new Date(deadline).getTime(), Date.now())
      : "Deadline required";
    if (!depositValid || !rateValid || freshDeadlineErr) {
      setError(freshDeadlineErr || "Enter a positive deposit and rate.");
      return;
    }
    setError(null);
    setStep("signing");
    try {
      // Adapt the unified (Privy-aware) signer to Anchor's wallet shape — the SAME
      // shim the launch form + Reclaim use. Nothing new is signed here.
      const program = buildEscrowProgram({
        publicKey: pk,
        signTransaction: signTx,
        signAllTransactions: async (txs) => {
          const signed = [];
          for (const t of txs) signed.push(await signTx(t));
          return signed;
        },
      });

      // Pre-flight: if a vault for this (campaignId, creator) already holds the
      // deposit (a prior attempt that landed but timed out), skip straight to
      // finalize — never re-charge.
      let pdaAddress: string | undefined;
      let preFunded = false;
      try {
        const chk = await checkVaultFunded(campaignId, pk, depositNum);
        preFunded = chk.funded;
        if (preFunded) pdaAddress = chk.pdaAddress;
      } catch {
        /* vault ATA not created yet — treat as unfunded */
      }

      if (!preFunded) {
        const deadlineUnix = Math.floor(new Date(deadline).getTime() / 1000);
        try {
          // create_campaign TRANSFERS the deposit into the PDA vault (budget ==
          // deposit) — the single create+fund tx, identical to the launch form.
          const res = await createCampaignTx(program, campaignId, depositNum, rateNum, deadlineUnix);
          pdaAddress = res.pdaAddress;
          setTx(res.txSignature);
        } catch (err) {
          // Verify ON-CHAIN before surfacing a failure — a confirmation timeout
          // routinely fires even though the deposit landed. Re-read the SAME vault
          // (deterministic PDA): funded → finalize with NO re-charge; empty → an
          // honest, classified error.
          setStep("verifying");
          let after = false;
          try {
            const chk = await checkVaultFunded(campaignId, pk, depositNum);
            after = chk.funded;
            if (after) pdaAddress = chk.pdaAddress;
          } catch {
            /* keep false */
          }
          if (!after) {
            const cls = classifyLaunchError(err instanceof Error ? err.message : String(err));
            throw new Error(
              cls.deterministic
                ? cls.message
                : "We couldn't confirm your deposit yet. If your wallet shows it was sent, try again — " +
                    "we verify on-chain and never charge you twice.",
            );
          }
        }
      }

      if (!pdaAddress) throw new Error("No vault address after funding.");
      await finalize(pdaAddress);

      setPda(pdaAddress);
      setStep("success");
      onMigrated?.(pdaAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed");
      setStep("idle");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md rounded-2xl border border-emerald-900/50 bg-[#0d0d10] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="inline-flex items-center gap-2 text-[15px] font-bold text-white">
            <ShieldCheck className="size-4 text-emerald-400" /> Migrate to on-chain vault
          </h3>
          <button onClick={onClose} disabled={busy} className="text-zinc-500 hover:text-white disabled:opacity-40"><X className="size-4" /></button>
        </div>

        {step === "success" ? (
          <div className="mt-2 space-y-3">
            <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 px-4 py-3">
              <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-300">
                <CheckCircle2 className="size-4" /> {depositNum} USDC locked in escrow
              </p>
              <p className="mt-1 text-[11.5px] text-zinc-400">
                <span className="font-semibold text-white">{title}</span> now pays clippers on-chain per 1,000 verified views.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {tx && (
                  <a href={getTxExplorerUrl(tx)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-400 hover:underline">
                    Deposit tx <ExternalLink className="size-3" />
                  </a>
                )}
                {pda && (
                  <a href={getAccountExplorerUrl(pda)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-400 hover:underline">
                    Vault <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>
            <button onClick={onClose} className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12.5px] font-semibold py-2">Done</button>
          </div>
        ) : phase === "form" ? (
          <>
            <p className="text-[12px] text-zinc-400 leading-relaxed">
              Give <span className="font-semibold text-white">{title}</span> a real USDC payout vault. Only the deposit
              and rate are needed — the title, brief, requirements, images and sources stay exactly as they are.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block text-[11px] text-zinc-500">
                Deposit (USDC)
                <input
                  type="number" min={0} step="0.01" autoFocus value={deposit}
                  onChange={(e) => { setDeposit(e.target.value); setError(null); }}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[13px] text-white font-mono focus:outline-none focus:border-emerald-700"
                />
              </label>
              <label className="block text-[11px] text-zinc-500">
                Rate ($/1K views)
                <input
                  type="number" min={0} step="0.01" value={rate}
                  onChange={(e) => { setRate(e.target.value); setError(null); }}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[13px] text-white font-mono focus:outline-none focus:border-emerald-700"
                />
              </label>
            </div>

            <label className="block mt-3 text-[11px] text-zinc-500">
              Deadline
              <input
                type="date" value={deadline}
                onChange={(e) => { setDeadline(e.target.value); setError(null); }}
                className="mt-1 w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-[13px] text-white font-mono focus:outline-none focus:border-emerald-700"
              />
              <span className="mt-1 block text-[10.5px] text-zinc-600">
                Pre-filled from the campaign. Must be 6 hours to 1 year out (program bounds).
              </span>
            </label>

            {deadline && deadlineErr && (
              <p className="mt-2 text-[11.5px] text-amber-400">{deadlineErr}</p>
            )}
            {!activeIsCreator && (
              <p className="mt-3 inline-flex items-start gap-1.5 text-[11.5px] text-amber-400">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                {activeAddr
                  ? `Switch to the creator wallet (${shortAddr(creatorWallet)}) to sign — the vault binds to it.`
                  : "Connect the creator wallet to migrate."}
              </p>
            )}
            {error && (
              <p className="mt-3 inline-flex items-start gap-1.5 text-[11.5px] text-amber-400">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white text-[12.5px]">Cancel</button>
              <button
                onClick={() => { setError(null); setPhase("confirm"); }}
                disabled={!inputsValid || !activeIsCreator}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12.5px] font-semibold inline-flex items-center gap-2"
              >
                Review <ArrowUpRight className="size-3.5" />
              </button>
            </div>
          </>
        ) : (
          // ── Confirm step ──
          <>
            <p className="text-[12px] text-zinc-400 leading-relaxed">
              <span className="font-semibold text-emerald-300">Confirm.</span> Your connected wallet signs a real USDC
              deposit into a new vault for <span className="font-semibold text-white">{title}</span> on{" "}
              <span className="font-semibold text-white">{getNetwork()}</span>.
            </p>

            <div className="mt-4 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3.5 py-3 text-[12px]">
              <Row label="Deposit" value={`${depositNum} USDC`} strong />
              <Row label="Rate" value={`$${rateNum.toFixed(2)} / 1K views`} />
              <Row label="Deadline" value={new Date(deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
              <Row label="Network fee (est.)" value={`~${CAMPAIGN_LAUNCH_SOL_ESTIMATE} SOL`} />
              <div className="border-t border-zinc-800 pt-2">
                <p className="text-[10.5px] uppercase tracking-wider text-zinc-600">Escrow vault (PDA)</p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-300 break-all">{derivedPda ?? "—"}</p>
              </div>
              <div className="border-t border-zinc-800 pt-2 flex items-center justify-between">
                <span className="text-zinc-500">Total to send</span>
                <span className="font-mono font-bold text-emerald-400">{depositNum} USDC + ~{CAMPAIGN_LAUNCH_SOL_ESTIMATE} SOL</span>
              </div>
            </div>

            {error && (
              <p className="mt-3 inline-flex items-start gap-1.5 text-[11.5px] text-amber-400">
                <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> {error}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => { setPhase("form"); setError(null); }} disabled={busy} className="px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white text-[12.5px] disabled:opacity-40">Back</button>
              <button
                onClick={migrate}
                disabled={busy || !activeIsCreator}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12.5px] font-semibold inline-flex items-center gap-2"
              >
                {busy
                  ? <><Loader2 className="size-3.5 animate-spin" />{step === "signing" ? "Approve in wallet…" : step === "verifying" ? "Verifying on-chain…" : "Finalizing…"}</>
                  : <><ShieldCheck className="size-3.5" /> Migrate &amp; deposit</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className={strong ? "font-mono font-bold text-white" : "font-mono text-zinc-300"}>{value}</span>
    </div>
  );
}
