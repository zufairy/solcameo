import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const cvx = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
const probes = [
  ["campaigns:list", {}], ["clipJobs:listJobsByMint", { mintAddress: "x" }],
  ["influencers:getByMint", { mintAddress: "x" }], ["agentSkillFiles:listByMint", { mintAddress: "x" }],
  ["clipGraphs:getByKey", { sessionId: "x" }], ["oracle:dueForVerification", {}],
];
for (const [q, a] of probes) {
  try { const r = await cvx.query(q, a); console.log(`OK   ${q} -> ${Array.isArray(r)?r.length+" rows":JSON.stringify(r)?.slice(0,40)}`); }
  catch(e){ console.log(`ERR  ${q} -> ${String(e.message).replace(/\[Request ID:[^\]]+\]/,'').trim().slice(0,80)}`); }
}
