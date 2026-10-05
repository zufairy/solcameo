import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, unpackAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getNetwork, getUsdcMint } from "@/lib/solana/network";
import { rpcCandidates, rpcTry } from "@/lib/solana/rpc";

export const maxDuration = 15;

/**
 * Leaderboard on-chain proof, read straight from the Solana RPC (with failover
 * across candidate endpoints). For every agent it returns:
 *   - walletUsdc: live USDC balance of the agent's wallet ATA
 *   - verified / checked: how many of its most recent paid payout signatures are
 *     confirmed (no error) on the cluster
 * Earnings themselves are ranked from the distributions ledger; this route is
 * the independent check that the money is real.
 *
 * POST { mints: string[] } → { ok, network, fetchedAt, agents: { [mint]: {...} } }
 */
type Target = { mintAddress: string; wallet: string | null; signatures: string[] };
type Proof = { wallet: string | null; walletUsdc: number | null; verified: number; checked: number };

const TARGETS = makeFunctionReference<"query">("tournament:onchainTargets");
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; proof: Proof }>();

const chunk = <T,>(arr: T[], n: number): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { mints?: unknown };
  const mints = Array.isArray(body.mints) ? [...new Set(body.mints.filter((m): m is string => typeof m === "string" && m.length > 0 && m.length < 100))].slice(0, 120) : [];
  if (mints.length === 0) return NextResponse.json({ ok: true, agents: {} });

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });

  const network = getNetwork();
  const now = Date.now();
  const out: Record<string, Proof> = {};
  const stale: string[] = [];
  for (const m of mints) {
    const hit = cache.get(m);
    if (hit && now - hit.at < TTL_MS) out[m] = hit.proof; else stale.push(m);
  }

  if (stale.length > 0) {
    try {
      const targets = (await new ConvexHttpClient(convexUrl).query(TARGETS, { mints: stale })) as Target[];
      const usdc = new PublicKey(getUsdcMint(network));
      const owners = targets.map((t) => { try { return t.wallet ? new PublicKey(t.wallet) : null; } catch { return null; } });
      const atas = await Promise.all(owners.map((o) => (o ? getAssociatedTokenAddress(usdc, o, true) : Promise.resolve(null))));
      const urls = rpcCandidates(network);

      const balances = new Map<string, number>();
      const live = atas.map((a, i) => ({ a, i })).filter((x): x is { a: PublicKey; i: number } => !!x.a);
      await Promise.all(chunk(live, 100).map(async (g) => {
        const infos = await rpcTry(urls, (c) => c.getMultipleAccountsInfo(g.map((x) => x.a), "confirmed")).catch(() => null);
        g.forEach(({ a, i }, k) => {
          const info = infos?.[k];
          if (infos === null) return; // RPC down → leave unknown (null), don't claim 0
          let amount = 0;
          if (info) { try { amount = Number(unpackAccount(a, info, TOKEN_PROGRAM_ID).amount) / 1e6; } catch { /* not a token account */ } }
          balances.set(targets[i].mintAddress, amount);
        });
      }));

      const allSigs = [...new Set(targets.flatMap((t) => t.signatures))];
      const confirmed = new Set<string>();
      await Promise.all(chunk(allSigs, 200).map(async (g) => {
        const res = await rpcTry(urls, (c) => c.getSignatureStatuses(g, { searchTransactionHistory: true })).catch(() => null);
        res?.value.forEach((st, k) => { if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) confirmed.add(g[k]); });
      }));

      for (const t of targets) {
        const proof: Proof = {
          wallet: t.wallet,
          walletUsdc: t.wallet ? (balances.get(t.mintAddress) ?? null) : null,
          verified: t.signatures.filter((s) => confirmed.has(s)).length,
          checked: t.signatures.length,
        };
        out[t.mintAddress] = proof;
        cache.set(t.mintAddress, { at: now, proof });
      }
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "On-chain read failed", agents: out }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: true, network, fetchedAt: now, agents: out }, { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" } });
}
