import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const cvx = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
try {
  const camps = await cvx.query("campaigns:list", {});
  const list = (camps||[]).map(c => ({ id: c._id, title: c.title, status: c.status, reward: c.contentRewardId ?? c.rewardId, drive: c.driveUrl ?? c.sourceUrl }));
  const dm = list.filter(c => /daddy|min/i.test(JSON.stringify(c)));
  console.log("MATCHES daddymin:", JSON.stringify(dm, null, 2));
  console.log("ALL titles:", JSON.stringify(list.map(c=>c.title)));
} catch(e){ console.log("campaigns:list err:", e.message); }
