import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };
const cvx = new ConvexHttpClient(get("NEXT_PUBLIC_CONVEX_URL"));
const path = "C:/Users/ongee/AppData/Local/Temp/claude/C--Project-Vello/923ccbc4-975e-4368-a1cc-8e272f2cb376/scratchpad/upload_trimmed.mp4";
const t = Date.now();
const uploadUrl = await cvx.mutation("clipStorage:generateUploadUrl", {});
console.log("got upload url");
const bytes = readFileSync(path);
console.log(`uploading ${(bytes.length/1048576).toFixed(0)}MB...`);
const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: bytes });
if (!res.ok) { console.log("upload FAIL", res.status, await res.text().catch(()=>"")); process.exit(1); }
const { storageId } = await res.json();
const publicUrl = await cvx.mutation("clipStorage:resolveStorageUrl", { storageId });
console.log(`UPLOAD_URL=${publicUrl} (${Math.round((Date.now()-t)/1000)}s)`);
