import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
export function dbcTreasury() {
  const raw = process.env.SOLCAMEO_DBC_TREASURY_SECRET;
  if (!raw)
    throw new Error(
      "Configure SOLCAMEO_DBC_TREASURY_SECRET for fee collection and content funding.",
    );
  const bytes = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw))
    : bs58.decode(raw);
  return Keypair.fromSecretKey(bytes);
}
