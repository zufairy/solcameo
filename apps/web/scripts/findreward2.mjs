import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const URL_ = get("NEXT_PUBLIC_SUPABASE_URL"); const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const H = { apikey: ANON, Authorization: `Bearer ${ANON}` };
const r = await fetch(`${URL_}/rest/v1/content_rewards?select=id,campaign_name,type,status&order=created_at.desc&limit=60`, { headers: H });
const rows = await r.json();
if (!Array.isArray(rows)) { console.log("resp:", JSON.stringify(rows).slice(0,300)); process.exit(0); }
const clip = rows.filter(x => (x.type??"").toLowerCase()==="clipping");
console.log("ALL clipping campaigns ("+clip.length+"):", JSON.stringify(clip.map(c=>({id:c.id,name:c.campaign_name,st:c.status}))).slice(0,1500));
console.log("\nDADDY matches:", JSON.stringify(rows.filter(x=>/daddy/i.test(x.campaign_name||""))));
