import { PublicKey, SystemProgram, Transaction, type VersionedTransaction } from "@solana/web3.js";
import { rpcCandidates, rpcTry } from "@/lib/solana/rpc";
import { splitFundingAmount } from "@/lib/solana/fundingFee";

/**
 * One signed transaction, two transfers: 97% to the agent treasury and 3% to the platform wallet. They land together
 * or not at all, so the fee is on chain for every top-up. Returns the signature once it is broadcast.
 */
export async function sendSolTopUp(o: {
  payer: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  treasury: string;
  feeWallet: string;
  sol: number;
  network: "devnet" | "mainnet";
}): Promise<{ signature: string; netLamports: bigint; feeLamports: bigint }> {
  const total = BigInt(Math.floor(o.sol * 1e9));
  const { fee, net } = splitFundingAmount(total);
  const urls = rpcCandidates(o.network === "mainnet" ? "mainnet-beta" : "devnet");
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: o.payer, toPubkey: new PublicKey(o.treasury), lamports: net }),
    SystemProgram.transfer({ fromPubkey: o.payer, toPubkey: new PublicKey(o.feeWallet), lamports: fee }),
  );
  tx.feePayer = o.payer;
  tx.recentBlockhash = (await rpcTry(urls, (c) => c.getLatestBlockhash("confirmed"))).blockhash;
  const signed = await o.signTransaction(tx);
  const signature = await rpcTry(urls, (c) => c.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed", maxRetries: 5 }));
  return { signature, netLamports: net, feeLamports: fee };
}
