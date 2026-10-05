import { NextResponse } from "next/server";
export async function GET() {
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/SOL-USD/spot", { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
    const body = await res.json();
    const rate = Number(body.data?.amount);
    if (!res.ok || body.data?.currency !== "USD" || !Number.isFinite(rate) || rate <= 0) throw new Error("Invalid quote");
    return NextResponse.json({ rate, source: "Coinbase", quoteCurrency: "USD" }, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch { return NextResponse.json({ error: "USD conversion quote unavailable" }, { status: 503 }); }
}
