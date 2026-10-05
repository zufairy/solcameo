import { migratedPool } from "@/lib/server/dammLifecycle";
import { NATIVE_MINT } from "@solana/spl-token";
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexClient, isConvexIdString } from "@/lib/server/solstarRoute";
import { getObjectText, listImageObjects } from "@/lib/server/imageStorage";
import { assertDevnet } from "@/lib/server/devnetGuard";
import { getNetwork, getRpcUrl } from "@/lib/solana/network";
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("characterId");
  if (!isConvexIdString(id))
    return NextResponse.json({ error: "Invalid character" }, { status: 400 });
  try {
    const data = await convexClient().query(api.solstarMarket.terminal, {
      characterId: id as Id<"ssCharacters">,
    });
    if (!data?.token.dbcPool || !data.token.dbcConfig)
      return NextResponse.json({ available: false });
    const network =
      data.token.network === "mainnet" ? "mainnet-beta" : "devnet";
    const rpc =
      network === getNetwork()
        ? process.env.SOLCAMEO_DBC_RPC_URL || getRpcUrl(network)
        : getRpcUrl(network);
    const connection = new Connection(rpc, {
        commitment: "confirmed",
        fetch: (url, init) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(8000) }),
      });
    const client = new DynamicBondingCurveClient(connection, "confirmed");
    if (!data.token.mint) return NextResponse.json({ available: false });
    const [pool, config, supply] = await Promise.all([
      client.state.getPool(new PublicKey(data.token.dbcPool)),
      client.state.getPoolConfig(new PublicKey(data.token.dbcConfig)),
      connection.getTokenSupply(new PublicKey(data.token.mint), "confirmed"),
      network === "devnet" ? assertDevnet(connection) : Promise.resolve(),
    ]);
    if (!pool || !config || !data.token.mint || pool.poolState.baseMint.toBase58() !== data.token.mint) throw new Error("Pool state unavailable");
    const supplyTokens = Number(supply.value.amount) / 10 ** supply.value.decimals;
    const units = 10 ** (supply.value.decimals - 9);
    const start = Number(config.sqrtStartPrice.toString()) / 2 ** 64;
    const launchCapSol = start * start * units * supplyTokens;
    const reserveSol = Number(pool.poolState.quoteReserve.toString()) / 1e9;
    const targetSol = Number(config.migrationQuoteThreshold.toString()) / 1e9;
    const sqrt = Number(pool.poolState.sqrtPrice.toString()) / 2 ** 64;
    let points: { time: number; price: number; volume: number; side?: "buy" | "sell" }[] = [];
    let volume24hLamports = 0n;
    let appTrades24h = 0;
    try {
      const records = (await listImageObjects(`dbc-trades/${id}/`)).slice(0,500);
      const samples = await Promise.all(records.map(async record => JSON.parse(await getObjectText(record.key) ?? "null")));
      points = samples.filter(s => s && Number.isFinite(s.capSol) && Number.isFinite(s.time)).map(s => ({ time: s.observedAt ?? s.time, price: s.capSol, volume: Number(s.volumeLamports)/1e9, side: s.side })).sort((a,b)=>a.time-b.time);
      for (const sample of samples) if (sample && sample.time >= Date.now()-86400000) { volume24hLamports += BigInt(sample.volumeLamports); appTrades24h++; }
    } catch { /* Actual current pool state remains available if the observation store is down. */ }
    let capSol = sqrt * sqrt * units * supplyTokens;
    if(pool.poolState.isMigrated){
      const migrated=await migratedPool(connection,new PublicKey(data.token.dbcPool));
      if(!migrated)throw new Error("Graduated pool unavailable");
      const s=Number(migrated.state.sqrtPrice.toString())/2**64;
      capSol=migrated.state.tokenBMint.equals(NATIVE_MINT)?s*s*units*supplyTokens:1/(s*s*units)*supplyTokens;
    }
    if (capSol != null) points.push({ time: Date.now(), price: capSol, volume: 0 });
    return NextResponse.json(
      {
        available: true,
        points,
        appVolume24hLamports: volume24hLamports.toString(),
        appTrades24h,
        historyScope: "confirmed_app_trades_and_rpc_observations",
        reserveSol,
        targetSol,
        progress: pool.poolState.isMigrated
          ? 1
          : Math.min(1, reserveSol / targetSol),
        migrated: !!pool.poolState.isMigrated,
        capSol,
        supplyTokens,
        changeSinceLaunchPct: capSol != null && launchCapSol > 0 ? (capSol / launchCapSol - 1) * 100 : null,
        checkedAt: Date.now(),
        pool: data.token.dbcPool,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { available: false, error: "Meteora RPC is temporarily unavailable." },
      { status: 503 },
    );
  }
}
