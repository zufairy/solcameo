import { NextRequest, NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { buildSolamiReport } from "@/lib/server/solami";
import { getResourceServer } from "@/lib/server/x402/resourceServer";
import { permittedRequirement, reportResource, REPORT_PRICE_MICROS } from "@/lib/server/x402/config";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE" };

/** Public agent API. Payment grants this report only, never ownership of a Vello agent. */
export async function GET(req: NextRequest) {
  let proofHash: string | undefined;
  let claimed = false;
  let confirmedReceipt: string | undefined;
  const authSecret = process.env.INTERNAL_CRON_SECRET ?? "";
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (process.env.X402_ENABLED !== "true") return NextResponse.json({ error: "x402_disabled" }, { status: 503, headers });
  if (!convexUrl || !authSecret || !process.env.SOLAMI_API_KEY) return NextResponse.json({ error: "intelligence_not_configured" }, { status: 503, headers });
  const convex = new ConvexHttpClient(convexUrl);
  try {
    const mint = req.nextUrl.searchParams.get("mint") ?? "";
    let resource: string;
    try { resource = reportResource(process.env.X402_RESOURCE_ORIGIN ?? "", mint); }
    catch { return NextResponse.json({ error: "invalid_mint_or_resource_origin" }, { status: 400, headers }); }
    const paymentHeader = req.headers.get("PAYMENT-SIGNATURE");
    if (paymentHeader && paymentHeader.length > 20_000) return NextResponse.json({ error: "payment_too_large" }, { status: 400, headers });
    const { server, requirements, config } = await getResourceServer();
    const required = await server.createPaymentRequiredResponse(requirements, { url: resource, description: "Live Solami token research with 5m/1h/24h activity and transaction evidence", mimeType: "application/json" });
    if (!paymentHeader) return NextResponse.json({ error: "payment_required" }, { status: 402, headers: { ...headers, "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) } });
    const payload = decodePaymentSignatureHeader(paymentHeader);
    // Match SDK-created full requirement including facilitator feePayer. Never trust client pricing.
    const requirement = requirements.find(r => isDeepStrictEqual(r, payload.accepted));
    if (payload.x402Version !== 2 || payload.resource?.url !== resource || !requirement || !permittedRequirement(requirement, config, REPORT_PRICE_MICROS)) {
      return NextResponse.json({ error: "payment_requirement_mismatch" }, { status: 400, headers });
    }
    const transaction = payload.payload.transaction;
    if (typeof transaction !== "string" || !transaction || transaction.length > 12_000) return NextResponse.json({ error: "invalid_solana_payment" }, { status: 400, headers });
    // Deduplicate the signed transaction, not mutable JSON wrappers or header encodings.
    proofHash = createHash("sha256").update(Buffer.from(transaction, "base64")).digest("hex");
    const prior = await convex.query(api.x402.getReport, { proofHash, authSecret });
    if (prior) {
      if (prior.state === "cancelled") return NextResponse.json({ error: "payment_cancelled_before_settlement", charged: false }, { status: 409, headers });
      if (prior.resource !== resource) return NextResponse.json({ error: "proof_already_bound_to_another_resource" }, { status: 409, headers });
      if (prior.state === "unknown" && prior.receipt) {
        const { decodePaymentResponseHeader } = await import("@x402/core/http");
        const storedReceipt = decodePaymentResponseHeader(prior.receipt);
        claimed = true;
        await convex.mutation(api.x402.finishReport, { proofHash, receipt: prior.receipt, txSignature: storedReceipt.transaction, authSecret });
        return NextResponse.json(JSON.parse(prior.report), { headers: { ...headers, "PAYMENT-RESPONSE": prior.receipt } });
      }
      if (prior.state === "paid" && prior.receipt) return NextResponse.json(JSON.parse(prior.report), { headers: { ...headers, "PAYMENT-RESPONSE": prior.receipt } });
      return NextResponse.json({ error: "settlement_pending_reconciliation", proofHash, retryWithSamePayment: true }, { status: 202, headers });
    }
    const verified = await server.verifyPayment(payload, requirement);
    if (!verified.isValid) return NextResponse.json({ error: "invalid_payment" }, { status: 402, headers });
    // Complete and validate the live data BEFORE authorizing settlement. No LLM delay here.
    const report = await buildSolamiReport(mint);
    claimed = await convex.mutation(api.x402.claimReport, { proofHash, resource, report: JSON.stringify(report), paymentHeader, authSecret });
    if (!claimed) return NextResponse.json({ error: "settlement_in_progress", retryWithSamePayment: true }, { status: 202, headers });
    const receipt = await server.settlePayment(payload, requirement);
    if (!receipt.success || !receipt.transaction || receipt.network !== config.network) throw new Error("Settlement not confirmed");
    const encodedReceipt = encodePaymentResponseHeader(receipt);
    confirmedReceipt = encodedReceipt;
    await convex.mutation(api.x402.finishReport, { proofHash, receipt: encodedReceipt, txSignature: receipt.transaction, authSecret });
    return NextResponse.json(report, { headers: { ...headers, "PAYMENT-RESPONSE": encodedReceipt } });
  } catch {
    if (claimed && proofHash) {
      await convex.mutation(api.x402.markReportUnknown, { proofHash, receipt: confirmedReceipt, authSecret }).catch(() => {});
      return NextResponse.json({ error: "settlement_pending_reconciliation", proofHash, retryWithSamePayment: true }, { status: 202, headers });
    }
    return NextResponse.json({ error: "intelligence_unavailable", newSettlementAttempted: false }, { status: 503, headers });
  }
}
