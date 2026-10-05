import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import type { ParsedTransactionWithMeta, TokenBalance } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getReadRpcUrl, getUsdcMint, getNetwork } from "@/lib/solana/network";
import { requireInternalOrUserAuth } from "@/lib/server/requireAuth";
import { mapWithConcurrency } from "@/lib/async/mapWithConcurrency";
import {
  normalizeHeliusTransfers,
  normalizeParsedTransfers,
  dedupeTransfers,
  type UsdcTransfer,
  type ParsedTxLike,
  type TokenBalanceEntry,
  type HeliusEnrichedTx,
} from "@/lib/solana/usdcTransfers";

/**
 * Shared read-only route: recent on-chain USDC wallet-to-wallet transfers.
 *
 *   GET ?wallet=<addr>            → transfers for one wallet
 *   GET ?wallets=a,b,c            → combined, deduped across all wallets
 *   GET ...&limit=<n>             → per-wallet signature cap (default 25, max 50)
 *
 * Response: { transfers: UsdcTransfer[], network, source, fetchedAt,
 *             partial, walletsRead, walletsTotal }
 *   where UsdcTransfer = { signature, from, to, amountUsdc, blockTime, direction }
 *   and `direction` ("in"|"out") is relative to the queried wallet.
 *   `partial` is true when some (but not all) tracked wallets could be read —
 *   the `transfers` still reflect real chain data for the wallets we reached.
 *
 * Path: prefers the Helius Enhanced Transactions API when a key is configured
 * (pre-parsed tokenTransfers), else falls back to web3.js — signatures on the
 * wallet's USDC ATA (NOT the owner key; incoming SPL transfers list only the
 * ATA) diffed via preTokenBalances/postTokenBalances.
 *
 * Rate-limit discipline: module-scope TTL cache + in-flight dedupe + a
 * bounded-concurrency read (small waves, not one burst over ~35 wallets) so the
 * free-tier RPC isn't 429'd. Per-wallet failures are tolerated (skip that
 * wallet); ok:false with NO `transfers` is returned ONLY when EVERY wallet
 * failed — never a confident empty list.
 */

export const maxDuration = 30;

const NETWORK = getNetwork();
const USDC_MINT = getUsdcMint(NETWORK);
const HELIUS_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY ?? "";
const READ_RPC = getReadRpcUrl(NETWORK);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_WALLETS = 40;
const TTL_MS = 45_000;
const FETCH_TIMEOUT_MS = 9_000;
// Throttle the on-chain read burst so the free-tier RPC isn't hit with ~35
// simultaneous getSignaturesForAddress/getParsedTransactions (that burst is what
// 429s the shared key). Small waves + a short breather between them; the 45s
// per-wallet cache means only the first cold load pays this cost.
const READ_CONCURRENCY = 4;
const INTER_WAVE_DELAY_MS = 200;

// Module-scope TTL cache + in-flight dedupe (persist across requests on a warm
// instance). Prevents the shared Helius free-tier key from a 429 storm when the
// admin explorer batches ~30 wallets. Key = `${wallet}:${limit}`.
const CACHE = new Map<string, { v: UsdcTransfer[]; t: number }>();
const INFLIGHT = new Map<string, Promise<UsdcTransfer[]>>();

class RateLimitError extends Error {
  constructor(msg = "rate_limited") {
    super(msg);
    this.name = "RateLimitError";
  }
}
function isRateLimit(e: unknown): boolean {
  if (e instanceof RateLimitError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /\b429\b|rate.?limit|too many requests/i.test(msg);
}

/** Helius Enhanced Transactions base per network, or null when unavailable. */
function heliusEnhancedBase(): string | null {
  if (!HELIUS_KEY) return null;
  if (NETWORK === "mainnet-beta") return "https://api.helius.xyz";
  if (NETWORK === "devnet") return "https://api-devnet.helius.xyz";
  return null; // testnet: Enhanced API unsupported → web3.js fallback
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaHelius(base: string, wallet: string, limit: number): Promise<UsdcTransfer[]> {
  const url = `${base}/v0/addresses/${wallet}/transactions?api-key=${HELIUS_KEY}&type=TRANSFER&limit=${limit}`;
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new Error(`helius_${res.status}`);
  const json: unknown = await res.json();
  if (!Array.isArray(json)) throw new Error("helius_bad_payload");
  return normalizeHeliusTransfers(json as HeliusEnrichedTx[], wallet, USDC_MINT);
}

function mapBalance(b: TokenBalance): TokenBalanceEntry {
  return { owner: b.owner ?? null, mint: b.mint, uiAmount: b.uiTokenAmount.uiAmount ?? 0 };
}
function toParsedTxLike(tx: ParsedTransactionWithMeta, signature: string): ParsedTxLike {
  return {
    signature,
    blockTime: tx.blockTime ?? null,
    preTokenBalances: (tx.meta?.preTokenBalances ?? []).map(mapBalance),
    postTokenBalances: (tx.meta?.postTokenBalances ?? []).map(mapBalance),
  };
}

async function fetchViaWeb3(wallet: string, limit: number): Promise<UsdcTransfer[]> {
  const conn = new Connection(READ_RPC, "confirmed");
  const owner = new PublicKey(wallet);
  // Incoming SPL transfers list only the ATA (not the owner key), so read the
  // wallet's USDC ATA — reading the owner pubkey would miss deposits. A missing
  // ATA yields [] (getSignaturesForAddress does not throw on an absent account).
  // allowOwnerOffCurve=true so a campaign escrow PDA (off-curve owner) resolves
  // instead of throwing TokenOwnerOffCurveError and nuking the whole batch.
  const ata = await getAssociatedTokenAddress(new PublicKey(USDC_MINT), owner, true);
  const sigs = await conn.getSignaturesForAddress(ata, { limit });
  if (sigs.length === 0) return [];
  const parsed = await conn.getParsedTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0 },
  );
  const like: ParsedTxLike[] = [];
  parsed.forEach((tx, i) => {
    if (tx) like.push(toParsedTxLike(tx, sigs[i].signature));
  });
  return normalizeParsedTransfers(like, wallet, USDC_MINT);
}

async function fetchWalletTransfers(wallet: string, limit: number): Promise<UsdcTransfer[]> {
  const key = `${wallet}:${limit}`;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.t < TTL_MS) return cached.v;
  let p = INFLIGHT.get(key);
  if (!p) {
    p = (async () => {
      const base = heliusEnhancedBase();
      if (base) {
        try {
          return await fetchViaHelius(base, wallet, limit);
        } catch (e) {
          // A 429 means the shared key is exhausted — the web3.js path uses the
          // SAME Helius key, so don't hammer it; surface as unavailable.
          if (isRateLimit(e)) throw e;
          // Any other Helius failure (devnet Enhanced unsupported, timeout,
          // parse) → fall through to the web3.js balance-diff path.
        }
      }
      return await fetchViaWeb3(wallet, limit);
    })()
      .then((v) => {
        CACHE.set(key, { v, t: Date.now() });
        return v;
      })
      .finally(() => INFLIGHT.delete(key));
    INFLIGHT.set(key, p);
  }
  return p;
}

export async function GET(req: NextRequest) {
  // Admin / platform data — require an authed user (or the internal secret).
  const auth = await requireInternalOrUserAuth(req);
  if (auth.error) return auth.error;

  const url = new URL(req.url);
  const single = url.searchParams.get("wallet");
  const many = url.searchParams.get("wallets");
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;

  const requested = many ? many.split(",") : single ? [single] : [];
  const wallets = Array.from(new Set(requested.map((w) => w.trim()).filter(Boolean)));
  if (wallets.length === 0) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }
  if (wallets.length > MAX_WALLETS) {
    return NextResponse.json({ error: `too many wallets (max ${MAX_WALLETS})` }, { status: 400 });
  }
  for (const w of wallets) {
    try {
      new PublicKey(w);
    } catch {
      return NextResponse.json({ error: `invalid wallet: ${w}` }, { status: 400 });
    }
  }

  try {
    // Bounded-concurrency read: small waves (not one Promise.all over all ~35
    // wallets) so the free-tier RPC isn't rate-limited by a simultaneous burst.
    // Per-wallet failures are TOLERATED — each fetch catches its own error and
    // returns a settled sentinel, so one flaky/429'd wallet doesn't blank the
    // whole explorer. We only surface ok:false when EVERY wallet failed.
    type Settled = { ok: true; transfers: UsdcTransfer[] } | { ok: false };
    let anyFail: unknown = null;
    const settled = await mapWithConcurrency(
      wallets,
      READ_CONCURRENCY,
      async (w): Promise<Settled> => {
        try {
          return { ok: true, transfers: await fetchWalletTransfers(w, limit) };
        } catch (e) {
          anyFail = e;
          return { ok: false };
        }
      },
      INTER_WAVE_DELAY_MS,
    );

    const okResults = settled.filter(
      (s): s is { ok: true; transfers: UsdcTransfer[] } => s.ok,
    );
    if (okResults.length === 0) {
      // Every wallet failed → the RPC is genuinely unavailable. Return ok:false
      // and NO `transfers` so the client shows "unavailable" — NEVER a confident
      // empty "no transfers" that would misread as wallets with no history.
      return NextResponse.json(
        {
          ok: false,
          error: "rpc_unavailable",
          detail: anyFail instanceof Error ? anyFail.message.slice(0, 160) : "rpc error",
        },
        { status: 200 },
      );
    }

    const transfers = dedupeTransfers(okResults.flatMap((s) => s.transfers)).sort(
      (a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0),
    );
    // `partial` = at least one wallet read succeeded but not all; the returned
    // `transfers` still reflect real on-chain data for the wallets we could read.
    const partial = okResults.length < wallets.length;
    return NextResponse.json({
      transfers,
      network: NETWORK,
      source: heliusEnhancedBase() ? "helius" : "rpc",
      fetchedAt: Date.now(),
      partial,
      walletsRead: okResults.length,
      walletsTotal: wallets.length,
    });
  } catch (err) {
    // Defensive: the per-wallet path already tolerates failures, so reaching
    // here means something unexpected threw. Preserve the honest ok:false shape.
    return NextResponse.json(
      { ok: false, error: "rpc_unavailable", detail: err instanceof Error ? err.message.slice(0, 160) : "rpc error" },
      { status: 200 },
    );
  }
}
