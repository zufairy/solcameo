import { createHmac, timingSafeEqual } from "node:crypto";
export type TradeReceipt = {
  wallet: string;
  network?: "devnet" | "mainnet";
  characterId: string;
  hash: string;
  fingerprint?: number;
  side: "buy" | "sell";
  amount: string;
  expires: number;
};
function key() {
  const k = process.env.INTERNAL_CRON_SECRET;
  if (!k) throw new Error("Trade signing not configured");
  return k;
}
export function signTradeReceipt(receipt: TradeReceipt) {
  const data = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  return `${data}.${createHmac("sha256", key()).update(data).digest("base64url")}`;
}
export function readTradeReceipt(
  value: string,
  wallet: string,
  allowExpired = false,
  network: "devnet" | "mainnet" = "devnet",
): TradeReceipt {
  const [data, signature, extra] = value.split(".");
  const expected = createHmac("sha256", key())
    .update(data || "")
    .digest();
  const actual = Buffer.from(signature || "", "base64url");
  if (
    extra ||
    actual.length !== expected.length ||
    !timingSafeEqual(expected, actual)
  )
    throw new Error("Invalid trade receipt");
  const r = JSON.parse(
    Buffer.from(data, "base64url").toString(),
  ) as TradeReceipt;
  if (
    r.wallet !== wallet ||
    (r.network ?? "devnet") !== network ||
    (!allowExpired && r.expires < Date.now())
  )
    throw new Error("Trade receipt expired or wallet changed");
  return r;
}
