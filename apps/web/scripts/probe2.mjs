import { ConvexHttpClient } from "convex/browser";
const cvx = new ConvexHttpClient("https://happy-otter-123.convex.cloud");
const probes = [["campaigns:list", {}], ["clipJobs:listJobsByMint", { mintAddress: "x" }], ["influencers:getByMint", { mintAddress: "x" }], ["clipGraphs:getByKey", { sessionId: "x" }], ["oracle:dueForVerification", {}]];
for (const [q, a] of probes) {
  try { const r = await cvx.query(q, a); console.log(`OK   ${q} -> ${Array.isArray(r)?r.length+" rows":JSON.stringify(r)?.slice(0,40)}`); }
  catch(e){ console.log(`ERR  ${q} -> ${String(e.message).replace(/\[Request ID:[^\]]+\]/,'').trim().slice(0,70)}`); }
}
