import { PublicKey } from "@solana/web3.js";
import { api } from "@/convex/_generated/api";
import { convexClient } from "./solstarRoute";
import { dbcTreasury } from "./dbcTreasury";
/** Only this wallet can create or resume the official platform token. */
export async function platformLaunchOwner(): Promise<string | null> {
  let owner = process.env.SOLCAMEO_PLATFORM_LAUNCH_WALLET?.trim();
  if (!owner) {
    try { owner = await convexClient().query(api.platformLaunch.owner, { authSecret: process.env.INTERNAL_CRON_SECRET ?? "" }) ?? undefined; } catch { /* Environment fallback for older backends. */ }
  }
  owner ||= process.env.SOLCAMEO_PLATFORM_WALLET?.trim();
  if (owner) { try { return new PublicKey(owner).toBase58(); } catch { return null; } }
  try { return dbcTreasury().publicKey.toBase58(); } catch { return null; }
}
