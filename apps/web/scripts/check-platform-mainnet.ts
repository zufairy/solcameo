/** Read-only platform launch preflight. Never signs or broadcasts a transaction. */
import dotenv from "dotenv";
import { Connection, PublicKey } from "@solana/web3.js";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PLATFORM_DBC } from "../lib/meteora/options";
import { buildDbcCurve } from "../lib/meteora/curve";
import { LAUNCH_MIN_LAMPORTS, PLATFORM_RECOMMENDED_LAMPORTS } from "../lib/meteora/launchCost";
import { getHeliusRpcUrl } from "../lib/solana/network";
import { assertSolanaChain } from "../lib/server/solanaChainGuard";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
async function main() {
  const rpc = getHeliusRpcUrl("mainnet-beta");
  if (!rpc) throw new Error("Configure Helius before the mainnet preflight.");
  const raw = process.env.SOLCAMEO_PLATFORM_LAUNCH_WALLET;
  if (!raw) throw new Error("Configure the platform launch wallet.");
  const wallet = new PublicKey(raw);
  const c = new Connection(rpc, "confirmed");
  await assertSolanaChain(c, "mainnet");
  const [program, balance, slot] = await Promise.all([
    c.getAccountInfo(DYNAMIC_BONDING_CURVE_PROGRAM_ID), c.getBalance(wallet), c.getSlot(),
  ]);
  if (!program?.executable) throw new Error("Meteora DBC program is unavailable.");
  const curve = buildDbcCurve(PLATFORM_DBC, "platform");
  console.log(JSON.stringify({
    network: "mainnet", provider: "Helius", slot,
    dbcProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(), executable: true,
    wallet: wallet.toBase58(), balanceSol: balance / 1e9,
    minimumLaunchSol: LAUNCH_MIN_LAMPORTS.total / 1e9,
    recommendedSol: PLATFORM_RECOMMENDED_LAMPORTS / 1e9,
    funded: balance >= LAUNCH_MIN_LAMPORTS.total,
    settings: PLATFORM_DBC,
    netGraduationReserveSol: Number(curve.migrationQuoteThreshold.toString()) / 1e9,
    graduatedBaseFeeBps: curve.migratedPoolFee?.poolFeeBps,
    permanentlyLockedLiquidityPct: curve.creatorPermanentLockedLiquidityPercentage,
    customProgramDeploymentRequired: false,
    transactionSent: false,
  }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Mainnet preflight failed."); process.exitCode = 1; });
