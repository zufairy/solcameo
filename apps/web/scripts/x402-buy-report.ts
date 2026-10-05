/** Disposable demo agent. Default: inspect the price without spending. */
import { readFile, writeFile, access } from "node:fs/promises";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { permittedRequirement, reportResource, REPORT_PRICE_MICROS, SOLANA_MAINNET, x402Config } from "../lib/server/x402/config";

async function main() {
  const args = process.argv.slice(2);
  const mint = args.find(a => !a.startsWith("--"));
  if (!mint) throw new Error("Usage: npm run x402:report -- <mainnet-token-mint> [--pay] [--payment-file=./payment.json]");
  const config = x402Config();
  const resource = reportResource(process.env.X402_RESOURCE_ORIGIN ?? "", mint);
  if (!resource.startsWith("https://") && !(process.env.NODE_ENV !== "production" && new URL(resource).hostname === "127.0.0.1")) throw new Error("Use HTTPS or development loopback");
  const file = args.find(a => a.startsWith("--payment-file="))?.slice("--payment-file=".length) ?? "./x402-demo-payment.json";
  const exists = await access(file).then(() => true, () => false);
  let saved: { resource: string; paymentHeader: string } | undefined;
  if (exists) {
    const raw = await readFile(file,"utf8");
    if (raw.length > 25_000) throw new Error("Payment file too large");
    try { saved = JSON.parse(raw); } catch { throw new Error("Invalid payment file"); }
    if (saved?.resource !== resource) throw new Error("Payment file belongs to another resource; use its original token/configuration");
    const payload = decodePaymentSignatureHeader(saved.paymentHeader);
    if (payload.x402Version !== 2 || payload.resource?.url !== resource || !permittedRequirement(payload.accepted,config,REPORT_PRICE_MICROS)) throw new Error("Stored payment violates the configured policy");
  }
  if (!args.includes("--pay")) {
    const response = await fetch(resource,{redirect:"error",signal:AbortSignal.timeout(20_000)});
    const header = response.headers.get("PAYMENT-REQUIRED");
    if (response.status !== 402 || !header) throw new Error(`No x402 challenge (${response.status})`);
    const required = decodePaymentRequiredHeader(header);
    if (required.x402Version !== 2 || required.resource.url !== resource || !required.accepts.some(r=>permittedRequirement(r,config,REPORT_PRICE_MICROS))) throw new Error("Unexpected payment policy");
    console.log(JSON.stringify({resource,priceUsdc:0.01,paymentRequired:required,spending:false},null,2));
    return;
  }
  if (!saved) {
    if (process.env.NODE_ENV === "production") throw new Error("Use a constrained signing service in production; this raw-key script is for disposable demo wallets");
    const secret = process.env.X402_DEMO_SECRET_BASE64;
    if (!secret) throw new Error("Set X402_DEMO_SECRET_BASE64 for a disposable funded demo wallet");
    const response = await fetch(resource,{redirect:"error",signal:AbortSignal.timeout(20_000)});
    const header = response.headers.get("PAYMENT-REQUIRED");
    if (response.status !== 402 || !header) throw new Error(`No x402 challenge (${response.status})`);
    const required = decodePaymentRequiredHeader(header);
    if (required.x402Version !== 2 || required.resource.url !== resource) throw new Error("Unexpected resource");
    const signer = await createKeyPairSignerFromBytes(new Uint8Array(Buffer.from(secret,"base64")));
    const client = new x402Client().register(config.network,new ExactSvmScheme(signer,{rpcUrl:config.network===SOLANA_MAINNET?process.env.SOLAMI_RPC_URL:undefined}));
    client.registerPolicy((version,requirements)=>version===2?requirements.filter(r=>permittedRequirement(r,config,REPORT_PRICE_MICROS)):[]);
    const payload = await client.createPaymentPayload(required);
    saved = {resource,paymentHeader:encodePaymentSignatureHeader(payload)};
    // Exclusive durable write BEFORE transmission. Never overwrite an existing authorization.
    await writeFile(file,JSON.stringify(saved),{flag:"wx",mode:0o600});
  }
  const response = await fetch(resource,{headers:{"PAYMENT-SIGNATURE":saved.paymentHeader},redirect:"error",signal:AbortSignal.timeout(50_000)});
  if (response.status !== 200) throw new Error(`Payment/report pending or unavailable (${response.status}). Preserve ${file}; repeat the same command, never delete it to repay.`);
  const encoded = response.headers.get("PAYMENT-RESPONSE");
  if (!encoded) throw new Error(`Missing receipt. Preserve ${file} for recovery.`);
  const receipt = decodePaymentResponseHeader(encoded);
  if (!receipt.success || !receipt.transaction || receipt.network !== config.network) throw new Error(`Invalid receipt. Preserve ${file} for recovery.`);
  console.log(JSON.stringify({receipt,report:await response.json()},null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Demo failed");process.exitCode=1;});
