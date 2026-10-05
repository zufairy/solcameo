import { createHmac, timingSafeEqual } from "node:crypto";
export type DbcOperation = {
  wallet: string;
  characterId: string;
  kind: "claim" | "graduate";
  hash: string;
  expires: number;
  network: string;
  dammPool?: string;
};
function key() {
  const s = process.env.INTERNAL_CRON_SECRET;
  if (!s) throw new Error("Missing receipt secret");
  return s;
}
export function signOperation(r: DbcOperation) {
  const p = Buffer.from(JSON.stringify(r)).toString("base64url");
  return `${p}.${createHmac("sha256", key()).update(`dbc-operation:${p}`).digest("base64url")}`;
}
export function readOperation(
  s: string,
  wallet: string,
  network: string,
  confirm = false,
) {
  const [p, m, extra] = s.split(".");
  const a = Buffer.from(m ?? "", "base64url"),
    b = createHmac("sha256", key()).update(`dbc-operation:${p}`).digest();
  if (extra || a.length !== b.length || !timingSafeEqual(a, b))
    throw new Error("Invalid operation receipt");
  const r: DbcOperation = JSON.parse(Buffer.from(p, "base64url").toString());
  if (
    r.wallet !== wallet ||
    r.network !== network ||
    r.expires + (confirm ? 86400000 : 0) < Date.now()
  )
    throw new Error("Operation expired or wallet/network changed");
  return r;
}
