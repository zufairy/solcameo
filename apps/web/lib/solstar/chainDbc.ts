/** The shape the market page's chart and header read: a pool snapshot, here built from the synced Convex tables. */
export interface ChainDbc {
  available: true;
  capSol: number;
  reserveSol: number;
  targetSol: number;
  progress: number;
  migrated: boolean;
  supplyTokens: number;
  points: Array<{ time: number; price: number; volume: number; side: "buy" | "sell" }>;
  appVolume24hLamports?: string;
}

type State = {
  priceSol: number; supplyRaw: string; decimals: number; migrated?: boolean; curveProgress?: number;
  reserveSol?: number; targetSol?: number; volume24hSol?: number;
};

/** Build the pool snapshot from Convex alone: no RPC, so it exists the moment the page's data arrives. */
export function dbcFromChain(state: State | null | undefined, points: ChainDbc["points"] | undefined): ChainDbc | null {
  if (!state) return null;
  const supplyTokens = Number(state.supplyRaw) / 10 ** state.decimals;
  const capSol = state.priceSol * supplyTokens;
  if (!Number.isFinite(capSol)) return null;
  const migrated = !!state.migrated;
  return {
    available: true, capSol, supplyTokens, migrated,
    reserveSol: state.reserveSol ?? 0, targetSol: state.targetSol ?? 0,
    progress: migrated ? 1 : Math.min(1, Math.max(0, state.curveProgress ?? 0)),
    points: points ?? [],
    ...(state.volume24hSol != null ? { appVolume24hLamports: String(Math.round(state.volume24hSol * 1e9)) } : {}),
  };
}

/**
 * Merge a chain read (fresh but sparse) with the Convex snapshot (instant and deep): the chain's figures win where it has
 * them, and the chart keeps every point from both, one per timestamp, oldest first.
 */
export function mergeDbc<T extends { points?: ChainDbc["points"] }>(rpc: T | null, chain: ChainDbc | null): (Omit<ChainDbc, "points"> & T & { points: ChainDbc["points"] }) | T | ChainDbc | null {
  if (!rpc) return chain;
  if (!chain) return rpc;
  const byTime = new Map<number, ChainDbc["points"][number]>();
  for (const p of [...chain.points, ...(rpc.points ?? [])]) byTime.set(p.time, p);
  return { ...chain, ...rpc, points: [...byTime.values()].sort((a, b) => a.time - b.time).slice(-5000) };
}
