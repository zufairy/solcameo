/**
 * On-chain compute-tab settlement via the agent-vault program.
 *
 * `sweepAgentTabOnchain` REPLACES the custodial `transferUsdc` sweep: instead of
 * moving USDC from the agent's custodial wallet, it charges the fee straight out
 * of the agent's program-owned vault via `debit_fee` (vault → platform treasury).
 * The platform vault-authority signs AND pays rent, so the agent needs no SOL and
 * no wallet secret.
 *
 * Idempotency is provided ON-CHAIN: `debit_fee` writes a FeeRecord PDA keyed by
 * (vault, runId). A collapsed settlement can EXCEED the vault's per-run cap, so we
 * SPLIT it into ceil(amount/cap) chunks each <= the cap (READ from the vault, not
 * hardcoded) with runId `${settlementId}#${i}` — one FeeRecord per chunk. A
 * replayed sweep re-derives the same per-chunk runIds and reads each FeeRecord PDA
 * FIRST (on-chain truth, MED-C), skipping the chunks already swept. This is why the
 * callers can safely RELEASE a failed sweep for a fast retry: a re-attempt can
 * never double-charge. A chunk that reverts `FeeExceedsCap` and can never land is
 * TERMINAL (marked, never released) so the settlement isn't re-collapsed forever
 * (HIGH-1).
 *
 * `resolveAgentOnchainUsdc` is the read side used by the reconcile drivers: it
 * returns the balance of the CUSTODIAL agent wallet — the account investors actually
 * deposit into (buy-shares) and redemptions pay out of — which is the true NAV
 * backing, even for a vault-enabled agent (H5).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { generationCollectionWallet } from "@/lib/server/generationCollectionWallet";
import { ensureAgentGas, feePayerReady } from "@/lib/server/solSwap";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { loadKeypair, getUsdcBalanceStrict, transferUsdc } from "@/lib/trader/usdcTransfer";
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";
import { sendAlert } from "@/lib/server/alert";
import { getUsdcMint } from "@/lib/solana/network";
import {
  buildAgentVaultProgram,
  debitFeeTx,
  fetchVault,
  getFeeRecordPda,
  getVaultPda,
  getVaultConnection,
  getVaultUsdcAta,
  runIdToBytes,
  USDC_DECIMALS,
} from "@/lib/agentVault";

const TREASURY = generationCollectionWallet();

/**
 * Terminal marker stamped into `feeSettlements.txSignature` when a `debit_fee`
 * chunk's FeeRecord already exists on-chain — the fee was swept on a PRIOR attempt
 * but that tx signature isn't recoverable from the FeeRecord. It is non-empty and
 * carries no `INFLIGHT:` prefix, so `isPaidSig()` treats the settlement as
 * terminally paid (never re-driven).
 */
export const ONCHAIN_FEE_ALREADY_PROCESSED = "onchain:fee-record-exists";

/**
 * Terminal marker for a settlement chunk that reverted `FeeExceedsCap` and can
 * NEVER succeed (its amount is above the vault's on-chain per-run cap and we
 * couldn't chunk it under — e.g. the cap read failed, or the cap shrank). We stamp
 * this instead of releasing for retry so the settlement is NOT re-collapsed +
 * re-swept forever (which would freeze the reconcile-held amount permanently). It
 * is non-empty + INFLIGHT-free, so `isPaidSig()` treats it as terminal. This is a
 * loud, alerted give-up (HIGH-1), never a silent one.
 */
export const ONCHAIN_FEE_EXCEEDS_CAP_TERMINAL = "onchain:fee-exceeds-cap-terminal";

/**
 * Terminal marker for a `debit_fee` that reverted with a vault MISCONFIGURATION
 * that can NEVER self-resolve by retrying: the destination is not the vault's
 * configured treasury (InvalidTreasury 0x1775 — the env-rotation strand), the
 * signer is not the vault authority (Unauthorized 0x1773), or a token-account
 * mint mismatch (MintMismatch 0x1774). Left un-terminalized these loop forever in
 * the reconcile keeper, freezing the held amount. We stamp this + `sendAlert` so
 * the loop stops loudly, awaiting a human fix (re-point the vault treasury /
 * authority). Non-empty + INFLIGHT-free ⇒ `isPaidSig()` treats it as terminal.
 */
export const ONCHAIN_FEE_TREASURY_MISCONFIG_TERMINAL = "onchain:fee-treasury-misconfig-terminal";

/**
 * The uniform result of a compute-tab sweep, whether it went through the on-chain
 * vault (`debit_fee`) path or the CUSTODIAL (`transferUsdc`) fallback.
 *
 *   - `{ ok: true, txSignature }`  — swept (or terminal-marked); caller marks paid.
 *   - `{ ok: true }` (no sig)      — already swept (idempotent replay); caller marks paid.
 *   - `{ ok: false, ambiguous: true, txSignature, lastValidBlockHeight }`
 *                                  — CUSTODIAL confirm-ambiguity: a transfer was
 *                                    broadcast but not confirmed, so the USDC MAY
 *                                    have moved. The caller MUST stamp
 *                                    markSettlementConfirmAmbiguous (NEVER release):
 *                                    recover-settlements then verifies the sig
 *                                    on-chain (getSignatureStatus + blockhash
 *                                    expiry) before EVER re-transferring — the
 *                                    no-double-spend guarantee for the non-idempotent
 *                                    transferUsdc path.
 *   - `{ ok: false }` (no sig)     — pre-broadcast failure / vault transient; SAFE
 *                                    to release + retry (nothing moved).
 */
export interface SweepResult {
  retryDelayMs?: number;
  reason?: string;
  ok: boolean;
  txSignature?: string;
  /** Set only on a CUSTODIAL confirm-ambiguous sweep — see SweepResult docs. */
  ambiguous?: boolean;
  /** The ambiguous sig's blockhash lastValidBlockHeight (blockhash-expiry proof). */
  lastValidBlockHeight?: number;
}

function requireVaultAuthority() {
  const secret = process.env.PLATFORM_VAULT_AUTHORITY_SECRET?.trim();
  if (!secret) throw new Error("PLATFORM_VAULT_AUTHORITY_SECRET not configured — cannot sweep compute tab on-chain");
  return loadKeypair(secret);
}

/** Lowercased haystack of everything an on-chain error carries (message + program
 *  logs + stringified form) so failure classifiers can substring-match it. */
function errText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error) parts.push(err.message);
  const withLogs = err as { logs?: unknown };
  if (Array.isArray(withLogs?.logs)) parts.push(withLogs.logs.join(" "));
  parts.push(String(err));
  return parts.join(" ").toLowerCase();
}

/**
 * True when a `debit_fee` failure is the idempotent FeeRecord-collision replay
 * (this runId was already swept). The FeeRecord PDA is created with `init`, so a
 * repeat aborts with an "already in use" account error; some RPCs phrase a
 * duplicate as "already processed". Any of these means the fee already moved and
 * is SAFE to treat as success. NOTE: this is a best-effort SUBSTRING fallback — the
 * authoritative check is the on-chain FeeRecord read in `feeRecordExists` (MED-C),
 * which classifies confirm-timeouts correctly even when the RPC hides the real
 * revert behind a generic transport error.
 */
function isFeeRecordCollision(err: unknown): boolean {
  const msg = errText(err);
  return (
    msg.includes("already in use") ||
    msg.includes("already processed") ||
    msg.includes("already been processed")
  );
}

/** True when a `debit_fee` reverted with the vault's `FeeExceedsCap` (custom error
 *  6002 = 0x1772): the chunk amount is above the on-chain per-run cap. */
function isFeeExceedsCap(err: unknown): boolean {
  const msg = errText(err);
  return msg.includes("feeexceedscap") || msg.includes("fee exceeds") || msg.includes("0x1772");
}

/**
 * True when a `debit_fee` reverted with a TERMINAL vault misconfiguration that a
 * retry can never fix:
 *   - InvalidTreasury (6005 = 0x1775): the treasury ATA passed no longer matches
 *     the vault's on-chain `treasury` — i.e. NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET
 *     was rotated after the vault was init'd (the env-rotation strand).
 *   - Unauthorized  (6003 = 0x1773): the signer isn't the vault's authority.
 *   - MintMismatch  (6004 = 0x1774): a token account's mint isn't the vault USDC mint.
 *
 * Matches the anchor CODE NAMES + hex codes + the on-chain `#[msg]` phrasings —
 * NOT the bare word "unauthorized", which a transport-layer 401 could carry and
 * would wrongly terminalize a mere RPC hiccup. These faults must be alerted +
 * marked terminal, never retry-released (which loops forever).
 */
function isTerminalVaultMisconfig(err: unknown): boolean {
  const msg = errText(err);
  return (
    msg.includes("invalidtreasury") ||
    msg.includes("0x1775") ||
    msg.includes("not the vault's configured treasury") ||
    msg.includes("mintmismatch") ||
    msg.includes("0x1774") ||
    msg.includes("mint does not match the vault usdc mint") ||
    msg.includes("not authorized for this vault") ||
    msg.includes("0x1773")
  );
}

/** Read the vault's on-chain per-run cap (base units → USDC) from a `fetchVault`
 *  result. Null when it can't be read/parsed — callers then attempt a single
 *  un-chunked debit and rely on the FeeExceedsCap-terminal backstop rather than
 *  hardcoding a cap. Handles the anchor BN, plus number/bigint/string. */
function readMaxFeePerRunUsdc(vaultState: { maxFeePerRun?: unknown } | null): number | null {
  const raw = vaultState?.maxFeePerRun;
  if (raw == null) return null;
  let base: number;
  if (typeof raw === "number") base = raw;
  else if (typeof raw === "bigint") base = Number(raw);
  else if (typeof (raw as { toNumber?: () => number }).toNumber === "function") {
    try { base = (raw as { toNumber: () => number }).toNumber(); }
    catch { base = Number((raw as { toString: () => string }).toString()); }
  } else base = Number(raw);
  if (!Number.isFinite(base) || base <= 0) return null;
  return base / 10 ** USDC_DECIMALS;
}

/**
 * Split a settlement amount into sequential `debit_fee` chunks each <= `capUsdc`
 * (HIGH-1). A collapsed settlement can exceed the vault's per-run cap (two clip
 * runs > $5, daily cap $10) — one debit_fee would revert `FeeExceedsCap` forever.
 * Uses integer base-unit math so the chunks sum EXACTLY to the amount (no rounding
 * drift). Returns ceil(amount/cap) chunks; the last carries the remainder. Empty
 * when the amount rounds to <= 0.
 */
export function planFeeChunks(amountUsdc: number, capUsdc: number): number[] {
  const scale = 10 ** USDC_DECIMALS;
  const totalBase = Math.round(amountUsdc * scale);
  if (totalBase <= 0) return [];
  const capBase = Math.max(1, Math.round(capUsdc * scale));
  const chunks: number[] = [];
  let remaining = totalBase;
  while (remaining > 0) {
    const take = Math.min(capBase, remaining);
    chunks.push(take / scale);
    remaining -= take;
  }
  return chunks;
}

/** On-chain truth for idempotency (MED-C): does the FeeRecord PDA for this runId
 *  already exist? If so the chunk was already swept (even if the confirm timed out
 *  after it landed), so re-driving must treat it as success — never double-charge.
 *  Any read error degrades to `false` (fall back to the substring/transient
 *  classifiers). */
async function feeRecordExists(connection: Connection, feeRecord: PublicKey): Promise<boolean> {
  try {
    return (await connection.getAccountInfo(feeRecord)) !== null;
  } catch {
    return false;
  }
}

/**
 * Sweep an agent's booked compute tab to the treasury via agent-vault `debit_fee`.
 *
 * A collapsed settlement can EXCEED the vault's per-run cap, so the amount is split
 * into ceil(amount/cap) sequential chunks each <= the cap (READ from the vault, not
 * hardcoded), with runIds `${settlementId}#${i}`. Each chunk is independently
 * idempotent (its own FeeRecord PDA), so a released-and-retried sweep re-checks the
 * on-chain FeeRecord per chunk and skips the ones already swept — never
 * double-charging. `markSettlementPaid` still happens ONCE on the settlementId.
 *
 * - `{ ok: true, txSignature }`  — every chunk landed (or was already swept); the
 *                                  sig is the last debit that actually broadcast.
 * - `{ ok: true }` (no sig)      — all chunks were already swept (idempotent replay).
 * - `{ ok: true, txSignature: ONCHAIN_FEE_EXCEEDS_CAP_TERMINAL }`
 *                                — a chunk reverted `FeeExceedsCap` and can never
 *                                  succeed; TERMINAL (marked, not retried) so the
 *                                  settlement isn't re-collapsed + re-swept forever.
 * - `{ ok: false }`              — a transient/unknown on-chain failure; SAFE for
 *                                  the caller to release + retry (per-chunk idempotent).
 *
 * When the agent has NO enabled on-chain vault (its best-effort vault-init at mint
 * didn't land), this falls back to a CUSTODIAL sweep via `transferUsdc` (agent
 * wallet → treasury ATA, sponsored gas) — see `sweepAgentTabCustodial`. That path
 * can additionally return `{ ok: false, ambiguous: true, txSignature, ... }` on a
 * confirm-timeout; callers MUST stamp markSettlementConfirmAmbiguous (never
 * release) so recover-settlements verifies on-chain before re-transferring (the
 * transferUsdc path is NOT on-chain-idempotent, unlike debit_fee).
 *
 * Throws only on hard configuration/invariant errors (no Convex URL, no treasury,
 * or — on the custodial path — an agent with neither vault nor custodial wallet).
 */
export async function sweepAgentTabOnchain(opts: {
  mintAddress: string;
  settlementId: string;
  amountUsdc: number;
}): Promise<SweepResult> {
  const { mintAddress, settlementId, amountUsdc } = opts;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not configured");
  if (!TREASURY) throw new Error("Generation collection wallet not configured");

  const convex = new ConvexHttpClient(convexUrl);
  const account = process.env.VELLO_VAULT_SWEEP === "1" ? await convex.query(api.agentAccount.get, { mintAddress }) : null;
  // Generation fees are paid from the agent's own wallet straight to the generation collection wallet. The vault
  // `debit_fee` route can only pay the treasury the vault was created with, so it stays off unless VELLO_VAULT_SWEEP=1.
  if (process.env.VELLO_VAULT_SWEEP !== "1" || !account?.vaultEnabled || !account.vaultAgentId) {
    // CUSTODIAL FALLBACK: no enabled on-chain vault → sweep the booked fee straight
    // from the agent's custodial wallet to the treasury via transferUsdc, mirroring
    // app/api/agents/withdraw. Without this a vault-less agent's fee is forever
    // booked-and-claimed but never actually moved (the strand this fixes). Returns
    // the SAME SweepResult shape, so the settle orchestration is uniform.
    return await sweepAgentTabCustodial({ convex, mintAddress, amountUsdc });
  }

  const authority = requireVaultAuthority();
  // The durable keeper owns retries, not web3's tight 429 loop.
  const program = buildAgentVaultProgram(authority, getVaultConnection(true));
  const connection: Connection = program.provider.connection;
  const usdcMint = new PublicKey(getUsdcMint());
  const agentId = Buffer.from(account.vaultAgentId, "hex");
  const owner = authority.publicKey; // platform vault-authority: owns the vault PDA + signs debit_fee
  const [vault] = getVaultPda(owner, agentId);
  const treasuryUsdcAta = await getAssociatedTokenAddress(usdcMint, new PublicKey(TREASURY));

  // HIGH-1: read the on-chain per-run cap (do NOT hardcode 5) and split the amount
  // into chunks each <= cap. If the cap can't be read we attempt a single
  // un-chunked debit and let the FeeExceedsCap backstop below make it terminal —
  // still no hardcoded cap, and no infinite retry loop.
  const capUsdc = readMaxFeePerRunUsdc(await fetchVault(program, owner, agentId));
  if (capUsdc == null) {
    console.warn(`[vaultSweep] could not read maxFeePerRun for ${mintAddress}; attempting a single un-chunked debit (terminal if it exceeds the on-chain cap)`);
  }
  // #22: when the cap read FAILED (capUsdc null), chunk by a conservative default
  // (the mint-time cap = 5) rather than the FULL amount. A >$5 tab chunked by the
  // full amount becomes one un-chunked debit that trips FeeExceedsCap and — on a
  // mere transient RPC blip — was wrongly terminalized as PAID (agent re-credited,
  // treasury never paid). Chunking by 5 lets the debit succeed outright.
  const DEFAULT_CAP_USDC = Number(process.env.VELLO_VAULT_DEFAULT_CAP_USDC ?? "5");
  const chunks = planFeeChunks(amountUsdc, capUsdc ?? DEFAULT_CAP_USDC);
  if (chunks.length === 0) return { ok: true }; // nothing to sweep (amount rounds to <= 0)

  let lastSig: string | undefined;
  const vaultAta = await getVaultUsdcAta(usdcMint, vault);
  for (let i = 0; i < chunks.length; i++) {
    const chunkUsdc = chunks[i];
    const runId = `${settlementId}#${i}`; // independent per-chunk idempotency key
    const [feeRecord] = getFeeRecordPda(vault, runIdToBytes(runId));
    try {
      // Check idempotency BEFORE balance: a paid vault can now be empty.
      // Read failures abort this pass rather than trigger speculative debits.
      if (await connection.getAccountInfo(feeRecord)) continue;
      const balance = await connection.getTokenAccountBalance(vaultAta);
      if (BigInt(balance.value.amount) < BigInt(Math.round(chunkUsdc * 10 ** USDC_DECIMALS))) {
        return { ok: false, reason: "vault_insufficient_usdc", retryDelayMs: 30 * 60_000 };
      }
      lastSig = await debitFeeTx({
        program,
        agentId,
        usdcMint,
        owner,
        treasuryUsdcAta,
        amountUsdc: chunkUsdc,
        runId,
      });
    } catch (e) {
      if (errText(e).includes("429") || errText(e).includes("too many requests")) {
        return { ok: false, reason: "rpc_rate_limited", retryDelayMs: 5 * 60_000 };
      }
      if (errText(e).includes("insufficient funds")) {
        return { ok: false, reason: "vault_insufficient_usdc", retryDelayMs: 30 * 60_000 };
      }
      // MED-C: on-chain truth FIRST. If the FeeRecord exists this chunk already
      // swept (e.g. the confirm timed out after it landed) → treat as success.
      if (await feeRecordExists(connection, feeRecord)) continue;
      if (isFeeRecordCollision(e)) continue; // substring fallback if the read was hidden
      if (isFeeExceedsCap(e)) {
        if (capUsdc == null) {
          // #22: the cap READ failed, so this FeeExceedsCap is almost certainly an
          // artifact of chunking by the default rather than a genuine over-cap
          // chunk. Do NOT terminalize on a transient — release for retry so a later
          // tick with a good cap read settles it (per-chunk idempotent → the
          // treasury is eventually paid and the agent is never wrongly re-credited).
          console.warn(
            `[vaultSweep] FeeExceedsCap with UNKNOWN cap (read failed) settlement=${settlementId} chunk=${i} ` +
              `chunkUsdc=${chunkUsdc} amountUsdc=${amountUsdc} mint=${mintAddress} — treating as transient, will retry`,
          );
          return { ok: false };
        }
        // HIGH-1 TERMINAL: the cap was READ and this chunk still exceeds it (the cap
        // shrank) — it can NEVER land. Do NOT return the retry-releasing { ok: false }
        // — that re-collapses + re-sweeps forever and freezes the reconcile-held
        // amount. Mark it terminal so the settlement is never re-driven, and ALERT.
        console.error(
          `[vaultSweep] debit_fee FeeExceedsCap — TERMINAL settlement=${settlementId} chunk=${i}/${chunks.length} ` +
          `chunkUsdc=${chunkUsdc} capUsdc=${capUsdc ?? "unknown"} amountUsdc=${amountUsdc} mint=${mintAddress} — ` +
          `NOT releasing for retry (would loop forever); marking terminal, manual review needed`,
        );
        return { ok: true, txSignature: ONCHAIN_FEE_EXCEEDS_CAP_TERMINAL };
      }
      if (isTerminalVaultMisconfig(e)) {
        // TERMINAL misconfig (InvalidTreasury / Unauthorized / MintMismatch): the
        // vault's on-chain treasury/authority no longer matches what we pass (env
        // rotated after init, etc.). A retry can NEVER fix this on its own, so the
        // retry-releasing { ok:false } would loop forever and freeze the held
        // amount. Mark terminal + ALERT so the loop stops loudly for a human fix.
        console.error(
          `[vaultSweep] debit_fee TERMINAL vault-misconfig (InvalidTreasury/Unauthorized/MintMismatch) ` +
          `settlement=${settlementId} chunk=${i}/${chunks.length} mint=${mintAddress}: ` +
          `${e instanceof Error ? e.message : e} — NOT releasing (would loop forever); marking terminal`,
        );
        await sendAlert("compute-sweep-terminal-misconfig", {
          settlementId, chunk: i, mint: mintAddress, amountUsdc,
          error: e instanceof Error ? e.message : String(e),
        });
        return { ok: true, txSignature: ONCHAIN_FEE_TREASURY_MISCONFIG_TERMINAL };
      }
      // Transient/unknown. A re-attempt is per-chunk idempotent (already-swept
      // chunks collide with their FeeRecord → skipped), so releasing for a fast,
      // safe retry can never double-charge.
      console.warn(`[vaultSweep] debit_fee failed for settlement ${settlementId} chunk ${i} (${mintAddress}): ${e instanceof Error ? e.message : e}`);
      return { ok: false };
    }
  }
  // { ok: true } only reached when ALL chunks swept-or-already-swept.
  return { ok: true, txSignature: lastSig };
}

/**
 * CUSTODIAL fee sweep for an agent with NO enabled on-chain vault. Moves the
 * booked fee straight from the agent's custodial wallet to the treasury's USDC ATA
 * via `transferUsdc`, with sponsored gas (PLATFORM_FEE_PAYER_SECRET), exactly like
 * app/api/agents/withdraw. The agent's signing secret is fetched + decrypted the
 * same way (influencers.getByMintServer → readAgentSecret).
 *
 * NO-DOUBLE-SPEND: unlike `debit_fee` (idempotent via its FeeRecord PDA), a plain
 * transfer is NOT on-chain idempotent, so the caller's per-row INFLIGHT lease +
 * confirm-ambiguity handling is what makes a re-drive safe:
 *   - transfer OK               → { ok: true, txSignature } → caller marks paid.
 *   - CONFIRM-AMBIGUOUS (sig)   → { ok: false, ambiguous: true, txSignature, lvbh }.
 *       The caller must NOT release — it stamps markSettlementConfirmAmbiguous, and
 *       recover-settlements verifies the sig on-chain (getSignatureStatus) and only
 *       re-transfers once the blockhash is provably expired (can never land).
 *   - PRE-BROADCAST failure     → { ok: false } (no sig) → safe to release + retry.
 *
 * The destination is `getAssociatedTokenAddress(usdcMint, NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET)`
 * — the SAME treasury the vault path targets (module `TREASURY`). We pass the
 * treasury WALLET as `toPubkey`; transferUsdc derives its USDC ATA (and creates it
 * if missing, gas-sponsored), so the fee lands in the exact same account.
 */
async function sweepAgentTabCustodial(opts: {
  convex: ConvexHttpClient;
  mintAddress: string;
  amountUsdc: number;
}): Promise<SweepResult> {
  const { convex, mintAddress, amountUsdc } = opts;
  const agent = await convex.query(api.influencers.getByMintServer, {
    mintAddress,
    authSecret: process.env.INTERNAL_CRON_SECRET ?? "",
  });
  if (!agent?.agentWallet || !agent.agentWalletSecret) {
    // No vault AND no custodial wallet secret to sweep from — a hard invariant
    // error. Throw so the caller RELEASES the claim (nothing moved) for a later
    // retry once the record is repaired, rather than silently dropping the fee.
    throw new Error(
      `agent ${mintAddress} has neither an enabled vault nor a custodial wallet secret — cannot sweep compute tab`,
    );
  }

  // Sponsored gas so the agent wallet needs zero SOL (mirrors the withdraw route). If the shared fee payer is missing
  // or out of SOL, the agent pays its own network fee instead, topping up a little SOL from its USDC when it has none.
  const sponsored = await feePayerReady();
  if (!sponsored) {
    const gas = await ensureAgentGas(mintAddress, amountUsdc);
    if (!gas.ok) {
      console.warn(`[vaultSweep] fee payer unavailable and the agent could not get network-fee SOL for ${mintAddress}: ${gas.reason} — releasing for retry`);
      return { ok: false, reason: `no_network_fee_sol: ${gas.reason}` };
    }
  }
  let agentSecret: string;
  try {
    agentSecret = readAgentSecret(agent.agentWalletSecret);
  } catch {
    // A key mismatch must release the settlement claim; no transaction was sent.
    return { ok: false, reason: "wallet_signing_unavailable" };
  }
  const transfer = await transferUsdc({
    fromSecretBase64: agentSecret,
    fromPubkey: agent.agentWallet,
    toPubkey: TREASURY, // treasury WALLET; transferUsdc derives its USDC ATA
    amountUsdc,
    feePayerSecretBase64: sponsored ? process.env.PLATFORM_FEE_PAYER_SECRET : undefined,
  });

  if (transfer.ok) {
    return { ok: true, txSignature: transfer.txSignature };
  }
  // CONFIRM-AMBIGUOUS: a sig was broadcast but confirmation failed — the USDC MAY
  // have moved. Carry the sig (+ lvbh) so the caller stamps confirm-ambiguous and
  // the keeper verifies on-chain BEFORE ever re-transferring. Never a plain,
  // releasable { ok:false } here — that would risk a double transfer.
  if (transfer.txSignature) {
    return {
      ok: false,
      ambiguous: true,
      txSignature: transfer.txSignature,
      ...(transfer.lastValidBlockHeight !== undefined ? { lastValidBlockHeight: transfer.lastValidBlockHeight } : {}),
    };
  }
  // PRE-BROADCAST failure (no sig ever produced) → no USDC moved → safe to release.
  console.warn(
    `[vaultSweep] custodial sweep pre-broadcast failure for ${mintAddress}: ${transfer.error ?? "unknown"} (step=${transfer.step ?? "?"}) — releasing for retry`,
  );
  return { ok: false, reason: `${transfer.step ?? "send"}: ${transfer.error ?? "unknown"}` };
}

/**
 * The on-chain USDC backing an agent's escrow mirror (NAV). This is the CUSTODIAL
 * agent wallet's USDC balance — the account investors actually deposit into
 * (buy-shares verifies the deposit against `agent.agentWallet`) and that redemptions
 * pay OUT of. It is fed to `reconcileEscrowToOnchainServer` by the reconcile drivers.
 *
 * H5 FIX: this previously read the VAULT PDA's ATA for a vault-enabled agent (the
 * "chain=truth single wallet" intent). But investor USDC never lands in the vault —
 * the vault is a SEPARATE, platform-funded compute-fee reserve (fund-vault deposits
 * from the platform authority; debit_fee drains it to the treasury). So reconciling a
 * vault-enabled agent against the (empty) vault ATA ZEROED its escrow/NAV, erasing
 * every investor's deposit. Reconciling against the custodial wallet — the same
 * account that holds the investor USDC on BOTH the vault and non-vault paths — is the
 * correct NAV backing. (The compute-fee accounting is handled separately by the
 * unpaid-settlement subtraction inside reconcile, not by this raw balance.)
 *
 * Returns `null` when the balance could NOT be positively read (RPC timeout/429/
 * socket-drop). Callers MUST skip the reconcile write on null — persisting a
 * swallowed-error 0 would zero a funded agent's mirror.
 */
export async function resolveAgentOnchainUsdc(opts: {
  mintAddress: string;
  fallbackWallet: string;
}): Promise<number | null> {
  // `fallbackWallet` is the custodial agent wallet (agent.agentWallet), passed by
  // every reconcile driver. `mintAddress` is retained for call-site compatibility
  // + future use. Read the custodial balance strictly (null on a read failure).
  return getUsdcBalanceStrict(opts.fallbackWallet);
}
