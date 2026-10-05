/**
 * One-off migration: move every video blob out of Convex file storage into
 * Cloudflare R2, rewrite the referencing rows, then sweep the leftovers.
 *
 *   npx tsx scripts/migrate-videos-to-r2.ts --dry-run   # counts + GB, no writes
 *   npx tsx scripts/migrate-videos-to-r2.ts             # real run (resumable)
 *
 * Env (reads apps/web/.env.local automatically):
 *   NEXT_PUBLIC_CONVEX_URL, INTERNAL_CRON_SECRET,
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
 *
 * Phases:
 *   1. REWRITE — for every allowlisted table.field holding a Convex storage
 *      URL: download blob, PUT to R2, patch the row to the R2 URL, delete the
 *      Convex blob. downloadCache rows are DELETED instead (it's a cache).
 *   2. SWEEP — every remaining _storage object with a video/* or audio/*
 *      contentType is deleted (orphans: failed jobs, superseded renders).
 *      Non-video blobs (transcripts JSON, images, résumés) are untouched.
 *
 * Resumable: re-running skips rows whose URL already points at R2, and the
 * sweep only ever sees blobs that are still there.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
import { putVideo } from "../lib/server/videoStorage";

dotenv({ path: resolve(__dirname, "../.env.local") });

const DRY = process.argv.includes("--dry-run");
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const SECRET = process.env.INTERNAL_CRON_SECRET!;
if (!CONVEX_URL || !SECRET) { console.error("missing NEXT_PUBLIC_CONVEX_URL / INTERNAL_CRON_SECRET"); process.exit(1); }
if (!DRY && !(process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET && process.env.R2_PUBLIC_BASE_URL)) {
  console.error("missing R2_* env — set it or use --dry-run"); process.exit(1);
}

const convex = new ConvexHttpClient(CONVEX_URL);
type StorageFilePage = { files: { id: string; size: number; contentType: string | null; url: string | null }[]; cursor: string | null; isDone: boolean };
type ScanPage = { rows: { _id: string; fields: Record<string, string | null> }[]; cursor: string | null; isDone: boolean };

const isConvexStorageUrl = (u: string) => u.includes(".convex.cloud/api/storage/");

// Same rewrite allowlist as convex/storageMigration.ts (keep in sync).
const TABLES: Record<string, string[]> = {
  clips: ["clipUrl"],
  scheduledContent: ["videoUrl"],
  seriesEpisodes: ["videoUrl"],
  videoRenderJobs: ["videoUrl"],
  documentaryProjects: ["videoUrl"],
  videoRecreateProjects: ["videoUrl"],
  agentStyleReferences: ["videoUrl"],
  sampleRuns: ["clipUrl", "videoUrl"],
  ugcSampleRuns: ["videoUrl"],
};

let movedBytes = 0, movedCount = 0, failCount = 0;

async function urlToStorageIdMap(): Promise<Map<string, { id: string; size: number; contentType: string | null }>> {
  const map = new Map<string, { id: string; size: number; contentType: string | null }>();
  let cursor: string | null = null;
  for (;;) {
    const page: StorageFilePage = await convex.query(api.storageMigration.listStorageFiles, { authSecret: SECRET, cursor, limit: 200 });
    for (const f of page.files) if (f.url) map.set(f.url, { id: f.id, size: f.size, contentType: f.contentType });
    if (page.isDone) break;
    cursor = page.cursor;
  }
  return map;
}

async function moveOne(url: string, keyPrefix: string, blobIndex: Map<string, { id: string; size: number; contentType: string | null }>): Promise<string | null> {
  const meta = blobIndex.get(url);
  if (DRY) { movedCount++; movedBytes += meta?.size ?? 0; return null; }
  const res = await fetch(url);
  if (!res.ok) { console.warn(`  ! fetch ${res.status} ${url.slice(-40)}`); failCount++; return null; }
  const bytes = await res.arrayBuffer();
  const { url: r2Url } = await putVideo(bytes, { keyPrefix, contentType: meta?.contentType ?? "video/mp4" });
  movedCount++; movedBytes += bytes.byteLength;
  if (meta) await convex.mutation(api.storageMigration.deleteStorageObject, { authSecret: SECRET, storageId: meta.id });
  return r2Url;
}

async function rewriteTables(blobIndex: Map<string, { id: string; size: number; contentType: string | null }>) {
  for (const [table, fields] of Object.entries(TABLES)) {
    console.log(`\n== ${table}`);
    let cursor: string | null = null;
    for (;;) {
      const page: ScanPage = await convex.query(api.storageMigration.scanTable, { authSecret: SECRET, table, cursor, limit: 200 });
      for (const row of page.rows) {
        for (const field of fields) {
          const url = row.fields[field];
          if (!url || !isConvexStorageUrl(url)) continue;
          const r2Url = await moveOne(url, table === "clips" ? "clips" : "videos", blobIndex);
          if (r2Url) {
            await convex.mutation(api.storageMigration.patchUrl, { authSecret: SECRET, table, id: row._id, field, url: r2Url });
            console.log(`  ✓ ${table}.${field} ${row._id}`);
          } else if (DRY) console.log(`  ~ would move ${table}.${field} ${row._id}`);
        }
      }
      if (page.isDone) break;
      cursor = page.cursor;
    }
  }

  // downloadCache: pure cache — drop rows + their blobs, no copy.
  console.log(`\n== downloadCache (purge)`);
  let cursor: string | null = null;
  for (;;) {
    const page: ScanPage = await convex.query(api.storageMigration.scanTable, { authSecret: SECRET, table: "downloadCache", cursor, limit: 200 });
    for (const row of page.rows) {
      if (DRY) { console.log(`  ~ would purge ${row._id}`); continue; }
      const url = row.fields.url;
      const meta = url ? blobIndex.get(url) : undefined;
      if (meta) await convex.mutation(api.storageMigration.deleteStorageObject, { authSecret: SECRET, storageId: meta.id });
      await convex.mutation(api.storageMigration.deleteRow, { authSecret: SECRET, table: "downloadCache", id: row._id });
      console.log(`  ✓ purged ${row._id}`);
    }
    if (page.isDone) break;
    cursor = page.cursor;
  }
}

async function sweepOrphans() {
  console.log(`\n== sweep (video/audio orphans)`);
  const keep = new Set(await convex.query(api.storageMigration.listKeepStorageIds, { authSecret: SECRET }));
  let cursor: string | null = null, swept = 0, sweptBytes = 0;
  for (;;) {
    const page: StorageFilePage = await convex.query(api.storageMigration.listStorageFiles, { authSecret: SECRET, cursor, limit: 200 });
    for (const f of page.files) {
      const ct = f.contentType ?? "";
      if (!ct.startsWith("video/") && !ct.startsWith("audio/")) continue;
      if (keep.has(f.id)) continue;
      swept++; sweptBytes += f.size;
      if (!DRY) await convex.mutation(api.storageMigration.deleteStorageObject, { authSecret: SECRET, storageId: f.id });
    }
    if (page.isDone) break;
    cursor = page.cursor;
  }
  console.log(`${DRY ? "would sweep" : "swept"} ${swept} orphan blobs, ${(sweptBytes / 1e9).toFixed(2)} GB`);
}

(async () => {
  console.log(`${DRY ? "DRY RUN" : "LIVE"} against ${CONVEX_URL}`);
  console.log("indexing _storage…");
  const blobIndex = await urlToStorageIdMap();
  console.log(`${blobIndex.size} storage objects`);
  await rewriteTables(blobIndex);
  await sweepOrphans();
  console.log(`\nmoved ${movedCount} blobs (${(movedBytes / 1e9).toFixed(2)} GB), ${failCount} fetch failures`);
})();
