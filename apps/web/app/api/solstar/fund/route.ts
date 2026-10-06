import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexClient, errorResponse, isConvexIdString, prepareAuthedJson } from "@/lib/server/solstarRoute";
import { rpcCandidates, rpcTry } from "@/lib/solana/rpc";
import { verifyFundingTx, type ParsedFundingTx } from "@/lib/solstar/fundVerify";

export const runtime = "nodejs";
export const maxDuration = 30;

function feeWallet(): string | null {
  try { return new PublicKey(process.env.SOLCAMEO_PLATFORM_WALLET ?? "").toBase58(); } catch { return null; }
}

/** Where a top-up must be sent: the agent's treasury (97%) and the platform fee wallet (3%). */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("characterId");
  if (!isConvexIdString(id)) return NextResponse.json({ error: "invalid_character_id" }, { status: 400 });
  const fee = feeWallet();
  try {
    const s = await convexClient().query(api.solstarFlywheel.status, { characterId: id as Id<"ssCharacters"> });
    if (!s || s.network === "paper" || !s.treasury || !fee) return NextResponse.json({ available: false }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ available: true, network: s.network, treasury: s.treasury, feeWallet: fee }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}

/**
 * Credit a top-up the caller already sent on chain. The transaction is re-read from the cluster and must be signed
 * by the proven wallet, pay the treasury, and include the 3% platform fee; only then is the budget credited.
 */
export async function POST(req: NextRequest) {
  const prep = await prepareAuthedJson(req);
  if (!prep.ok) return prep.res;
  const { body, wallet, secret } = prep;
  const { characterId, signature } = body;
  if (!isConvexIdString(characterId)) return NextResponse.json({ error: "invalid_character_id" }, { status: 400 });
  if (typeof signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(signature)) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  const fee = feeWallet();
  try {
    const client = convexClient();
    const s = await client.query(api.solstarFlywheel.status, { characterId: characterId as Id<"ssCharacters"> });
    if (!s || s.network === "paper" || !s.treasury || !fee) return NextResponse.json({ error: "funding_unavailable" }, { status: 409 });
    const tx = await rpcTry(rpcCandidates(s.network === "mainnet" ? "mainnet-beta" : "devnet"), (c) =>
      c.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
    if (!tx) return NextResponse.json({ error: "not_confirmed" }, { status: 202 });
    const verdict = verifyFundingTx(tx as unknown as ParsedFundingTx, { payer: wallet, treasury: s.treasury, feeWallet: fee });
    if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 422 });
    const r = await client.mutation(api.solstarBudget.creditTopUp, { characterId: characterId as Id<"ssCharacters">, wallet, signature, lamports: verdict.netLamports, authSecret: secret });
    return NextResponse.json({ ok: true, reused: r.reused, credited: verdict.netLamports.toString(), fee: verdict.feeLamports.toString() });
  } catch (e) { return errorResponse(e); }
}
