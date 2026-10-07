import { NextRequest, NextResponse } from "next/server";
import { getRpcUrl } from "@/lib/solana/network";
import { Connection } from "@solana/web3.js";
import { getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { checkInternalSecret } from "@/lib/server/requireAuth";
import { SOLANA_MAINNET, x402Config } from "@/lib/server/x402/config";
export const runtime = "nodejs";
/** Recovery verifies an existing chain transaction. It never resubmits a payment. */
export async function POST(req: NextRequest) {
  if (!checkInternalSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!/^[a-f0-9]{64}$/.test(body.proofHash ?? "") || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(body.txSignature ?? "")) return NextResponse.json({ error: "Invalid proof or signature" }, { status: 400 });
  const authSecret = process.env.INTERNAL_CRON_SECRET!;
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const stored = await convex.query(api.x402.getReport, { proofHash: body.proofHash, authSecret });
  if (!stored) return NextResponse.json({ error: "Unknown proof" }, { status: 404 });
  if (stored.state === "cancelled") return NextResponse.json({ error: "Payment cancelled before settlement" }, { status: 409 });
  if (stored.state === "paid") return NextResponse.json({ ok: true, alreadyPaid: true });
  const config = x402Config();
  const rpcUrl = config.network === SOLANA_MAINNET ? getRpcUrl("mainnet-beta") : getRpcUrl("devnet");
  if (!rpcUrl) return NextResponse.json({ error: "Configure SOLAMI_RPC_URL for mainnet recovery" }, { status: 503 });
  const conn = new Connection(rpcUrl, "confirmed");
  // Prevent an incorrectly configured endpoint from proving payment on the wrong chain.
  const genesis = await conn.getGenesisHash();
  if (`solana:${genesis.slice(0, 32)}` !== config.network) return NextResponse.json({ error: "RPC network mismatch" }, { status: 503 });
  const landed = await conn.getTransaction(body.txSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!landed?.meta || landed.meta.err) return NextResponse.json({ error: "Successful confirmed transaction required" }, { status: 409 });
  const payment = decodePaymentSignatureHeader(stored.paymentHeader);
  if (payment.accepted.network !== config.network) return NextResponse.json({ error: "Payment network mismatch" }, { status: 409 });
  const signed = getTransactionDecoder().decode(getBase64Encoder().encode(String(payment.payload.transaction)));
  if (!Buffer.from(signed.messageBytes).equals(Buffer.from(landed.transaction.message.serialize()))) return NextResponse.json({ error: "Transaction does not match the reserved payment" }, { status: 409 });
  const payer = Object.entries(signed.signatures).filter(([, sig]) => sig !== null)[0]?.[0];
  const receipt = encodePaymentResponseHeader({ success: true, transaction: body.txSignature, network: config.network, payer });
  await convex.mutation(api.x402.finishReport, { proofHash: body.proofHash, receipt, txSignature: body.txSignature, authSecret });
  return NextResponse.json({ ok: true, proofHash: body.proofHash, receipt });
}
