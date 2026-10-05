import { createHmac, timingSafeEqual } from "node:crypto";
import { Connection } from "@solana/web3.js";
import { getNetwork, getRpcUrl } from "@/lib/solana/network";
import type { DbcOptions } from "@/lib/meteora/options";
export function dbcReadiness() {
  const network = getNetwork();
  const ready =
    network !== "testnet" &&
    !!process.env.INTERNAL_CRON_SECRET &&
    (network !== "mainnet-beta" ||
      process.env.SOLCAMEO_DBC_LIVE_ENABLED === "true");
  return {
    ready,
    network: network === "mainnet-beta" ? "mainnet" as const : "devnet" as const,
    reason: ready
      ? `${network === "devnet" ? "Devnet rehearsal" : "Mainnet launch"} · approve configuration and pool creation in your wallet.`
      : "Mainnet Meteora launches need SOLCAMEO_DBC_LIVE_ENABLED=true; receipt signing and a supported network must be configured.",
  };
}
export function dbcConnection() {
  if (!dbcReadiness().ready) throw new Error(dbcReadiness().reason);
  return new Connection(
    process.env.SOLCAMEO_DBC_RPC_URL || getRpcUrl(),
    "confirmed",
  );
}
export type DbcReceipt = {
  protocol: "meteora-dbc";
  wallet: string;
  characterId: string;
  mint: string;
  config: string;
  uri: string;
  options: DbcOptions;
  network: "devnet" | "mainnet";
  stage: "config" | "pool";
  messageHash: string;
  expires: number;
};
function secret() {
  if (!process.env.INTERNAL_CRON_SECRET)
    throw new Error("Receipt signing unavailable.");
  return process.env.INTERNAL_CRON_SECRET;
}
export function signDbcReceipt(receipt: DbcReceipt) {
  const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret()).update(`dbc:${payload}`).digest("base64url")}`;
}
export function readDbcReceipt(token: string, wallet: string): DbcReceipt {
  const [payload, mac, extra] = token.split(".");
  const expected = createHmac("sha256", secret())
      .update(`dbc:${payload}`)
      .digest(),
    actual = Buffer.from(mac ?? "", "base64url");
  if (
    extra ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    throw new Error("Invalid Meteora receipt.");
  const r: DbcReceipt = JSON.parse(
    Buffer.from(payload, "base64url").toString(),
  );
  if (
    r.protocol !== "meteora-dbc" ||
    r.wallet !== wallet ||
    r.expires < Date.now() ||
    r.network !== (getNetwork() === "mainnet-beta" ? "mainnet" : "devnet")
  )
    throw new Error(
      "Launch receipt expired, network changed, or wallet differs.",
    );
  return r;
}
