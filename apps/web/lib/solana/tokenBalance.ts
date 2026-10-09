import type { Connection, PublicKey } from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";

/**
 * The raw token amount held in `ata`. A token account that does not exist yet holds nothing, so that is a plain 0 here: it is
 * a real answer from the chain, not a failure. (`getAccount` throws for it, which made RPC fail-over keep trying other
 * endpoints and finish on an unrelated error, so a wallet with no USDC showed "Reading…" forever.)
 */
export async function readTokenAmount(conn: Connection, ata: PublicKey): Promise<bigint> {
  const info = await conn.getAccountInfo(ata, "confirmed");
  if (!info || info.data.length < AccountLayout.span) return 0n;
  return AccountLayout.decode(info.data.subarray(0, AccountLayout.span)).amount;
}

/** Whether the token account exists on chain. */
export async function tokenAccountExists(conn: Connection, ata: PublicKey): Promise<boolean> {
  return (await conn.getAccountInfo(ata, "confirmed")) !== null;
}
