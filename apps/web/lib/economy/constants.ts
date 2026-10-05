/** Tunable economic constants for the agent economy. Spec §2, §13. */
export const SEED_SHARE_PRICE_USDC = 1.0; // NAV when an agent has 0 shares
export const EXIT_FEE_PCT = 0.02;         // 2% redemption fee, retained in escrow
export const BUY_CAP_PCT = 0.10;          // max 10% of shares per wallet
export const FOUNDER_PCT = 0.15;          // builder's founder allocation at mint
export const SETTLE_THRESHOLD_USDC = 5;   // batch-settle the service tab at/above this
export const INITIAL_SHARE_SUPPLY = 1_000_000; // share units created at mint
export const SHARE_DECIMALS = 6;          // share quantities rounded to this precision
export const USDC_DECIMALS = 6;           // USDC amounts rounded to this precision

/**
 * Minimum WHOLE shares outstanding before the share-backed withdraw floor applies.
 *
 * The floor is `sharesOutstanding × navPerShare`, and `navPerShare =
 * (escrow − tab) / sharesOutstanding`, so ANY positive `sharesOutstanding` makes the
 * floor collapse to `escrow − tab` (the WHOLE pool) regardless of how few shares
 * exist. A founder earnings-credit can leave a dust fraction of a share outstanding
 * with NO real investor (live: 0.000067 shares) — that dust must never lock 100% of
 * the escrow and disable Withdraw. Real investor positions are ≥ 1 share (seed price
 * is $1/share, see SEED_SHARE_PRICE_USDC), so a sub-1-share TOTAL can only be a
 * founder artifact and carries no protectable third-party capital. Belt-and-suspenders
 * for the Invest-re-enabled path (the primary gate is investEnabled()).
 */
export const MIN_SHARES_FOR_FLOOR = 1;

// ─── Settlement recovery + per-settlement concurrency lock (cluster C) ───────
// A feeSettlements row is booked by settleTab (no txSignature), then a settle
// attempt CLAIMS it (writes an `INFLIGHT:<token>:<expiryMs>` sentinel into
// txSignature — the per-row lock), transfers on-chain, and stamps the real
// signature on success. These three knobs govern the lock lease + the recovery
// keeper that re-drives any stranded row.

/** How often the recovery keeper cron runs (re-drives stranded settlements). */
export const KEEPER_INTERVAL_MS = 10 * 60_000; // ~10m
/** A booked settlement must be at least this old before the keeper touches it —
 *  gives the original in-band settle attempt time to finish (and stamp the row)
 *  before the keeper considers it stranded. */
export const GRACE_MS = 10 * 60_000;           // ~10m
/** Lease duration of an `INFLIGHT:` claim. After this elapses the claim is
 *  considered expired and another settler (the keeper) may steal it. Kept short
 *  so a crashed settler doesn't strand a row for long, but longer than a single
 *  transfer round-trip so a live settler isn't pre-empted mid-transfer. */
export const LEASE_MS = 5 * 60_000;            // ~5m

/** How many consecutive ambiguous keeper passes a confirm-unknown settlement may
 *  survive before the keeper emits a loud `[settlement-strand]` alert. A tx whose
 *  blockhash is still in-window (or whose lvbh is unknown — legacy rows) is
 *  re-deferred each pass; this guarantees that case can never be SILENT. */
export const STRAND_ALERT_AFTER_ATTEMPTS = 3;

// ─── Share-redemption recovery keeper (H4) ───────────────────────────────────
// A share redemption BURNS the holder's shares + debits escrow and then pays USDC
// out of the agent's custodial wallet. The burn + the pending `shareRedemptions`
// row are written atomically (begin); the transfer follows. Because a plain USDC
// transfer is NOT on-chain-idempotent (unlike the settlement debit_fee), the row's
// `attempts` counter is used as a BROADCAST-ATTEMPT MARKER: the route (and the
// keeper) bump it to ≥1 IMMEDIATELY BEFORE calling transferUsdc. So a stranded
// pending row is disambiguated safely:
//   • no sig, attempts === 0 → the process died BEFORE any transfer was attempted →
//     no USDC moved → safe to (re-)transfer.
//   • no sig, attempts ≥ 1   → a transfer WAS attempted but its outcome wasn't
//     recorded (crash in the tiny window after transferUsdc returned) → the USDC MAY
//     have moved → NEVER blind re-transfer or reverse; alert for manual review.
//   • sig present            → confirm-ambiguous → verify on-chain before deciding.
// This makes a client retry unable to double-burn AND the keeper unable to double-pay.

/** How often the redemption recovery keeper cron runs. */
export const REDEMPTION_KEEPER_INTERVAL_MS = 10 * 60_000; // ~10m
/** A pending redemption must have had NO activity (updatedAt) for at least this
 *  long before the keeper touches it — longer than the route's whole transfer +
 *  confirm round-trip (~90s), so the keeper never races a still-working request.
 *  `updatedAt` doubles as a soft lease: any keeper touch re-arms this window, so
 *  two overlapping keeper passes can't both re-transfer the same row. */
export const REDEMPTION_GRACE_MS = 5 * 60_000; // ~5m
/** Consecutive ambiguous/deferred keeper passes a redemption may survive before a
 *  loud `[redemption-strand]` alert — the never-silent guarantee (mirrors
 *  STRAND_ALERT_AFTER_ATTEMPTS for settlements). */
export const REDEMPTION_STRAND_ALERT_AFTER_ATTEMPTS = 3;
