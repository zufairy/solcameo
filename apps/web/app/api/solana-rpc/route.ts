import { NextRequest, NextResponse } from "next/server";
import { getNetwork, getRpcCandidates } from "@/lib/solana/network";
import { failoverFetch } from "@/lib/solana/failoverConnection";

export const maxDuration = 15;
const METHODS = new Set(["getBalance", "getAccountInfo", "getMultipleAccounts", "getTokenAccountBalance", "getTokenAccountsByOwner", "getLatestBlockhash", "getBlockHeight", "getSignatureStatuses", "getTransaction", "getSignaturesForAddress", "getRecentPrioritizationFees", "getMinimumBalanceForRentExemption", "getFeeForMessage", "getGenesisHash", "sendTransaction", "simulateTransaction"]);
const hits = new Map<string, { count: number; at: number }>();

/** A bounded Solana RPC relay: the server's private QuickNode endpoint stays private. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const hit = hits.get(ip);
  const current = hit && now - hit.at < 60_000 ? hit : { count: 0, at: now };
  hits.set(ip, current);
  if (++current.count > 600) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const body = await req.text();
  if (body.length > 32_768) return NextResponse.json({ error: "request_too_large" }, { status: 413 });
  try {
    const parsed = JSON.parse(body);
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    if (!calls.length || calls.length > 10 || calls.some(c => !c || c.jsonrpc !== "2.0" || !METHODS.has(c.method) || !Array.isArray(c.params ?? []))) {
      return NextResponse.json({ error: "unsupported_rpc_request" }, { status: 400 });
    }
  } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const requested = req.nextUrl.searchParams.get("network") ?? getNetwork();
  if (!["mainnet-beta", "devnet", "testnet"].includes(requested)) return NextResponse.json({ error: "invalid_network" }, { status: 400 });
  try {
    const response = await failoverFetch(getRpcCandidates(requested as ReturnType<typeof getNetwork>), 3000)("", {
      method: "POST", headers: { "Content-Type": "application/json" }, body, cache: "no-store",
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "rpc_unavailable" }, { status: 503 }); }
}
