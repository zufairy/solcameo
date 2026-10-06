import { Connection, PublicKey } from "@solana/web3.js";
import { getNetwork } from "@/lib/solana/network";
import { rpcCandidates, rpcTry } from "@/lib/solana/rpc";
import { TOTAL_SUPPLY } from "@/lib/tokenomics/platformToken";

/** The SOLCAMEO mint, once launched. Unset means the token is not live yet and every holder feature stays inert. */
export function platformTokenMint(): PublicKey | null {
  const raw = process.env.SOLCAMEO_TOKEN_MINT?.trim();
  if (!raw) return null;
  try { return new PublicKey(raw); } catch { return null; }
}

export const platformWallets = () => ({
  team: process.env.SOLCAMEO_TEAM_WALLET?.trim() || null,
  treasury: process.env.SOLCAMEO_TREASURY_WALLET?.trim() || null,
  rewards: process.env.SOLCAMEO_REWARDS_WALLET?.trim() || null,
  revenue: (process.env.NEXT_PUBLIC_JOBTEPI_TREASURY_WALLET ?? "").trim() || null,
});

const run = <T,>(fn: (c: Connection) => Promise<T>) => rpcTry(rpcCandidates(getNetwork()), fn);

/** Whole-token balance of `owner` for `mint` (all of its token accounts), or null when it could not be read. */
export async function tokenBalanceOf(owner: string, mint: PublicKey): Promise<number | null> {
  try {
    const res = await run((c) => c.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint }, "confirmed"));
    return res.value.reduce((s, a) => s + Number(a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
  } catch { return null; }
}

export async function mintSupply(mint: PublicKey): Promise<{ supply: number; decimals: number } | null> {
  try {
    const s = (await run((c) => c.getTokenSupply(mint, "confirmed"))).value;
    return { supply: Number(s.amount) / 10 ** s.decimals, decimals: s.decimals };
  } catch { return null; }
}

export interface TopHolder { owner: string; balance: number; pct: number; kind: "wallet" | "program"; label?: string }

/** Largest holders with owners resolved. Owners that are off-curve addresses are pools or programs, not people. */
export async function topHolders(mint: PublicKey, supply: number, limit = 12): Promise<TopHolder[]> {
  const known = platformWallets();
  const labels = new Map<string, string>(Object.entries({ team: known.team, treasury: known.treasury, rewards: known.rewards }).filter(([, v]) => v).map(([k, v]) => [v as string, k === "team" ? "Team (vesting)" : k === "treasury" ? "Treasury" : "Holder rewards"]));
  try {
    const largest = (await run((c) => c.getTokenLargestAccounts(mint, "confirmed"))).value.slice(0, limit);
    const infos = await run((c) => c.getMultipleParsedAccounts(largest.map((l) => l.address), { commitment: "confirmed" }));
    const byOwner = new Map<string, number>();
    largest.forEach((l, i) => {
      const owner = (infos.value[i]?.data as { parsed?: { info?: { owner?: string } } } | undefined)?.parsed?.info?.owner;
      if (owner) byOwner.set(owner, (byOwner.get(owner) ?? 0) + Number(l.uiAmount ?? 0));
    });
    return [...byOwner.entries()].map(([owner, balance]) => ({
      owner, balance, pct: supply > 0 ? (balance / supply) * 100 : 0,
      kind: PublicKey.isOnCurve(new PublicKey(owner).toBytes()) ? "wallet" as const : "program" as const,
      label: labels.get(owner),
    })).sort((a, b) => b.balance - a.balance);
  } catch { return []; }
}

export const initialSupply = () => TOTAL_SUPPLY;
