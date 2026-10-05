// TEMP — list all agents (name -> mint) from prod Convex so we can map delete targets. Read-only.
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
const all = await convex.query("influencers:listAll", {});
console.log("TOTAL AGENTS: " + all.length + "\n");
for (const a of all) {
  console.log(`${(a.name || "(no name)").padEnd(24)} | ${a.agentType || "?"} | mint=${a.mintAddress}`);
}
