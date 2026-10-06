import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { tierFor } from "@/lib/tokenomics/platformToken";
import { platformTokenMint, tokenBalanceOf } from "./platformTokenChain";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; pct: number }>();

/**
 * Generation discount for an agent, from the SOLCAMEO its owner holds right now (read from chain, cached a minute).
 * Never blocks or raises a price: no token launched, no owner wallet, or any RPC problem means a 0% discount.
 */
export async function holderDiscountForMint(mintAddress: string): Promise<number> {
  const mint = platformTokenMint();
  if (!mint) return 0;
  const hit = cache.get(mintAddress);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.pct;
  let pct = 0;
  try {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (url) {
      const agent = await new ConvexHttpClient(url).query(api.influencers.getByMintServer, { mintAddress, authSecret: process.env.INTERNAL_CRON_SECRET ?? "" });
      const owner = (agent as { creatorWallet?: string } | null)?.creatorWallet;
      if (owner) {
        const balance = await tokenBalanceOf(owner, mint);
        if (balance !== null) pct = tierFor(balance).discountPct;
      }
    }
  } catch { pct = 0; }
  cache.set(mintAddress, { at: Date.now(), pct });
  return pct;
}
