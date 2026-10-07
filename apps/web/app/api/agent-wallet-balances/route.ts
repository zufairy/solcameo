import { NextRequest, NextResponse } from "next/server";
import { failoverConnection } from "@/lib/solana/failoverConnection";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, unpackAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getUsdcMint, getNetwork } from "@/lib/solana/network";
import { splitByFreshness, type BalanceEntry } from "@/lib/server/balanceCache";

export const maxDuration = 10;

// Single source of truth via lib/solana/network — devnet returns the PUBLIC
// endpoint (the configured Helius devnet key is suspended → 403 on every call).
const NETWORK = getNetwork();

const USDC_MINT = new PublicKey(getUsdcMint(NETWORK));
const USDC_DECIMALS = 6;

/** getMultipleAccountsInfo caps at 100 accounts per RPC call. */
const CHUNK = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Serve recently-fetched balances from memory so the market page's interval poll
// (× every open tab) collapses to ~one RPC round-trip per TTL — the relief valve
// for free-tier Helius rate/credit 429s. Module-level: persists across requests on
// the long-lived Railway server.
const CACHE_TTL_MS = 20_000;
const balanceCache = new Map<string, BalanceEntry>();

/**
 * BATCH live on-chain balances for MANY agent wallets in one request.
 *
 * The per-wallet `/api/agent-wallet-balance` route does 2 RPC calls each, so a
 * market page with N agents fired N×2 round-trips. This route derives every
 * wallet's USDC ATA (pure CPU, no RPC) and reads them all with a single
 * `getMultipleAccountsInfo` call per 100 wallets — so the whole page's balances
 * land in essentially one round-trip. SOL is fetched the same way.
 *
 * GET  /api/agent-wallet-balances?wallets=A,B,C
 * POST { wallets: ["A","B","C"] }
 * → { ok, balances: { [wallet]: { usdc, sol } }, network, fetchedAt }
 */
async function resolve(wallets: string[]) {
  // De-dupe + keep only valid pubkeys (skip garbage without failing the batch).
  const seen = new Set<string>();
  const allOwners: { wallet: string; pk: PublicKey }[] = [];
  for (const w of wallets) {
    const t = w?.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    try { allOwners.push({ wallet: t, pk: new PublicKey(t) }); } catch { /* skip invalid */ }
  }

  // Serve fresh balances from the cache; only re-fetch the STALE wallets.
  const now = Date.now();
  const { fresh, stale } = splitByFreshness(allOwners.map((o) => o.wallet), balanceCache, now, CACHE_TTL_MS);
  const balances: Record<string, { usdc: number; sol: number }> = { ...fresh };
  const staleSet = new Set(stale);
  const owners = allOwners.filter((o) => staleSet.has(o.wallet));
  if (owners.length === 0) return balances; // all fresh → ZERO RPC calls

  const conn = failoverConnection({ network: NETWORK });

  // Derive USDC ATAs (off-curve allowed for PDA-owned agent wallets).
  const atas = await Promise.all(
    owners.map((o) => getAssociatedTokenAddress(USDC_MINT, o.pk, true)),
  );

  // One getMultipleAccountsInfo per ≤100 ATAs for USDC, and per ≤100 owners for SOL.
  await Promise.all([
    // USDC token accounts
    (async () => {
      const groups = chunk(owners.map((o, i) => ({ o, ata: atas[i] })), CHUNK);
      for (const g of groups) {
        const infos = await conn.getMultipleAccountsInfo(g.map((x) => x.ata), "confirmed").catch(() => []);
        g.forEach(({ o, ata }, i) => {
          const info = infos[i];
          let usdc = 0;
          if (info) {
            try {
              const acc = unpackAccount(ata, info, TOKEN_PROGRAM_ID);
              usdc = Number(acc.amount) / Math.pow(10, USDC_DECIMALS);
            } catch { /* not a token account / closed → 0 */ }
          }
          balances[o.wallet] = { usdc, sol: balances[o.wallet]?.sol ?? 0 };
        });
      }
    })(),
    // Native SOL
    (async () => {
      const groups = chunk(owners, CHUNK);
      for (const g of groups) {
        const infos = await conn.getMultipleAccountsInfo(g.map((x) => x.pk), "confirmed").catch(() => []);
        g.forEach((o, i) => {
          const sol = (infos[i]?.lamports ?? 0) / LAMPORTS_PER_SOL;
          balances[o.wallet] = { usdc: balances[o.wallet]?.usdc ?? 0, sol };
        });
      }
    })(),
  ]);

  // Cache the freshly-fetched balances so the next poll within the TTL skips RPC.
  for (const o of owners) if (balances[o.wallet]) balanceCache.set(o.wallet, { ...balances[o.wallet], at: now });

  return balances;
}

export async function GET(req: NextRequest) {
  try {
    const raw = new URL(req.url).searchParams.get("wallets") ?? "";
    const wallets = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const balances = await resolve(wallets);
    return NextResponse.json({ ok: true, balances, network: NETWORK, fetchedAt: Date.now() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lookup failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const wallets: string[] = Array.isArray(body?.wallets) ? body.wallets : [];
    const balances = await resolve(wallets);
    return NextResponse.json({ ok: true, balances, network: NETWORK, fetchedAt: Date.now() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lookup failed" }, { status: 500 });
  }
}
