import type { Connection } from "@solana/web3.js";
/** Verify the RPC's actual chain before preparing or sending test-wallet transactions. */
export async function assertDevnet(connection: Connection) {
  if (await connection.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Configured RPC is not Solana devnet. No transaction was sent.");
}
