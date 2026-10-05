#!/usr/bin/env node
/**
 * Print the NFT mint-authority address (the wallet that PAYS the devnet SOL for
 * every agent mint, ~0.011 SOL each) + its current devnet balance. Fund THIS
 * address from the faucet. Reads NFT_MINT_AUTHORITY_SECRET from the env or
 * apps/web/.env.local. Run: `node scripts/mint-authority-address.mjs`
 */
import { readFileSync } from "node:fs";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";

let secret = process.env.NFT_MINT_AUTHORITY_SECRET;
if (!secret) {
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const line = env.split("\n").find((l) => l.startsWith("NFT_MINT_AUTHORITY_SECRET="));
    secret = line?.slice("NFT_MINT_AUTHORITY_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  } catch { /* no .env.local */ }
}
if (!secret) {
  console.error("NFT_MINT_AUTHORITY_SECRET not found (env or apps/web/.env.local).");
  process.exit(1);
}

const kp = Keypair.fromSecretKey(new Uint8Array(Buffer.from(secret, "base64")));
const addr = kp.publicKey.toBase58();
console.log("Mint authority address:", addr);

const rpc = process.env.NEXT_PUBLIC_HELIUS_API_KEY
  ? `https://devnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
  : "https://api.devnet.solana.com";
try {
  const bal = await new Connection(rpc).getBalance(new PublicKey(addr));
  console.log("Devnet balance:", (bal / 1e9).toFixed(4), "SOL", `(~${Math.floor(bal / 1e9 / 0.011)} mints left)`);
} catch (e) {
  console.log("Balance check failed:", e?.message ?? e);
}
console.log(`Fund it: solana airdrop 2 ${addr} --url devnet   (or paste into https://faucet.solana.com)`);
