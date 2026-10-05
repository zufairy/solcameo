// Verify the oracle/crank signer env keys against the on-chain PlatformConfig.
// Prints ONLY pubkeys + SOL balances + PASS/FAIL — never the secrets.
//
// Run wherever the REAL env lives:
//   Railway:  railway run node scripts/verify-oracle-keys.mjs      (from apps/web, service linked)
//   locally:  VELLO_ORACLE_SECRET=... VELLO_CRANK_SECRET=... node scripts/verify-oracle-keys.mjs
//
// Cluster: RPC_URL wins; otherwise derived from NEXT_PUBLIC_SOLANA_NETWORK (the env
// Railway actually has), falling back to devnet.
//
// PlatformConfig.oracle is the ONLY key record_performance accepts; the crank key
// just pays gas + ATA rent for claim_payout. Both must hold SOL or the on-chain
// rail silently falls back to off-chain bookkeeping.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function rpcUrl() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  const net = (process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet").toLowerCase();
  const helius = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
  if (net.startsWith("mainnet"))
    return helius ? `https://mainnet.helius-rpc.com/?api-key=${helius}` : "https://api.mainnet-beta.solana.com";
  return "https://api.devnet.solana.com";
}
const conn = new Connection(rpcUrl(), "confirmed");
console.log(`cluster: ${rpcUrl().replace(/api-key=[^&]+/, "api-key=***")}`);

// Mirrors lib/trader/usdcTransfer.ts loadKeypair (base64 64-byte secret key).
function load(name) {
  const v = process.env[name];
  if (!v) return { name, err: "UNSET" };
  try {
    return { name, kp: Keypair.fromSecretKey(Buffer.from(v, "base64")) };
  } catch (e) {
    return { name, err: `unparseable (${e.message})` };
  }
}

// Decode the LIVE PlatformConfig and compare the oracle FIELD exactly (a raw
// containment check could false-pass on the authority/treasury fields).
const programId = new PublicKey(
  process.env.NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID ?? "Gztj63kcdst6YrdyCGPoWAgLqDGJZAG43UQqtDY8HVxx",
);
const [cfgPda] = PublicKey.findProgramAddressSync([Buffer.from("vello:config")], programId);
const cfgInfo = await conn.getAccountInfo(cfgPda);
let onChainOracle = null;
if (cfgInfo) {
  try {
    const idlPath = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "vello-escrow-idl.json");
    const idl = JSON.parse(readFileSync(idlPath, "utf8"));
    const coder = new BorshAccountsCoder(idl);
    const acctName = idl.accounts.find((a) => /platform/i.test(a.name))?.name;
    onChainOracle = coder.decode(acctName, cfgInfo.data).oracle.toBase58();
  } catch (e) {
    console.log(`⚠ could not decode PlatformConfig (${e.message}) — oracle match unverified`);
  }
}

let fail = false;
for (const { name, kp, err } of [load("VELLO_ORACLE_SECRET"), load("VELLO_CRANK_SECRET")]) {
  if (err) { console.log(`${name}: ❌ ${err}`); fail = true; continue; }
  const pub = kp.publicKey.toBase58();
  const sol = (await conn.getBalance(kp.publicKey)) / 1e9;
  let oracleNote = "";
  if (name === "VELLO_ORACLE_SECRET") {
    if (!cfgInfo) {
      oracleNote = " — ❌ PlatformConfig NOT initialized on this cluster (cannot verify oracle match)";
      fail = true;
    } else if (onChainOracle === null) {
      oracleNote = " — ⚠ oracle match UNVERIFIED (decode failed)";
      fail = true;
    } else if (onChainOracle === pub) {
      oracleNote = " — matches on-chain PlatformConfig.oracle ✅";
    } else {
      oracleNote = ` — ❌ on-chain PlatformConfig.oracle is ${onChainOracle} (record_performance will be Unauthorized)`;
      fail = true;
    }
  }
  if (sol <= 0.01) fail = true;
  console.log(`${name}: ${pub}${oracleNote}`);
  console.log(`  SOL: ${sol}${sol <= 0.01 ? " — ❌ FUND THIS KEY (gas + ATA rent sponsor)" : " ✅"}`);
}
console.log(
  `PlatformConfig PDA ${cfgPda.toBase58()} on this cluster: ${cfgInfo ? "(exists ✅)" : "(NOT initialized ❌)"}`,
);
if (!cfgInfo) fail = true;
process.exit(fail ? 1 : 0);
