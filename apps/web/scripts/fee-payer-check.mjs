import { readFileSync } from "node:fs";
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const SEC = get("PLATFORM_FEE_PAYER_SECRET");
const HELIUS = get("NEXT_PUBLIC_HELIUS_API_KEY");
const RPC = HELIUS ? `https://devnet.helius-rpc.com/?api-key=${HELIUS}` : "https://api.devnet.solana.com";
if (!SEC) { console.log("PLATFORM_FEE_PAYER_SECRET: NOT SET in .env.local"); process.exit(0); }
let kp; try { kp = Keypair.fromSecretKey(Buffer.from(SEC, "base64")); } catch (e) { console.log("PLATFORM_FEE_PAYER_SECRET present but not loadable: " + e.message); process.exit(0); }
const conn = new Connection(RPC, "confirmed");
const sol = await conn.getBalance(kp.publicKey, "confirmed");
console.log("fee-payer pubkey: " + kp.publicKey.toBase58());
console.log("fee-payer SOL:    " + (sol / LAMPORTS_PER_SOL).toFixed(6) + " SOL  (need ~0.01+ to sponsor settles)");
const T = get("NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET");
if (T) { const ts = await conn.getBalance(new PublicKey(T), "confirmed"); console.log("treasury SOL:     " + (ts / LAMPORTS_PER_SOL).toFixed(6) + " SOL  (" + T + ")"); }
