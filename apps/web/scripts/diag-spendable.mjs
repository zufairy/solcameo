import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const APP = "https://velloagents.com";
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
const all = await convex.query(api.influencers.listAll, {});
const clippers = all.filter((a) => a.agentType === "clipping" && a.agentWallet);
console.log("agent              | on-chain | escrowMirror | tab | spendable | creatorWallet");
for (const a of clippers) {
  let onchain = "?";
  try { const b = await (await fetch(`${APP}/api/agent-wallet-balance?wallet=${a.agentWallet}`)).json(); onchain = b.ok ? "$" + Number(b.usdc).toFixed(2) : "err:" + b.error; } catch { onchain = "fetch-err"; }
  let acct = null; try { acct = await convex.query(api.agentAccount.getWithNav, { mintAddress: a.mintAddress }); } catch {}
  const esc = acct?.escrowUsdc, tab = acct?.unsettledTabUsdc;
  const spend = (typeof esc === "number" && typeof tab === "number") ? "$" + Math.max(0, esc - tab).toFixed(2) : (acct ? "?" : "NO-ACCT");
  console.log(`${(a.name || "?").padEnd(18)} | ${String(onchain).padEnd(8)} | ${("$" + (esc ?? "?")).padEnd(12)} | ${String(tab ?? "?").padEnd(3)} | ${spend.padEnd(9)} | ${(a.creatorWallet || "(none)").slice(0, 10)}`);
}
