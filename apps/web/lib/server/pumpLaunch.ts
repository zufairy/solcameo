import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";
import { getDbcRpcUrl, getNetwork } from "@/lib/solana/network";
import { type LaunchOptions, rewardSplit } from "@/lib/pump/economics";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export function pumpReadiness() {
  if (process.env.SOLCAMEO_PUMP_LIVE_ENABLED !== "true") return { ready: false, reason: "Live Pump launches are not enabled on this server." };
  if (getNetwork() !== "mainnet-beta") return { ready: false, reason: "Wallet signing is configured for devnet. Pump launches require mainnet." };
  if (!getDbcRpcUrl("mainnet-beta")) return { ready: false, reason: "A mainnet Pump RPC endpoint is required." };
  try { new PublicKey(process.env.SOLCAMEO_PLATFORM_WALLET ?? ""); } catch { return { ready: false, reason: "Solcameo's fee recipient wallet is not configured." }; }
  return { ready: true, reason: "Mainnet wallet approval required. Fee-sharing is permanent." };
}
export function pumpConnection() {
  const readiness = pumpReadiness();
  if (!readiness.ready) throw new Error(readiness.reason);
  return new Connection(getDbcRpcUrl("mainnet-beta"), "confirmed");
}
export function publicWallet(address: string) {
  const key = new PublicKey(address);
  if (!PublicKey.isOnCurve(key.toBytes())) throw new Error("Use a valid Solana wallet address.");
  return key;
}
export function pumpShareholders(options: LaunchOptions, creator: string) {
  const split = rewardSplit(options);
  const entries = [[process.env.SOLCAMEO_PLATFORM_WALLET!, split.platform], [options.operationsWallet, split.ai], [creator, split.creator]] as const;
  const combined = new Map<string, number>();
  for (const [address, bps] of entries) if (bps > 0) { publicWallet(address); combined.set(address, (combined.get(address) ?? 0) + bps); }
  return Array.from(combined, ([address, shareBps]) => ({ address: new PublicKey(address), shareBps }));
}
export interface PumpReceipt {
  wallet: string; characterId: string; mint: string; options: LaunchOptions; stage: "launch" | "sharing" | "payout";
  messageHash: string; expires: number; launchSignature?: string;
}
function receiptSecret() { const value = process.env.INTERNAL_CRON_SECRET; if (!value) throw new Error("Launch receipt signing is not configured."); return value; }
export function signPumpReceipt(receipt: PumpReceipt) {
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  return `${payload}.${createHmac("sha256", receiptSecret()).update(payload).digest("base64url")}`;
}
export function readPumpReceipt(token: string, wallet: string): PumpReceipt {
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra) throw new Error("Invalid launch receipt.");
  const expected = createHmac("sha256", receiptSecret()).update(payload).digest();
  const actual = Buffer.from(mac, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid launch receipt.");
  const receipt = JSON.parse(Buffer.from(payload, "base64url").toString()) as PumpReceipt;
  if (receipt.wallet !== wallet || receipt.expires < Date.now()) throw new Error("Launch receipt expired or belongs to another wallet.");
  return receipt;
}
export function pumpMessageHash(tx: VersionedTransaction) { return createHash("sha256").update(tx.message.serialize()).digest("hex"); }
export async function unsignedPumpTransaction(connection: Connection, wallet: PublicKey, instructions: TransactionInstruction[], options: { priorityMicroLamports?: number; computeUnitLimit?: number } = {}) {
  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: block.blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: options.computeUnitLimit ?? 500_000 }), ...(options.priorityMicroLamports ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: options.priorityMicroLamports })] : []), ...instructions] }).compileToV0Message());
  const raw = tx.serialize();
  if (raw.length > 1232) throw new Error("This launch exceeds Solana's transaction size limit. Try SOL without starting funds.");
  return { tx, transaction: Buffer.from(raw).toString("base64"), lastValidBlockHeight: block.lastValidBlockHeight };
}
export async function verifyPumpTransaction(connection: Connection, signature: string, receipt: PumpReceipt) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(signature)) throw new Error("Invalid transaction signature.");
  const transaction = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!transaction || transaction.meta?.err) throw new Error("Transaction is not confirmed successfully yet.");
  const hash = createHash("sha256").update(transaction.transaction.message.serialize()).digest("hex");
  if (hash !== receipt.messageHash) throw new Error("Transaction does not match the reviewed launch.");
}
