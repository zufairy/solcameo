// One-shot: initialize OR update the vello-escrow PlatformConfig.
//
//   npx tsx apps/web/scripts/init-platform-config.ts
//
// CLUSTER SELECTION: the connection comes from buildServerEscrowProgram → getRpcUrl()
// → NEXT_PUBLIC_SOLANA_NETWORK (tsx does NOT load .env.local — the var must be in the
// shell env; deploy-escrow.sh exports it). Set EXPECTED_CLUSTER=devnet|mainnet-beta to
// make this script verify the connected cluster's genesis hash BEFORE sending anything
// — this is the guard against initializing the config on the wrong cluster.
//
// The PlatformConfig is a SINGLETON PDA (seed "vello:config"). On devnet it already
// EXISTS (an earlier E2E init'd it: authority = the deployer wallet, fee = 500 bps,
// oracle/treasury = old test keys). So this script UPDATEs it in place via
// `update_platform_config` — you MUST run it as the config.authority (the deployer /
// program upgrade-authority wallet). If the config does not exist yet, it inits instead.
// Either way it sets the reward rake to 10% and points oracle/treasury at your keys.
//
// Requires:
//   - admin keypair = config.authority (deployer) at ~/.config/solana/id.json
//     (override ADMIN_KEYPAIR_PATH). Attacker-front-run of init is moot: the config is
//     already owned by this wallet.
//   - VELLO_ORACLE_SECRET (base64 64-byte / JSON array / path) — the oracle key to set.
//     Your running oracle keeper MUST use this same key, or record_performance is Unauthorized.
//   - NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET — the treasury owner (protocol fees land in its USDC ATA).
//
// PROTOCOL_FEE_BPS = 1000 (10%). Program hard-caps at 2000 (20%); re-settable anytime.
import { readFileSync } from "fs";
import { homedir } from "os";
import { Keypair, PublicKey } from "@solana/web3.js";
import { buildServerEscrowProgram } from "../lib/server/escrowServer";
import { initPlatformConfigTx, updatePlatformConfigTx, getPlatformConfigPda } from "../lib/escrow";

const PROTOCOL_FEE_BPS = 1000; // 10%
// Devnet default: short (8). MAINNET: widen to ~1h (≈9000 slots @ ~400ms) via
// DISPUTE_WINDOW_SLOTS=9000 — the live devnet config sits at 4 slots (~2s), which
// is effectively NO fraud-challenge window. Constraints: dispute < staleness AND
// shorter than the program's 6h refund grace (owed-but-uncranked clippers must
// not be swept back to the creator first). Runbook §A3.
const DISPUTE_WINDOW_SLOTS = Number(process.env.DISPUTE_WINDOW_SLOTS ?? "8");
const MAX_STALENESS_SLOTS = Number(process.env.MAX_STALENESS_SLOTS ?? "200000"); // keep generous so owed clips don't go stale before the keeper cranks

function loadKp(secretOrPath: string): Keypair {
  const s = secretOrPath.trim();
  if (s.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  try {
    const buf = Buffer.from(s, "base64");
    if (buf.length === 64) return Keypair.fromSecretKey(buf);
  } catch {
    /* not base64 — fall through to path */
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(s, "utf8"))));
}

async function main() {
  const admin = loadKp(process.env.ADMIN_KEYPAIR_PATH || `${homedir()}/.config/solana/id.json`);
  const oracleSecret = process.env.VELLO_ORACLE_SECRET;
  if (!oracleSecret) throw new Error("VELLO_ORACLE_SECRET is unset");
  const oracle = loadKp(oracleSecret).publicKey;
  const treasuryEnv = process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET;
  if (!treasuryEnv) throw new Error("NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET is unset");
  const treasury = new PublicKey(treasuryEnv);

  // RPC_URL (optional) pins the exact endpoint — deploy-escrow.sh passes the same
  // one it deploys through. Without it, the cluster comes from NEXT_PUBLIC_SOLANA_NETWORK.
  const program = buildServerEscrowProgram(admin, process.env.RPC_URL?.trim() || undefined);

  // Hard cluster check: a money-config write on the wrong cluster must be impossible.
  // Genesis hashes are permanent cluster identities (mainnet-beta / devnet).
  // EXPECTED_CLUSTER is REQUIRED — the original mainnet-runbook CRITICAL was exactly
  // a hand-run of this script quietly hitting the default cluster.
  const GENESIS_BY_CLUSTER: Record<string, string> = {
    "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  };
  const expectedCluster = process.env.EXPECTED_CLUSTER?.trim();
  if (!expectedCluster)
    throw new Error(
      "EXPECTED_CLUSTER is required (devnet | mainnet-beta) — it is verified against the connected cluster's genesis hash before any write.",
    );
  const want = GENESIS_BY_CLUSTER[expectedCluster];
  if (!want) throw new Error(`EXPECTED_CLUSTER must be devnet or mainnet-beta (got ${expectedCluster})`);
  const genesis = await program.provider.connection.getGenesisHash();
  const connectedCluster =
    Object.entries(GENESIS_BY_CLUSTER).find(([, h]) => h === genesis)?.[0] ?? `unknown(${genesis})`;
  console.log("connected cluster:", connectedCluster);
  if (genesis !== want)
    throw new Error(
      `ABORT: connected to ${connectedCluster} but EXPECTED_CLUSTER=${expectedCluster}. ` +
        `Check NEXT_PUBLIC_SOLANA_NETWORK / RPC_URL in the shell env (tsx does not read .env.local).`,
    );

  const [configPda] = getPlatformConfigPda();
  console.log("admin (must be config.authority):", admin.publicKey.toBase58());
  console.log("config PDA:", configPda.toBase58());
  console.log("setting oracle:", oracle.toBase58(), "treasury:", treasury.toBase58(), "fee:", PROTOCOL_FEE_BPS, "bps");

  let exists = false;
  try {
    // @ts-ignore Program<any>
    await program.account.platformConfig.fetch(configPda);
    exists = true;
  } catch {
    /* not initialized */
  }

  if (exists) {
    console.log(`Config EXISTS → update_platform_config (fee=10%, oracle, treasury, dispute=${DISPUTE_WINDOW_SLOTS}, staleness=${MAX_STALENESS_SLOTS})`);
    const { txSignature } = await updatePlatformConfigTx(program, {
      newOracle: oracle,
      newTreasury: treasury,
      newFeeBps: PROTOCOL_FEE_BPS,
      // Previously omitted → the runbook's "widen the 4-slot dispute window" step
      // silently did nothing. Now settable per-run via DISPUTE_WINDOW_SLOTS.
      newDisputeWindowSlots: DISPUTE_WINDOW_SLOTS,
      newMaxStalenessSlots: MAX_STALENESS_SLOTS,
    });
    console.log("update tx:", txSignature);
  } else {
    console.log("Config NOT found → init_platform_config (fee=10%)");
    const { txSignature, platformConfig } = await initPlatformConfigTx(
      program,
      oracle,
      treasury,
      PROTOCOL_FEE_BPS,
      DISPUTE_WINDOW_SLOTS,
      MAX_STALENESS_SLOTS,
    );
    console.log("init tx:", txSignature, "PDA:", platformConfig);
  }

  // @ts-ignore Program<any>
  const cfg = await program.account.platformConfig.fetch(configPda);
  console.log("verified on-chain:", {
    authority: cfg.authority.toBase58(),
    oracle: cfg.oracle.toBase58(),
    treasury: cfg.treasury.toBase58(),
    protocolFeeBps: Number(cfg.protocolFeeBps),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
