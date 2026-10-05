import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";


/** Resolve the Solana wallet the authenticated user has LINKED (stored in Convex
 *  users.walletAddress), via the verified Supabase access token. Returns
 *  undefined if no wallet is linked. Use this for ownership checks instead of
 *  Supabase user_metadata (which the app never populates). */
export async function resolveLinkedWallet(accessToken: string): Promise<string | undefined> {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  try {
    const me = await convex.action(api.users.whoami, { accessToken });
    return me?.walletAddress;
  } catch {
    return undefined;
  }
}

/** Resolve ALL wallets the authenticated user has linked. A user may link
 *  multiple wallets (Phantom, Solflare, …); any of them is allowed to transact.
 *  Returns an empty array if none / on error. */
export async function resolveLinkedWallets(accessToken: string): Promise<string[]> {
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  try {
    const me = await convex.action(api.users.whoami, { accessToken });
    return me?.walletAddresses ?? (me?.walletAddress ? [me.walletAddress] : []);
  } catch {
    return [];
  }
}
