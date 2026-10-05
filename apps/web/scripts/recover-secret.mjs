import { readFileSync } from "node:fs";
import { Keypair, Connection } from "@solana/web3.js";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const s = get("PLATFORM_FEE_PAYER_SECRET");
const raw = Buffer.from(s, "base64");
console.log("decoded bytes:", raw.length);
const HELIUS = get("NEXT_PUBLIC_HELIUS_API_KEY");
const conn = new Connection(HELIUS ? `https://devnet.helius-rpc.com/?api-key=${HELIUS}` : "https://api.devnet.solana.com");
const tryKey = async (bytes, label) => {
  try {
    const kp = Keypair.fromSecretKey(new Uint8Array(bytes));
    let bal = "?"; try { bal = ((await conn.getBalance(kp.publicKey)) / 1e9).toFixed(4); } catch {}
    console.log(`${label}: VALID -> address ${kp.publicKey.toBase58()}  SOL=${bal}`);
    console.log(`  corrected base64 (${Buffer.from(bytes).length}B): ${Buffer.from(bytes).toString("base64")}`);
  } catch (e) { console.log(`${label}: invalid (${String(e.message).slice(0, 32)})`); }
};
if (raw.length === 65) { await tryKey(raw.slice(0, 64), "strip LAST byte "); await tryKey(raw.slice(1, 65), "strip FIRST byte"); }
else await tryKey(raw, "as-is");
