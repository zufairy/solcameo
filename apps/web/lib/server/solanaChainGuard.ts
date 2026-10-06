import type { Connection } from "@solana/web3.js";

const GENESIS = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} as const;

/** Verify the RPC's actual chain rather than trusting its URL or environment label. */
export async function assertSolanaChain(connection: Connection, network: keyof typeof GENESIS) {
  if (await connection.getGenesisHash() !== GENESIS[network]) throw new Error("RPC network mismatch");
}
