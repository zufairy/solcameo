/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side Anchor provider for the vello-escrow program (Node runtime only).
//
// The browser `buildEscrowProgram` in lib/escrow.ts signs with a wallet adapter
// (WalletContextState). The oracle / claim keepers run in a Next route and sign
// with a raw Keypair loaded from a base64 secret env var (VELLO_ORACLE_SECRET /
// VELLO_CRANK_SECRET). This module is that server analogue: a Keypair-backed
// AnchorProvider so the existing recordPerformanceTx / claimPayoutTx / etc.
// wrappers in escrow.ts can be driven from the server unchanged.
//
// Program<any> mirrors escrow.ts — the concrete IDL type only exists after the
// user runs `anchor build`. The PDA derivation works now; the typed `.methods`
// and `.account` calls are runtime-dead until the IDL JSON is regenerated.
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getRpcUrl } from "@/lib/solana/network";
import IDL from "@/lib/vello-escrow-idl.json";

// Re-export the canonical loader so callers don't reach into the trader module.
// loadKeypair: base64-encoded 64-byte secret key → Keypair.
export { loadKeypair } from "@/lib/trader/usdcTransfer";

function getProgramId(): string {
  const id = process.env.NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID;
  if (!id) throw new Error("NEXT_PUBLIC_VELLO_ESCROW_PROGRAM_ID not set");
  return id;
}

/**
 * Build a server-side Anchor `Program` signed by `signer`.
 *
 * The signer is the tx fee payer + on-chain authority (the oracle key for
 * record_performance / reject_clip, the crank key for claim_payout). It must
 * hold SOL for gas + the rent it sponsors (ClaimRecord PDA / beneficiary ATA).
 *
 * Mirrors escrow.ts `buildEscrowProgram` but uses anchor's NodeWallet (`Wallet`)
 * around a Keypair instead of a browser WalletContextState.
 *
 * `rpcUrl` overrides the network-derived endpoint (deploy tooling passes the same
 * RPC_URL it deploys through, so config writes ride the same connection).
 */
/**
 * Minimal Anchor-compatible wallet around a raw Keypair.
 *
 * We deliberately do NOT use anchor's `Wallet`/`NodeWallet`: in the bundled Next
 * server build (Railway) that export is not a constructor at runtime — the crash
 * surfaced as `[oracle.run] … d.Wallet is not a constructor`, silently breaking
 * every on-chain oracle attest + crank payout. This shim only needs `publicKey`
 * + version-aware signing, which is exactly what `AnchorProvider` calls.
 */
function keypairWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    payer: kp,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else tx.partialSign(kp);
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      for (const tx of txs) {
        if (tx instanceof VersionedTransaction) tx.sign([kp]);
        else tx.partialSign(kp);
      }
      return txs;
    },
  };
}

export function buildServerEscrowProgram(signer: Keypair, rpcUrl?: string): Program<any> {
  const connection = new Connection(rpcUrl ?? getRpcUrl(), "confirmed");
  const provider = new AnchorProvider(connection, keypairWallet(signer) as any, {
    commitment: "confirmed",
  });
  const idlWithAddress = { ...(IDL as any), address: getProgramId() };
  return new Program(idlWithAddress, provider);
}
