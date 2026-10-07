import { createHash } from "node:crypto";
import { getRpcUrl } from "@/lib/solana/network";
import { ConvexHttpClient } from "convex/browser";
import { getTransactionDecoder, getBase64Encoder, createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { decodePaymentSignatureHeader, decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readAgentSecret } from "@/lib/economy/walletSecretAccess";
import { SOLANA_MAINNET, permittedRequirement, reportResource, REPORT_PRICE_MICROS, x402Config } from "./config";
import type { SolamiReport } from "../solami";

/** One operator-approved purchase per research task. Signed/unknown attempts retain their budget. */
export async function buyAgentResearch(mintAddress: string, taskId: Id<"agentTasks">, tokenMint: string) {
  const config = x402Config();
  const origin = process.env.X402_RESOURCE_ORIGIN ?? "";
  const resource = reportResource(origin, tokenMint);
  if (!resource.startsWith("https://") && !(process.env.NODE_ENV !== "production" && new URL(resource).hostname === "127.0.0.1")) throw new Error("Research endpoint must use HTTPS");
  const authSecret = process.env.INTERNAL_CRON_SECRET ?? "";
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const id = await convex.mutation(api.x402.reservePurchase, { taskId, mintAddress, resource, amountMicros: REPORT_PRICE_MICROS, authSecret });
  let purchase = await convex.query(api.x402.getPurchase, { id, authSecret });
  if (purchase?.state === "paid") return { report: JSON.parse(purchase.report!) as SolamiReport, receipt: purchase.receipt as string, amountMicros: REPORT_PRICE_MICROS };
  if (purchase?.state === "cancelled") throw new Error("Unsigned purchase was cancelled; start a new research task");
  try {
    if (purchase?.state === "reserved") {
      const initial = await fetch(resource, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (initial.status !== 402) throw new Error("Research service did not negotiate x402");
      const header = initial.headers.get("PAYMENT-REQUIRED");
      if (!header || header.length > 20_000) throw new Error("Invalid payment requirements");
      const required = decodePaymentRequiredHeader(header);
      if (required.x402Version !== 2 || required.resource.url !== resource) throw new Error("Unexpected payment resource");
      const policy = await convex.query(api.x402.getPolicyServer, { mintAddress, authSecret });
      if (!policy?.enabled || policy.network !== config.network || !policy.walletSecret || !policy.walletAddress) throw new Error("Agent signing wallet unavailable");
      const signer = await createKeyPairSignerFromBytes(new Uint8Array(Buffer.from(readAgentSecret(policy.walletSecret), "base64")));
      if (signer.address !== policy.walletAddress) throw new Error("Agent signer mismatch");
      const client = new x402Client().register(config.network, new ExactSvmScheme(signer, { rpcUrl: config.network === SOLANA_MAINNET ? getRpcUrl("mainnet-beta") : undefined }));
      // Only the configured Vello service/recipient/USDC/exact price; never LLM-supplied URLs.
      client.registerPolicy((version, requirements) => version === 2 ? requirements.filter(r => permittedRequirement(r, config, REPORT_PRICE_MICROS)) : []);
      const payload = await client.createPaymentPayload(required);
      const paymentHeader = encodePaymentSignatureHeader(payload);
      // Store signed payload before transmission. Concurrent callers can only transmit the winner's payload.
      await convex.mutation(api.x402.signPurchase, { id, paymentHeader, proofHash: createHash("sha256").update(Buffer.from(String(payload.payload.transaction), "base64")).digest("hex"), authSecret });
      purchase = await convex.query(api.x402.getPurchase, { id, authSecret });
    }
    if (!purchase?.paymentHeader) throw new Error("Purchase has no stored payment");
    const response = await fetch(resource, { headers: { "PAYMENT-SIGNATURE": purchase.paymentHeader }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(50_000) });
    if (response.status === 202) throw new Error("x402 settlement awaits reconciliation; do not create a new payment");
    if (response.status !== 200) throw new Error(`Paid research unavailable (${response.status}); preserve this purchase for recovery`);
    const encodedReceipt = response.headers.get("PAYMENT-RESPONSE");
    if (!encodedReceipt || encodedReceipt.length > 20_000) throw new Error("Missing settlement receipt");
    const receipt = decodePaymentResponseHeader(encodedReceipt);
    if (!receipt.success || !receipt.transaction || receipt.network !== config.network || receipt.payer !== purchasePayer(purchase.paymentHeader)) throw new Error("Invalid settlement receipt");
    const raw = await response.text();
    if (raw.length > 100_000) throw new Error("Research response too large");
    const report = JSON.parse(raw) as SolamiReport;
    if (report.provider !== "solami" || report.chain !== "solana-mainnet" || report.mint !== tokenMint || !report.evidence?.length) throw new Error("Unexpected research report");
    await convex.mutation(api.x402.completePurchase, { id, receipt: encodedReceipt, report: raw, authSecret });
    return { report, receipt: encodedReceipt, amountMicros: REPORT_PRICE_MICROS };
  } catch (error) {
    // A signed attempt can release only if an atomic seller tombstone prevents settlement.
    // A claimed/unknown settlement keeps its budget and original payload for recovery.
    await convex.mutation(api.x402.cancelUnsettledPurchase, { id, authSecret }).catch(() => {});
    throw error;
  }
}

// Payer is read from the durable transaction via the SDK decoder, not caller input.
function purchasePayer(header: string) {
  const payload = decodePaymentSignatureHeader(header);
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(String(payload.payload.transaction)));
  // Exact SVM payment has one client signer besides the facilitator's fee payer.
  const signed = Object.entries(tx.signatures).filter(([, signature]) => signature !== null);
  if (signed.length !== 1) throw new Error("Expected one agent signature");
  return signed[0][0];
}
