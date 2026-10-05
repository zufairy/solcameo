import type { Pool } from "./economics";

/** 6-decimal token: 1 whole token = 1_000_000 units. */
export const TOKEN_UNIT = 1_000_000n;

/** Lamports per whole token. */
export function priceLamportsPerToken(pool: Pool): bigint {
  if (pool.tokenReserve <= 0n) throw new Error("token reserve must be positive");
  return (pool.solReserve * TOKEN_UNIT) / pool.tokenReserve;
}

export function marketCapLamports(pool: Pool, supplyUnits: bigint): bigint {
  return (priceLamportsPerToken(pool) * supplyUnits) / TOKEN_UNIT;
}

/** Signed basis points change of price versus launch price. */
export function changeSinceLaunchBps(launchPrice: bigint, price: bigint): bigint {
  if (launchPrice <= 0n) throw new Error("launch price must be positive");
  return ((price - launchPrice) * 10_000n) / launchPrice;
}
