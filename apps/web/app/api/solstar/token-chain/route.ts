import { marketRpcFetch } from "@/lib/server/marketRpcFetch";
import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { convexClient, isConvexIdString } from "@/lib/server/solstarRoute";
import { getRpcCandidates } from "@/lib/solana/network";
const transactionCache = new Map<string, { expires: number; result: unknown }>();
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("characterId");
  if (!isConvexIdString(id))
    return NextResponse.json({ error: "Invalid character" }, { status: 400 });
  try {
    const data = await convexClient().query(api.solstarMarket.terminal, {
      characterId: id as Id<"ssCharacters">,
    });
    if (!data)
      return NextResponse.json(
        { error: "Character not found" },
        { status: 404 },
      );
    const { token } = data;
    if (token.network === "paper" || !token.mint)
      return NextResponse.json({
        available: false,
        reason: "This market has no on-chain SPL mint.",
      });
    const mint = new PublicKey(token.mint).toBase58();
    for (const endpoint of getRpcCandidates(
      token.network === "mainnet" ? "mainnet-beta" : "devnet",
    )) {
      try {
        const res = await marketRpcFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([
            {
              jsonrpc: "2.0",
              id: 1,
              method: "getTokenSupply",
              params: [mint, { commitment: "confirmed" }],
            },
            {
              jsonrpc: "2.0",
              id: 2,
              method: "getTokenLargestAccounts",
              params: [mint, { commitment: "confirmed" }],
            },
          ]),
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        });
        if (!res.ok) continue;
        const results = await res.json();
        const supply = results.find((r: { id: number }) => r.id === 1)?.result;
        const largest = results.find((r: { id: number }) => r.id === 2)?.result;
        if (!supply?.value || !largest?.value) continue;
        const rpc = async (method: string, params: unknown[]) => {
          const cacheKey = `${token.network}:${String(params[0])}`;
          if (method === "getTransaction") {
            const saved = transactionCache.get(cacheKey);
            if (saved && saved.expires > Date.now()) return saved.result;
          }
          const response = await marketRpcFetch(endpoint, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({jsonrpc:"2.0",id:3,method,params}), cache:"no-store", signal:AbortSignal.timeout(8000) });
          const payload = await response.json();
          if (payload.error) throw new Error(payload.error.message);
          if (method === "getTransaction" && payload.result) {
            if (transactionCache.size >= 500) transactionCache.delete(transactionCache.keys().next().value!);
            transactionCache.set(cacheKey, { expires: Date.now() + 300000, result: payload.result });
          }
          return payload.result;
        };
        const accounts = largest.value as Array<{address:string;amount:string;uiAmountString:string}>;
        let holders: Array<{wallet:string;units:string;supplyPct:number}> = [];
        let trades: Array<{signature:string;wallet:string;side:string;units:string;lamports:string;createdAt:number}> = [];
        let historyError = "";
        try {
          const parsed = await rpc("getMultipleAccounts", [accounts.map(a=>a.address), {encoding:"jsonParsed",commitment:"confirmed"}]);
          const grouped = new Map<string,bigint>();
          accounts.forEach((a,i) => { const owner = parsed.value[i]?.data?.parsed?.info?.owner; if (owner) grouped.set(owner,(grouped.get(owner)??0n)+BigInt(a.amount)); });
          holders = [...grouped].filter(([,units])=>units>0n).map(([wallet,units])=>({wallet,units:units.toString(),supplyPct:Number(units)/Number(supply.value.amount)*100}));
          if (token.dbcPool) {
            const signatures = await rpc("getSignaturesForAddress", [token.dbcPool,{limit:12,commitment:"confirmed"}]);
            const transactions = await Promise.all(signatures.filter((s: {err:unknown})=>!s.err).map(async (s: {signature:string;blockTime:number}) => {
              const tx = await rpc("getTransaction", [s.signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:0}]);
              if (!tx?.meta || tx.meta.err) return null;
              const keys = tx.transaction.message.accountKeys as Array<{pubkey:string;signer:boolean}>;
              const owners = [...new Set<string>([...(tx.meta.preTokenBalances??[]),...(tx.meta.postTokenBalances??[])].filter((b:{mint:string})=>b.mint===mint).map((b:{owner:string})=>b.owner))];
              const wallet = owners.find(owner=>keys.some(k=>k.pubkey===owner&&k.signer)) ?? keys[0].pubkey;
              const walletIndex = keys.findIndex(k=>k.pubkey===wallet);
              const balance = (list: Array<{mint:string;owner:string;uiTokenAmount:{amount:string}}>) => list.filter(b=>b.mint===mint&&b.owner===wallet).reduce((sum,b)=>sum+BigInt(b.uiTokenAmount.amount),0n);
              const delta = balance(tx.meta.postTokenBalances??[])-balance(tx.meta.preTokenBalances??[]);
              if (delta===0n) return null;
              const solDelta = BigInt(tx.meta.postBalances[walletIndex])-BigInt(tx.meta.preBalances[walletIndex])+(walletIndex===0?BigInt(tx.meta.fee):0n);
              return {signature:s.signature,wallet,side:delta>0n?"buy":"sell",units:(delta<0n?-delta:delta).toString(),lamports:(solDelta<0n?-solDelta:solDelta).toString(),createdAt:(tx.blockTime??s.blockTime)*1000};
            }));
            trades = transactions.filter(t=>t!==null);
          }
        } catch { historyError = "RPC holder or transaction details temporarily unavailable"; }
        return NextResponse.json(
          {
            available: true,
            mint,
            network: token.network,
            supply: supply.value,
            accounts: largest.value,
            holders, trades, historyError,
            holdersScope: "Owners of the largest 20 token accounts; includes pool vaults",
            slot: Math.min(supply.context.slot, largest.context.slot),
            checkedAt: Date.now(),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch {
        /* try the next endpoint on the same cluster */
      }
    }
    return NextResponse.json(
      { error: "Solana RPC temporarily unavailable" },
      { status: 502 },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to read token data" },
      { status: 502 },
    );
  }
}
