/**
 * One-off rescue: media URLs that died with the server change.
 *
 *   npx tsx scripts/rescue-dead-media.ts --export <braingull-export-dir> [--storage <boldram-full-export-dir>] [--dry-run] [--phase tempfile|boldram|all]
 *
 * Two rot classes left behind by the bold-ram-39 → brainy-gull-865 move:
 *   1. tempfile.aiquickdraw.com — KIE's temp storage; files expire silently.
 *      Still-alive ones are copied to R2 now.
 *   2. bold-ram-39.convex.cloud/api/storage/<id> — the old deployment is
 *      billing-disabled, every URL 400s. Bytes are recovered from a
 *      `convex export --include-file-storage` snapshot (--storage dir) and
 *      re-hosted on R2.
 * Every rewritten row goes through convex/storageMigration.rewriteUrls — a
 * deep substring replace, so URLs inside JSON-encoded strings
 * (agentTasks.input/output, videoRenderJobs.renderArgs) rewrite too.
 *
 * Env (reads apps/web/.env.local): NEXT_PUBLIC_CONVEX_URL, INTERNAL_CRON_SECRET,
 * R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config as dotenv } from "dotenv";
import { AwsClient } from "aws4fetch";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

dotenv({ path: path.join(__dirname, "..", ".env.local") });

const DRY = process.argv.includes("--dry-run");
const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const EXPORT_DIR = argOf("--export");
const STORAGE_DIR = argOf("--storage");
const PHASE = argOf("--phase") ?? "all";
const TABLE_FILTER = argOf("--tables")?.split(",").map((s) => s.trim()).filter(Boolean);
if (!EXPORT_DIR) { console.error("--export <dir> required"); process.exit(1); }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const URL_RE = /https:\/\/bold-ram-39\.convex\.cloud\/api\/storage\/[0-9a-f-]+|https:\/\/tempfile\.aiquickdraw\.com\/[^\s"'\\<>)\]}]+/g;

// Tables worth rewriting (mirror of storageMigration.REWRITE_TABLES).
const TABLES = [
  "influencers", "videoRenderJobs", "agentTasks", "agentStyleReferences",
  "campaigns", "agentSkillFiles", "clipGraphs", "sampleRuns", "ugcSampleRuns",
  "clipJobs", "downloadJobs", "videoRecreateProjects", "clips", "scheduledContent",
  "seriesEpisodes", "documentaryProjects",
];

const EXT_BY_TYPE: Record<string, string> = {
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "application/octet-stream": "bin",
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

async function collectRows(): Promise<Map<string, { table: string; id: string; urls: Set<string> }>> {
  const rows = new Map<string, { table: string; id: string; urls: Set<string> }>();
  for (const table of TABLE_FILTER ?? TABLES) {
    const f = path.join(EXPORT_DIR!, table, "documents.jsonl");
    if (!fs.existsSync(f)) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(f) });
    for await (const line of rl) {
      const matches = line.match(URL_RE);
      if (!matches) continue;
      const id = (JSON.parse(line) as { _id: string })._id;
      const key = `${table}:${id}`;
      const entry = rows.get(key) ?? { table, id, urls: new Set<string>() };
      // Re-match on the raw line but strip JSON escaping remnants defensively.
      for (const m of matches) entry.urls.add(m.replace(/\\+$/, ""));
      rows.set(key, entry);
    }
  }
  return rows;
}

async function main() {
  const convex = new ConvexHttpClient(need("NEXT_PUBLIC_CONVEX_URL"));
  const secret = need("INTERNAL_CRON_SECRET");
  const r2 = new AwsClient({ accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY") });
  const bucketBase = `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${need("R2_BUCKET")}`;
  const publicBase = need("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
  const day = new Date().toISOString().slice(0, 10);

  const rows = await collectRows();
  const allUrls = new Set<string>();
  for (const r of rows.values()) for (const u of r.urls) allUrls.add(u);
  const tempUrls = [...allUrls].filter((u) => u.includes("tempfile.aiquickdraw"));
  const boldUrls = [...allUrls].filter((u) => u.includes("bold-ram-39"));
  console.log(`rows=${rows.size} urls: tempfile=${tempUrls.length} bold-ram=${boldUrls.length}`);

  // url → rescued public URL (only for urls we actually saved)
  const rescued = new Map<string, string>();
  let deadTemp = 0, missingBlob = 0;

  async function putR2(bytes: ArrayBuffer, contentType: string, hint: string): Promise<string> {
    const ext = EXT_BY_TYPE[contentType.split(";")[0]] ?? "bin";
    const key = `rescued-media/${day}/${hint}.${ext}`;
    if (!DRY) {
      // Resumable: keys are deterministic per source id — skip blobs a killed
      // earlier run already uploaded.
      const head = await r2.fetch(`${bucketBase}/${key}`, { method: "HEAD" });
      if (!head.ok) {
        const put = await r2.fetch(`${bucketBase}/${key}`, { method: "PUT", body: bytes, headers: { "Content-Type": contentType } });
        if (!put.ok) throw new Error(`R2 PUT ${put.status}: ${(await put.text()).slice(0, 200)}`);
      }
    }
    return `${publicBase}/${key}`;
  }

  if (PHASE === "all" || PHASE === "tempfile") {
    let i = 0;
    for (const u of tempUrls) {
      i++;
      try {
        const res = await fetch(u, { headers: { "User-Agent": UA } });
        if (!res.ok) { deadTemp++; continue; }
        const type = res.headers.get("content-type") ?? "application/octet-stream";
        const bytes = await res.arrayBuffer();
        const hint = u.split("/").pop()!.replace(/[^a-zA-Z0-9._-]/g, "").slice(-60).replace(/\.[a-z0-9]+$/i, "") || `t${i}`;
        rescued.set(u, await putR2(bytes, type, `t-${hint}-${i}`));
        console.log(`TEMP ok  [${i}/${tempUrls.length}] ${(bytes.byteLength / 1e6).toFixed(1)}MB ${type.split(";")[0]}`);
      } catch { deadTemp++; }
    }
  }

  if ((PHASE === "all" || PHASE === "boldram") && STORAGE_DIR) {
    // Snapshot layout: _storage/<docId>.<ext> files + _storage/documents.jsonl
    // metadata rows {_id, contentType, size, internalId}. The /api/storage/
    // URLs carry the INTERNAL id (uuid), so map internalId → docId first.
    const byInternal = new Map<string, { docId: string; contentType: string }>();
    const metaFile = path.join(STORAGE_DIR, "_storage", "documents.jsonl");
    if (fs.existsSync(metaFile)) {
      const rl = readline.createInterface({ input: fs.createReadStream(metaFile) });
      for await (const line of rl) {
        const d = JSON.parse(line) as { _id: string; contentType?: string; internalId?: string };
        if (d.internalId) byInternal.set(d.internalId, { docId: d._id, contentType: d.contentType ?? "application/octet-stream" });
      }
    }
    const dir = path.join(STORAGE_DIR, "_storage");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const fileByDocId = new Map<string, string>();
    for (const f of files) if (f !== "documents.jsonl") fileByDocId.set(f.replace(/\.[a-zA-Z0-9]+$/, ""), path.join(dir, f));

    let i = 0;
    for (const u of boldUrls) {
      i++;
      const internalId = u.split("/").pop()!;
      const m = byInternal.get(internalId);
      const fp = m ? fileByDocId.get(m.docId) : undefined;
      if (!m || !fp) { missingBlob++; continue; }
      const bytes = fs.readFileSync(fp);
      rescued.set(u, await putR2(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, m.contentType, `b-${internalId}`));
      console.log(`BOLD ok  [${i}/${boldUrls.length}] ${(bytes.length / 1e6).toFixed(1)}MB ${m.contentType.split(";")[0]}`);
    }
  }

  // Rewrite rows whose URLs we rescued.
  let patched = 0, skipped = 0;
  for (const r of rows.values()) {
    const pairs = [...r.urls].filter((u) => rescued.has(u)).map((u) => ({ from: u, to: rescued.get(u)! }));
    if (pairs.length === 0) { skipped++; continue; }
    if (DRY) { patched++; continue; }
    const res = (await convex.mutation(api.storageMigration.rewriteUrls, {
      authSecret: secret, table: r.table, id: r.id, pairs,
    })) as { ok: boolean; changed?: boolean };
    if (res.ok && res.changed) patched++;
    else skipped++;
  }
  console.log(`\n${DRY ? "dry-run: " : ""}rescued=${rescued.size} rows-patched=${patched} rows-skipped=${skipped} dead-tempfile=${deadTemp} missing-boldram-blobs=${missingBlob}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
