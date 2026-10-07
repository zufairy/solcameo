import { Connection, PublicKey } from "@solana/web3.js";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { getRpcCandidates } from "@/lib/solana/network";
import { usdcPerSol } from "@/lib/server/solSwap";
import { platformSnapshot } from "@/lib/server/platformSnapshot";
import { MARGIN_SHARE, tierFor, type ReferralTier } from "@/lib/referrals/program";

const secret = () => process.env.INTERNAL_CRON_SECRET ?? "";
const convex = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export type PlatformToken = { mint: string; characterId: string | null; priceUsd: number; supplyTokens: number; capSol: number };

let tokenCache: { at: number; value: PlatformToken | null } | null = null;
/** SOLCAMEO's mint and live USD price, from the same pool snapshot the market page uses. Null when it cannot be read. */
export async function platformToken(): Promise<PlatformToken | null> {
  if (tokenCache && Date.now() - tokenCache.at < 15_000) return tokenCache.value;
  let value: PlatformToken | null = null;
  try {
    const snap = await platformSnapshot();
    const sol = await usdcPerSol();
    if (snap && snap.capSol != null && snap.supplyTokens && sol) {
      value = { mint: snap.mint, characterId: snap.characterId ?? null, capSol: snap.capSol, supplyTokens: snap.supplyTokens, priceUsd: (snap.capSol * sol) / snap.supplyTokens };
    }
  } catch { /* the program page shows "price unavailable" and accruals wait */ }
  tokenCache = { at: Date.now(), value };
  return value;
}

const holdingCache = new Map<string, { at: number; value: Holding }>();
export type Holding = { tokens: number; valueUsd: number; tier: ReferralTier | null; priceKnown: boolean };

/** What a wallet holds of SOLCAMEO right now (read on-chain) and the referral tier that unlocks. Cached for a minute. */
export async function holdingOf(wallet: string): Promise<Holding> {
  const hit = holdingCache.get(wallet);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const token = await platformToken();
  let tokens = 0;
  if (token) {
    try {
      const connection = new Connection(getRpcCandidates("mainnet-beta")[0], "confirmed");
      const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(token.mint) });
      tokens = accounts.value.reduce((n, a) => n + Number(a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
    } catch { /* an unreadable balance counts as none this time; the next read retries */ }
  }
  const valueUsd = token ? tokens * token.priceUsd : 0;
  const value: Holding = { tokens, valueUsd, tier: tierFor(valueUsd), priceKnown: !!token };
  holdingCache.set(wallet, { at: Date.now(), value });
  return value;
}

/**
 * Called when a referred wallet's spend settles on-chain. Finds who referred the agent's owner, reads that referrer's SOLCAMEO
 * holding, and records their share of Solcameo's margin on this payment. Best-effort: it never throws and never delays a payment.
 */
export async function accrueReferralForSettlement(args: { settlementId: string; mintAddress: string; amountUsdc: number }): Promise<void> {
  try {
    if (!(args.amountUsdc > 0)) return;
    const client = convex();
    const agent = await client.query(api.influencers.getByMintServer, { mintAddress: args.mintAddress, authSecret: secret() });
    const referee = (agent as { creatorWallet?: string } | null)?.creatorWallet;
    if (!referee) return;
    const binding = await client.query(api.referrals.bindingFor, { refereeWallet: referee, authSecret: secret() });
    if (!binding) return;
    const holding = await holdingOf(binding.referrerWallet);
    await client.mutation(api.referrals.accrue, {
      settlementId: args.settlementId, referrerWallet: binding.referrerWallet, refereeWallet: referee, mintAddress: args.mintAddress,
      spendUsdc: args.amountUsdc, marginUsdc: +(args.amountUsdc * MARGIN_SHARE).toFixed(6),
      // Below the first tier the share is recorded as missed: shown to the referrer, never paid.
      rate: holding.tier?.rate ?? 0.2, tier: holding.tier?.tier ?? 0, authSecret: secret(),
    });
  } catch (e) {
    console.warn("[referrals] accrual skipped:", e instanceof Error ? e.message : e);
  }
}
