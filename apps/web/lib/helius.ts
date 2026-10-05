import type { AIInfluencer, Niche, Language } from "@/lib/types";
import { getNetwork } from "@/lib/solana/network";

const HELIUS_API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY ?? "";

/** Helius DAS RPC host for the active network. Computed per-call (not a
 *  module-level const) so a mainnet flip doesn't leave this silently
 *  querying devnet — see lib/solana/network.ts's getNetwork(), the same
 *  network read the rest of the app uses. */
function getHeliusRpcUrl(): string {
  const host = getNetwork() === "mainnet-beta" ? "mainnet" : "devnet";
  return `https://${host}.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
}

interface HeliusAttribute {
  trait_type: string;
  value: string;
}

interface HeliusAsset {
  id: string;
  content: {
    metadata: {
      name: string;
      description?: string;
      attributes?: HeliusAttribute[];
    };
    links?: {
      image?: string;
    };
    json_uri?: string;
  };
  authorities: { address: string; scopes: string[] }[];
  creators: { address: string; verified: boolean; share: number }[];
}

interface HeliusDasResponse {
  result: {
    items: HeliusAsset[];
    total: number;
  };
}

interface HeliusSingleAssetResponse {
  result: HeliusAsset;
}

async function dasRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(getHeliusRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vello",
      method,
      params,
    }),
  });
  if (!res.ok) throw new Error(`Helius DAS error: ${res.status}`);
  return res.json() as Promise<T>;
}

function getAttribute(attrs: HeliusAttribute[] | undefined, key: string): string {
  return attrs?.find((a) => a.trait_type === key)?.value ?? "";
}

export function parseAssetToInfluencer(asset: HeliusAsset): AIInfluencer {
  const attrs = asset.content.metadata.attributes;
  const name = asset.content.metadata.name || "Unknown";
  const handle = getAttribute(attrs, "handle") || `@${name.toLowerCase().replace(/\s/g, ".")}`;

  const niche = (getAttribute(attrs, "niche") || "lifestyle") as Niche;
  const language = (getAttribute(attrs, "language") || "en") as Language;

  return {
    id: asset.id,
    name,
    handle,
    avatarUrl:
      asset.content.links?.image ||
      `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(name)}`,
    niche,
    language,
    tvl: 0,
    monthlyEarnings: 0,
    sharePrice: 10,
    totalShares: 1000,
    availableShares: 1000,
    description: asset.content.metadata.description || "",
    personality: {
      warmth: Number(getAttribute(attrs, "warmth")) || 50,
      humor: Number(getAttribute(attrs, "humor")) || 50,
      authority: Number(getAttribute(attrs, "authority")) || 50,
      boldness: Number(getAttribute(attrs, "boldness")) || 50,
    },
    contentHistory: [],
    earningsHistory: [],
    shareholders: [],
    createdAt: new Date().toISOString(),
  };
}

export async function fetchAsset(mintAddress: string): Promise<AIInfluencer | null> {
  try {
    const data = await dasRequest<HeliusSingleAssetResponse>("getAsset", {
      id: mintAddress,
    });
    return parseAssetToInfluencer(data.result);
  } catch {
    return null;
  }
}

export async function fetchAssetsByCreator(
  creatorAddress: string
): Promise<AIInfluencer[]> {
  try {
    const data = await dasRequest<HeliusDasResponse>("getAssetsByCreator", {
      creatorAddress,
      onlyVerified: false,
      page: 1,
      limit: 100,
    });
    return data.result.items
      .filter(
        (a) =>
          a.content.metadata.attributes?.some(
            (attr) => attr.trait_type === "niche"
          ) ?? false
      )
      .map(parseAssetToInfluencer);
  } catch {
    return [];
  }
}
