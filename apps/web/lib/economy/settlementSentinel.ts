/**
 * The `feeSettlements.txSignature` field is overloaded as a 3-state marker so we
 * never add a Convex schema FIELD (the schema is at its type-complexity ceiling).
 *
 *   undefined / null                              => booked, never attempted (settleTab / legacy)
 *   "INFLIGHT:<token>:<expiryMs>"                 => a settle attempt OWNS this row (the
 *                                                    per-row lock; carries its lease expiry)
 *   "INFLIGHT:<token>:<expiryMs>|sig:<S>|lvbh:<H>|att:<N>"
 *                                                 => same lock, PLUS a confirm-step
 *                                                    signature the original settler broadcast
 *                                                    but couldn't confirm (the USDC MAY have
 *                                                    moved). The keeper verifies this sig
 *                                                    on-chain before deciding to re-transfer.
 *                                                    `lvbh` (lastValidBlockHeight) lets the
 *                                                    keeper prove blockhash expiry — once the
 *                                                    cluster tip passes it the sig can never
 *                                                    land, so a dropped tx is safe to re-send.
 *                                                    `att` counts ambiguous keeper passes so a
 *                                                    genuinely-stuck row gets a loud alert
 *                                                    instead of deferring forever. The `|sig`,
 *                                                    `|lvbh`, `|att` suffixes are each optional
 *                                                    and order-independent.
 *   "<base58 real sig>"                           => terminally PAID (no "INFLIGHT:" prefix)
 *
 * `|` and `:` never appear in base58, so the `|sig:` / `|lvbh:` / `|att:`
 * suffixes are unambiguous and the expiry parse stays robust even when they are
 * attached.
 *
 * This module is the single source of truth for building / parsing that sentinel
 * so Convex mutations, the keeper, and read queries can't drift.
 */

export const INFLIGHT_PREFIX = "INFLIGHT:";
const SIG_DELIM = "|sig:";
const LVBH_DELIM = "|lvbh:";
const ATT_DELIM = "|att:";

/** A non-empty txSignature that is NOT an INFLIGHT sentinel is a real, terminal
 *  on-chain signature → the settlement is paid. */
export function isPaidSig(txSignature?: string | null): boolean {
  return !!txSignature && !txSignature.startsWith(INFLIGHT_PREFIX);
}

export function isInflight(txSignature?: string | null): boolean {
  return !!txSignature && txSignature.startsWith(INFLIGHT_PREFIX);
}

/** Build the INFLIGHT sentinel string for a claim that leases until `expiryMs`.
 *  Optionally attach a confirm-step signature the settler broadcast but couldn't
 *  confirm (plus its lastValidBlockHeight, so the keeper can prove blockhash
 *  expiry, and an attempt counter so a stuck row alerts instead of deferring
 *  forever). The `<token>:<expiryMs>` core stays first so the existing robust
 *  expiry parse is unchanged; the optional `|sig|lvbh|att` suffixes follow. */
export function buildInflight(
  claimToken: string,
  expiryMs: number,
  confirmSig?: string,
  lastValidBlockHeight?: number,
  attempts?: number,
): string {
  let out = `${INFLIGHT_PREFIX}${claimToken}:${expiryMs}`;
  if (confirmSig) out += `${SIG_DELIM}${confirmSig}`;
  if (Number.isFinite(lastValidBlockHeight as number)) out += `${LVBH_DELIM}${lastValidBlockHeight}`;
  if (Number.isFinite(attempts as number) && (attempts as number) > 0) out += `${ATT_DELIM}${attempts}`;
  return out;
}

export interface InflightParsed {
  token: string;
  expiryMs: number;
  /** A broadcast-but-unconfirmed signature attached by a confirm-ambiguous
   *  failure. When present, the keeper MUST verify it on-chain before deciding
   *  whether to re-transfer (else risk a double transfer). */
  confirmSig?: string;
  /** The confirm sig's blockhash lastValidBlockHeight. Once the cluster tip
   *  passes it, the sig can never land → a dropped tx is provably safe to
   *  re-transfer. Undefined for legacy rows written before this field existed. */
  lastValidBlockHeight?: number;
  /** How many ambiguous keeper passes this row has survived. Drives the
   *  stranded-settlement alert so a stuck row is never silent. */
  attempts?: number;
}

/** Parse an `INFLIGHT:<token>:<expiryMs>[|sig:<S>][|lvbh:<H>][|att:<N>]`
 *  sentinel. Returns null for anything that isn't a well-formed INFLIGHT value
 *  (undefined / paid sig / malformed). The token may itself contain ':' — only
 *  the segment before the FIRST `|` suffix is split, and the LAST ':' of that
 *  part is the expiry. The `|`-delimited suffixes are order-independent. */
export function parseInflight(txSignature?: string | null): InflightParsed | null {
  if (!txSignature || !txSignature.startsWith(INFLIGHT_PREFIX)) return null;
  const body = txSignature.slice(INFLIGHT_PREFIX.length);
  // Split the core (`<token>:<expiryMs>`) from the optional `|...` suffixes. The
  // first `|` ends the core (neither token, base58 sig, nor a number contains
  // `|`); each subsequent `|seg` is one suffix.
  const segments = body.split("|");
  const core = segments[0];
  let confirmSig: string | undefined;
  let lastValidBlockHeight: number | undefined;
  let attempts: number | undefined;
  for (let i = 1; i < segments.length; i++) {
    const seg = `|${segments[i]}`;
    if (seg.startsWith(SIG_DELIM)) {
      confirmSig = seg.slice(SIG_DELIM.length) || undefined;
    } else if (seg.startsWith(LVBH_DELIM)) {
      const h = Number(seg.slice(LVBH_DELIM.length));
      if (Number.isFinite(h)) lastValidBlockHeight = h;
    } else if (seg.startsWith(ATT_DELIM)) {
      const n = Number(seg.slice(ATT_DELIM.length));
      if (Number.isFinite(n)) attempts = n;
    }
  }
  const lastColon = core.lastIndexOf(":");
  if (lastColon < 0) return null;
  const token = core.slice(0, lastColon);
  const expiryMs = Number(core.slice(lastColon + 1));
  if (!token || !Number.isFinite(expiryMs)) return null;
  return {
    token,
    expiryMs,
    ...(confirmSig ? { confirmSig } : {}),
    ...(lastValidBlockHeight !== undefined ? { lastValidBlockHeight } : {}),
    ...(attempts !== undefined ? { attempts } : {}),
  };
}

/** An INFLIGHT claim is EXPIRED (stealable) when its lease ended before `nowMs`.
 *  A value that LOOKS inflight (has the prefix) but fails to parse is treated as
 *  expired so the keeper can reclaim it — a malformed sentinel must never wedge a
 *  row out of recovery forever (F4). */
export function isInflightExpired(txSignature: string | null | undefined, nowMs: number): boolean {
  if (!txSignature || !txSignature.startsWith(INFLIGHT_PREFIX)) return false;
  const parsed = parseInflight(txSignature);
  if (!parsed) return true; // INFLIGHT-prefixed but unparseable → reclaimable, not stuck
  return parsed.expiryMs < nowMs;
}

/** A row is claimable by a fresh settle attempt when it has never been attempted
 *  (undefined / empty) OR carries an INFLIGHT sentinel whose lease has expired
 *  (including a malformed INFLIGHT value — reclaimable, not stranded). A real
 *  base58 signature (paid) is NEVER claimable. */
export function isClaimable(txSignature: string | null | undefined, nowMs: number): boolean {
  if (!txSignature) return true;                              // undefined / "" → never attempted
  if (!txSignature.startsWith(INFLIGHT_PREFIX)) return false; // a real sig → paid, terminal
  return isInflightExpired(txSignature, nowMs);               // INFLIGHT: expired (or malformed) → claimable
}
