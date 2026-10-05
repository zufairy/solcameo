import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const cvx = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
for (const [name, q, args] of [["campaigns:list", "campaigns:list", {}], ["clipJobs:listJobsByMint", "clipJobs:listJobsByMint", { mintAddress: "HLEmBir8PoTmsmFhc7NbEUypjRrKdxx2fZxvpZkwDUd9" }]]) {
  try { const r = await cvx.query(q, args); console.log(`${name}: OK (${Array.isArray(r)?r.length+" rows":typeof r})`); if(name==="campaigns:list"&&Array.isArray(r)) console.log("  titles:", JSON.stringify(r.map(c=>({t:c.title,id:c._id,rw:c.contentRewardId})).slice(0,15))); }
  catch(e){ console.log(`${name}: ERR ${String(e.message).slice(0,120)}`); }
}
