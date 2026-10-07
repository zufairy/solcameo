import { NextRequest, NextResponse } from "next/server";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from "@solana/spl-token";
import { getUsdcMint, getNetwork } from "@/lib/solana/network";
import { rpcTry, rpcCandidates } from "@/lib/solana/rpc";

export const maxDuration = 10;

const NETWORK = getNetwork();
const RPC_CANDIDATES = rpcCandidates(NETWORK);
const USDC_MINT = getUsdcMint(NETWORK);
const USDC_DECIMALS = 6;

// Module-scope TTL cache + in-flight dedupe (persists across requests on a warm
// instance). Breaks the mount-time burst of per-card balance polls that was
// rate-limiting the shared devnet Helius key (429 storm).
const CACHE = new Map<string, { v: { sol: number; usdc: number }; t: number }>();
const INFLIGHT = new Map<string, Promise<{ sol: number; usdc: number }>>();
const TTL_MS = 3_000;

async function readBalance(wallet: string, fresh = false): Promise<{ sol: number; usdc: number }> {
  const c = CACHE.get(wallet);
  if (!fresh && c && Date.now() - c.t < TTL_MS) return c.v;
  let p = INFLIGHT.get(wallet);
  if (!p) {
    p = (async () => {
      // Failover over public devnet → Helius (Helius key suspended 2026-08 → 403):
      // never collapse a suspended/rate-limited endpoint into a fake $0.
      const { sol, usdc } = await rpcTry(RPC_CANDIDATES, async (conn) => {
        const owner = new PublicKey(wallet);
        // CRITICAL: a missing USDC token account is a genuine 0, but ANY OTHER error
        // (429/timeout/network/suspension) must THROW so the caller reports the
        // balance as UNAVAILABLE — never a confident $0. A dead RPC previously
        // collapsed to usdc:0 and falsely denied funded agents with a 402.
        const [solLamports, usdcVal] = await Promise.all([
          conn.getBalance(owner, "confirmed"),
          (async () => {
            try {
              const ata = await getAssociatedTokenAddress(new PublicKey(USDC_MINT), owner);
              const acc = await getAccount(conn, ata, "confirmed");
              return Number(acc.amount) / Math.pow(10, USDC_DECIMALS);
            } catch (e) {
              if (e instanceof TokenAccountNotFoundError) return 0; // real empty wallet
              throw e; // 429/suspended/etc — bubble up for the next candidate
            }
          })(),
        ]);
        return { sol: solLamports / LAMPORTS_PER_SOL, usdc: usdcVal };
      }, 3000);
      return { sol, usdc };
    })()
      .then((v) => { CACHE.set(wallet, { v, t: Date.now() }); return v; })
      .finally(() => INFLIGHT.delete(wallet));
    INFLIGHT.set(wallet, p);
  }
  return p;
}

/**
 * Live on-chain balance of an agent's USDC + SOL.
 * Hit by the market page / influencer-profile / agent-wallet-card to show
 * what's actually in the trader's wallet — separate from the investment TVL
 * recorded on the influencers table.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });
  try { new PublicKey(wallet); } catch { return NextResponse.json({ ok: false, error: "invalid_wallet" }, { status: 400 }); }
  try {
    const { sol, usdc } = await readBalance(wallet, url.searchParams.get("fresh") === "1");
    return NextResponse.json({ ok: true, wallet, sol, usdc, network: NETWORK, fetchedAt: Date.now() });
  } catch (err) {
    // RPC unavailable (429/timeout). Report ok:false so callers do NOT read this as
    // a $0 balance (which falsely denied funded agents). Not a fake zero.
    return NextResponse.json({ ok: false, wallet, error: "rpc_unavailable", detail: err instanceof Error ? err.message : "rpc error" }, { status: 200 });
  }
}
