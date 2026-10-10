import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

/**
 * Which dedicated RPC provider leads the candidate list. Chosen by an admin (Convex `rpcSettings`) and cached in-process on
 * the server for a few seconds, so flipping the switch moves the whole app within seconds and never needs a redeploy.
 * Order matters: the chosen provider is tried first, the other one is its failover.
 */
export type RpcProvider = "quicknode" | "solami";
export const RPC_PROVIDERS: readonly RpcProvider[] = ["quicknode", "solami"];

const TTL_MS = 10_000;
let active: RpcProvider | null = null;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;

export const isRpcProvider = (v: unknown): v is RpcProvider => v === "quicknode" || v === "solami";

/**
 * Solami RPC for mainnet. The server uses its private SOLAMI_API_KEY. The browser can only see NEXT_PUBLIC_SOLAMI_RPC_KEY, which
 * must be an RPC key created as "Frontend" and locked to your own domains in the Solami dashboard, so it is safe to ship.
 */
export function getSolamiRpcUrl(network: string): string {
  const key = (process.env.SOLAMI_API_KEY || process.env.NEXT_PUBLIC_SOLAMI_RPC_KEY)?.trim();
  if (!key || network !== "mainnet-beta") return "";
  // Optional region pin (nyc, fra, ams) to sit next to your server. Unset = Solami's global routing to the nearest point of presence.
  const region = process.env.SOLAMI_RPC_REGION?.trim().toLowerCase();
  const host = region && /^(nyc|fra|ams)$/.test(region) ? `${region}.rpc.solami.dev` : "rpc.solami.dev";
  return `https://${host}/sol?api_key=${encodeURIComponent(key)}`;
}

export const hasSolamiKey = () => !!(process.env.SOLAMI_API_KEY || process.env.NEXT_PUBLIC_SOLAMI_RPC_KEY)?.trim();

/** Env default until an admin chooses: the SOLANA_RPC_PROVIDER variable, else Solami when a key exists, else QuickNode. */
function envDefault(): RpcProvider {
  const fromEnv = process.env.SOLANA_RPC_PROVIDER?.trim().toLowerCase();
  if (isRpcProvider(fromEnv)) return fromEnv;
  return hasSolamiKey() ? "solami" : "quicknode";
}

export function getActiveProvider(): RpcProvider {
  // Fire-and-forget refresh; callers stay synchronous and never wait on Convex.
  void refreshActiveProvider();
  return active ?? envDefault();
}

export function setActiveProvider(p: RpcProvider | null) { active = p; fetchedAt = p ? Date.now() : 0; }

export function refreshActiveProvider(force = false): Promise<void> {
  if (!force && Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!url) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const row = await new ConvexHttpClient(url).query(api.rpcSettings.getProvider, {});
      active = isRpcProvider(row.provider) ? row.provider : null;
    } catch {
      /* keep the last known choice: an unreachable settings store must never break RPC */
    } finally {
      fetchedAt = Date.now();
      inflight = null;
    }
  })();
  return inflight;
}
