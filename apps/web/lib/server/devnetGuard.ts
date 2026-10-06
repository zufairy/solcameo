import type { Connection } from "@solana/web3.js";
/** Verify the RPC's actual chain before preparing or sending test-wallet transactions. */
export async function assertDevnet(connection: Connection) {
  if (await connection.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("Configured RPC is not Solana devnet. No transaction was sent.");
}

/** Both clusters: refuse to prepare or send anything when the RPC is not the cluster the app is configured for. */
export async function assertConfiguredChain(connection: Connection, network: "devnet" | "mainnet") {
  const { assertSolanaChain } = await import("./solanaChainGuard");
  await assertSolanaChain(connection, network);
}
