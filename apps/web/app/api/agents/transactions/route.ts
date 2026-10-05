import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getNetwork, getUsdcMint } from "@/lib/solana/network";
import { rpcCandidates, rpcTry } from "@/lib/solana/rpc";

export const maxDuration = 15;

/**
 * Live on-chain activity for an agent wallet, read straight from Solana RPC
 * (failover across candidates). Each row is the wallet's own USDC / SOL balance
 * change in one confirmed transaction, so the agents popup never depends on a
 * database mirror for "what actually moved".
 *
 * GET /api/agents/transactions?wallet=<base58>&limit=20
 */
export interface OnchainTx {
  signature: string;
  ts: number | null;
  ok: boolean;
  usdc: number;
  sol: number;
  fee: number;
  counterparty: string | null;
}

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; rows: OnchainTx[] }>();

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 20, 1), 40);
  let owner: PublicKey;
  try { owner = new PublicKey(wallet); } catch { return NextResponse.json({ ok: false, error: "Invalid wallet" }, { status: 400 }); }

  const network = getNetwork();
  const key = `${network}:${wallet}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ ok: true, network, rows: hit.rows });

  try {
    const urls = rpcCandidates(network);
    const usdcMint = getUsdcMint(network);
    const sigs = await rpcTry(urls, (c) => c.getSignaturesForAddress(owner, { limit }, "confirmed"));
    if (sigs.length === 0) { cache.set(key, { at: Date.now(), rows: [] }); return NextResponse.json({ ok: true, network, rows: [] }); }
    const txs = await rpcTry(urls, (c) => c.getParsedTransactions(sigs.map((s) => s.signature), { maxSupportedTransactionVersion: 0, commitment: "confirmed" }));

    const rows: OnchainTx[] = sigs.map((s, i) => {
      const tx = txs[i];
      const meta = tx?.meta;
      let usdc = 0, sol = 0, counterparty: string | null = null;
      if (tx && meta) {
        const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
        const idx = keys.indexOf(wallet);
        if (idx >= 0) sol = (meta.postBalances[idx] - meta.preBalances[idx]) / 1e9;
        const bal = (list: typeof meta.preTokenBalances, o: string) =>
          (list ?? []).filter((b) => b.mint === usdcMint && b.owner === o).reduce((a, b) => a + Number(b.uiTokenAmount.amount), 0);
        usdc = (bal(meta.postTokenBalances, wallet) - bal(meta.preTokenBalances, wallet)) / 1e6;
        // Counterparty = the other owner whose USDC moved the opposite way (else the other SOL account).
        const owners = new Set([...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])].filter((b) => b.mint === usdcMint && b.owner && b.owner !== wallet).map((b) => b.owner as string));
        for (const o of owners) { const d = bal(meta.postTokenBalances, o) - bal(meta.preTokenBalances, o); if (usdc !== 0 && Math.sign(d) === -Math.sign(usdc)) { counterparty = o; break; } }
        if (!counterparty && usdc === 0 && idx >= 0) {
          const other = keys.findIndex((_, k) => k !== idx && Math.sign(meta.postBalances[k] - meta.preBalances[k]) === -Math.sign(sol) && meta.postBalances[k] !== meta.preBalances[k]);
          if (other >= 0 && keys[other] !== "11111111111111111111111111111111") counterparty = keys[other];
        }
      }
      return { signature: s.signature, ts: s.blockTime ?? null, ok: !s.err, usdc, sol, fee: (meta?.fee ?? 0) / 1e9, counterparty };
    });
    cache.set(key, { at: Date.now(), rows });
    return NextResponse.json({ ok: true, network, rows }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "RPC read failed" }, { status: 502 });
  }
}
