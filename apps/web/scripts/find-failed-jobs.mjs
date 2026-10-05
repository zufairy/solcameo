import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const convex = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
const agents = await convex.query("influencers:listAll", {});
const clipping = agents.filter((a) => a.agentType === "clipping");
const all = [];
for (const a of clipping) {
  const jobs = await convex.query("clipJobs:listJobsByMint", { mintAddress: a.mintAddress }).catch(() => []);
  for (const j of jobs) all.push({ agent: a.name, ...j });
}
all.sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0));
console.log(`TOTAL clip jobs: ${all.length}. Recent 12:\n`);
for (const j of all.slice(0, 12)) {
  const when = new Date(j.createdAt).toISOString().slice(5, 16).replace("T", " ");
  // count clips
  let clips = "?";
  try { clips = (await convex.query("clipJobs:getClipsForJob", { jobId: j._id })).length; } catch {}
  console.log(`[${when}] ${(j.agent || "?").padEnd(18)} status=${(j.status || "?").padEnd(12)} clips=${clips}`);
  console.log(`   src: ${(j.sourceUrl || "(uploaded blob — no url)").slice(0, 75)}`);
  if (j.error) console.log(`   ERROR: ${String(j.error).replace(/\n/g, " ").slice(0, 320)}`);
}
