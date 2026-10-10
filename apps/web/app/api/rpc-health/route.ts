import { NextResponse } from "next/server";
import { getNetwork, getQuickNodeRpcUrl } from "@/lib/solana/network";
import { getActiveProvider, getSolamiRpcUrl, refreshActiveProvider, type RpcProvider } from "@/lib/solana/rpcProvider";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

type Probe = { provider: RpcProvider; configured: boolean; ok: boolean; latencyMs: number | null; slot: number | null; error?: string };
let cache: { at: number; body: unknown } | null = null;

async function probe(provider: RpcProvider, url: string): Promise<Probe> {
  if (!url) return { provider, configured: false, ok: false, latencyMs: null, slot: null };
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "confirmed" }] }),
    });
    const json = (await res.json()) as { result?: number; error?: { message?: string } };
    const latencyMs = Math.round(performance.now() - started);
    if (!res.ok || typeof json.result !== "number") return { provider, configured: true, ok: false, latencyMs, slot: null, error: json.error?.message ?? `HTTP ${res.status}` };
    return { provider, configured: true, ok: true, latencyMs, slot: json.result };
  } catch (e) {
    return { provider, configured: true, ok: false, latencyMs: null, slot: null, error: e instanceof Error ? e.message : "failed" };
  }
}

/** Live health of both dedicated RPC providers: latency and the slot each one sees. Cached for 5s; carries no secrets. */
export async function GET() {
  if (cache && Date.now() - cache.at < 5000) return NextResponse.json(cache.body, { headers: { "Cache-Control": "no-store" } });
  await refreshActiveProvider(true);
  const network = getNetwork();
  const [quicknode, solami] = await Promise.all([probe("quicknode", getQuickNodeRpcUrl(network)), probe("solami", getSolamiRpcUrl(network))]);
  const body = { network, active: getActiveProvider(), providers: [solami, quicknode], checkedAt: Date.now() };
  cache = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
