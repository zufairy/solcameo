import { Keypair } from "@solana/web3.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { encryptWalletSecret } from "./walletCrypto";
import { after } from "next/server";
import { getUsdcBalanceStrict } from "@/lib/trader/usdcTransfer";
import { settleAgentEconomics } from "@/lib/economy/settleAgent";

const client = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const secret = () => process.env.INTERNAL_CRON_SECRET ?? "";

/** The mutation chooses the existing wallet atomically if two requests race. */
export async function ensureInfluencerWallet(mintAddress: string) {
  const wallet = Keypair.generate();
  return client().mutation(api.influencers.setAgentWallet, {
    mintAddress, agentWallet: wallet.publicKey.toBase58(),
    agentWalletSecret: encryptWalletSecret(Buffer.from(wallet.secretKey).toString("base64")),
    authSecret: secret(),
  });
}

/** Read chain truth before reserving paid work. RPC failure never means zero. */
export async function refreshAgentFunds(mintAddress: string) {
  const { agentWallet } = await ensureInfluencerWallet(mintAddress);
  const balance = await getUsdcBalanceStrict(agentWallet);
  if (balance === null) throw new Error("Agent balance is temporarily unavailable. Please retry.");
  await client().mutation(api.agentAccount.reconcileEscrowToOnchainServer, {
    mintAddress, onchainUsdc: balance, authSecret: secret(),
  });
  return agentWallet;
}

/**
 * Move what the agent just spent from its wallet to the Solcameo treasury, right after the response is sent, so the
 * USDC lands with us seconds after a generation instead of waiting for the hourly keeper. Best-effort and never
 * throws: a deferred sweep is picked up by the keeper, and a render that failed (refunded first) leaves nothing to sweep.
 */
export function settleSoon(mintAddress: string) {
  const run = () => void settleAgentEconomics(mintAddress).catch(() => undefined);
  try { after(run); } catch { run(); }
}
