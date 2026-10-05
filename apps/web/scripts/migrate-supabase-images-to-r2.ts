/**
 * Copy every Supabase-Storage-hosted image referenced by Convex rows into R2
 * and rewrite the rows to the new URLs.
 *
 *   npx tsx scripts/migrate-supabase-images-to-r2.ts [--dry-run] [--table influencers,campaigns]
 *
 * Why: the Supabase project (slmlubxaclmoqxivcurz) is quota-restricted and
 * answers every storage request with HTTP 402, so 63/65 agent avatars are
 * blank. New writes already go to R2 (lib/server/imageStorage.ts); this moves
 * the old bytes. It needs Supabase to SERVE the files, so run it right after
 * the plan is upgraded or the billing period resets — before egress quota is
 * exhausted again (total avatar payload is a few hundred MB at most).
 *
 * Resumable: R2 keys are deterministic per source path, so re-running skips
 * objects already uploaded and only rewrites rows that still hold Supabase URLs.
 *
 * Env (reads .env.local): NEXT_PUBLIC_CONVEX_URL, INTERNAL_CRON_SECRET,
 * R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.
 */
import { config as loadEnv } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { AwsClient } from "aws4fetch";
import { api } from "../convex/_generated/api";

loadEnv({ path: ".env.local" });

const DRY = process.argv.includes("--dry-run");
const tableArg = process.argv.indexOf("--table");
const TABLES = tableArg > -1
  ? process.argv[tableArg + 1].split(",")
  : ["influencers"];

const SUPABASE_RE = /https:\/\/[a-z0-9]+\.supabase\.(?:co|in)\/storage\/v1\/object\/(?:public|authenticated)\/([^/\s"'?]+)\/([^\s"'?]+)/g;

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function collectUrls(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    for (const m of value.matchAll(SUPABASE_RE)) out.add(m[0]);
  } else if (Array.isArray(value)) {
    for (const v of value) collectUrls(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectUrls(v, out);
  }
}

async function main() {
  const convex = new ConvexHttpClient(need("NEXT_PUBLIC_CONVEX_URL"));
  const secret = need("INTERNAL_CRON_SECRET");
  const r2 = new AwsClient({ accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY") });
  const bucketBase = `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${need("R2_BUCKET")}`;
  const publicBase = need("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");

  // Only influencers has a full-row list query today; other tables can be added
  // to storageMigration.ts (listRows) if they turn out to hold Supabase URLs.
  const rows: { table: string; id: string; urls: Set<string> }[] = [];
  for (const table of TABLES) {
    if (table !== "influencers") { console.warn(`skip ${table}: no list query wired`); continue; }
    const docs = (await convex.query(api.influencers.listAll, {})) as Array<Record<string, unknown> & { _id: string }>;
    for (const d of docs) {
      const urls = new Set<string>();
      collectUrls(d, urls);
      if (urls.size) rows.push({ table, id: d._id, urls });
    }
  }
  const all = new Set<string>();
  for (const r of rows) for (const u of r.urls) all.add(u);
  console.log(`rows with supabase urls: ${rows.length}, distinct urls: ${all.size}${DRY ? " (dry-run)" : ""}`);

  const moved = new Map<string, string>();
  let failed = 0;
  let i = 0;
  for (const u of all) {
    i++;
    const m = new RegExp(SUPABASE_RE.source).exec(u);
    if (!m) continue;
    const [, bucket, path] = m;
    const key = `migrated/supabase/${bucket}/${path}`;
    const dest = `${publicBase}/${key}`;
    try {
      const head = await r2.fetch(`${bucketBase}/${key}`, { method: "HEAD" });
      if (head.ok) { moved.set(u, dest); console.log(`skip (exists) [${i}/${all.size}] ${key}`); continue; }
      if (DRY) { moved.set(u, dest); console.log(`would copy [${i}/${all.size}] ${u}`); continue; }
      const res = await fetch(u);
      if (!res.ok) { failed++; console.warn(`FAIL ${res.status} [${i}/${all.size}] ${u}`); continue; }
      const type = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
      const bytes = await res.arrayBuffer();
      const put = await r2.fetch(`${bucketBase}/${key}`, {
        method: "PUT",
        headers: { "Content-Type": type, "Content-Length": String(bytes.byteLength) },
        body: bytes,
      });
      if (!put.ok) throw new Error(`R2 PUT ${put.status}: ${(await put.text()).slice(0, 200)}`);
      moved.set(u, dest);
      console.log(`ok [${i}/${all.size}] ${(bytes.byteLength / 1e6).toFixed(2)}MB ${type} → ${key}`);
    } catch (e) {
      failed++;
      console.warn(`FAIL [${i}/${all.size}] ${u}: ${e instanceof Error ? e.message : e}`);
    }
  }

  let rewritten = 0;
  for (const r of rows) {
    const pairs = [...r.urls].filter((u) => moved.has(u)).map((u) => ({ from: u, to: moved.get(u)! }));
    if (!pairs.length) continue;
    if (DRY) { rewritten++; continue; }
    const res = (await convex.mutation(api.storageMigration.rewriteUrls, {
      authSecret: secret, table: r.table, id: r.id, pairs,
    })) as { ok: boolean; changed?: boolean };
    if (res.ok && res.changed) rewritten++;
  }
  console.log(`done: copied=${moved.size} failed=${failed} rows rewritten=${rewritten}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
