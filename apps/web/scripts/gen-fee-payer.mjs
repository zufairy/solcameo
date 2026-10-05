#!/usr/bin/env node
/**
 * Fee-payer (sponsored-gas) wallet helper for clip-fee settlement.
 *
 * This wallet ONLY pays the SOL transaction fee (+ ATA rent) when an agent's
 * service tab is swept to the treasury (lib/economy/settleAgent.ts), so agents
 * never need their own SOL. It is NOT the treasury — it just holds a little SOL
 * for gas. Keep it low-value and disposable: its secret lives in the app runtime
 * (Railway env), unlike the treasury, which should stay receive-only and never
 * expose its key.
 *
 * Modes:
 *   - PLATFORM_FEE_PAYER_SECRET already set (env or apps/web/.env.local):
 *       print its address + current devnet SOL balance (verify / fund mode).
 *   - Not set: GENERATE a fresh fee-payer keypair and print the address + the
 *       base64 secret to paste into PLATFORM_FEE_PAYER_SECRET (Railway).
 *
 * Run (from apps/web):  node scripts/gen-fee-payer.mjs
 * WARNING: in generate mode this prints a PRIVATE KEY. Run only in your own
 * terminal; never paste the secret line anywhere public.
 */
import { readFileSync } from "node:fs";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";

function fromEnvOrFile(name) {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const line = env.split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(`${name}=`.length).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

const rpc = process.env.NEXT_PUBLIC_HELIUS_API_KEY
  ? `https://devnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
  : "https://api.devnet.solana.com";

const existing = fromEnvOrFile("PLATFORM_FEE_PAYER_SECRET");

let kp;
if (existing) {
  kp = Keypair.fromSecretKey(new Uint8Array(Buffer.from(existing, "base64")));
  console.log("PLATFORM_FEE_PAYER_SECRET is already set.");
  console.log("Fee-payer address:", kp.publicKey.toBase58());
} else {
  kp = Keypair.generate();
  console.log("Generated a NEW fee-payer (gas) wallet — NOT the treasury.\n");
  console.log("Address (fund THIS with SOL):");
  console.log(" ", kp.publicKey.toBase58());
  console.log("\nPLATFORM_FEE_PAYER_SECRET (paste into Railway — keep secret):");
  console.log(" ", Buffer.from(kp.secretKey).toString("base64"));
  console.log();
}

const addr = kp.publicKey.toBase58();
try {
  const bal = await new Connection(rpc).getBalance(new PublicKey(addr));
  console.log("Devnet balance:", (bal / 1e9).toFixed(4), "SOL");
} catch (e) {
  console.log("Balance check failed:", e?.message ?? e);
}
console.log(`Fund it: solana airdrop 2 ${addr} --url devnet   (or paste into https://faucet.solana.com)`);
