// Read the vello-escrow PlatformConfig and print the oracle pubkey + treasury +
// windows. No secrets involved — pure public-chain reads.
//   RPC_URL=https://api.mainnet-beta.solana.com node scripts/read-platform-config.mjs
import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID ?? "Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx",
);
const idlPath = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "vello-escrow-idl.json");
const idl = JSON.parse(readFileSync(idlPath, "utf8"));

function rpcUrl() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const net = (process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet").toLowerCase();
  return net.startsWith("mainnet") ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
}
const conn = new Connection(rpcUrl(), "confirmed");

// PDA seeds per the IDL (platform config account)
const seedGuesses = [["vello:config"], ["platform_config"], ["config"]];
let cfgAddr = null;
for (const seeds of seedGuesses) {
  const [pda] = PublicKey.findProgramAddressSync(seeds.map((s) => Buffer.from(s)), PROGRAM_ID);
  const info = await conn.getAccountInfo(pda);
  if (info) { cfgAddr = { pda, info, seeds }; break; }
}
if (!cfgAddr) { console.error("PlatformConfig PDA not found under any seed guess"); process.exit(1); }

console.log("PlatformConfig PDA:", cfgAddr.pda.toBase58(), "(seeds:", cfgAddr.seeds.join(","), ")");
const coder = new BorshAccountsCoder(idl);
const name = idl.accounts.find((a) => /platform/i.test(a.name))?.name;
const cfg = coder.decode(name, cfgAddr.info.data);
for (const [k, v] of Object.entries(cfg)) {
  console.log(`  ${k}:`, v?.toBase58 ? v.toBase58() : v?.toString?.() ?? v);
}
