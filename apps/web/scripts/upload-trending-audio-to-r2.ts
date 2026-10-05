/**
 * Upload the Trending Audio pack (lib/server/trendingAudioPack.ts TRACK_FILES) from
 * local folders to R2 under `trending-audio/`, so TRENDING_AUDIO_BASE_URL can point
 * at `${R2_PUBLIC_BASE_URL}/trending-audio`.
 *
 * Why: the pack lived only in a Supabase public bucket, which has been
 * quota-restricted (HTTP 402, even with the service key) since 2026-09-02, so every
 * track URL resolved to "" and the Editor's Music drawer showed every track
 * disabled ("cannot select the music").
 *
 * Usage (from apps/web, reads .env.local for R2_*):
 *   npx tsx scripts/upload-trending-audio-to-r2.ts <rootTracksDir> <podcastTracksDir> [--dry]
 *
 * Idempotent: an object that already exists with the same size is skipped.
 */
import { readFileSync, statSync, existsSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";

const envText = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL"]) {
  if (!process.env[k]) { console.error(`missing ${k}`); process.exit(1); }
}

const [rootDir, podcastDir, flag] = process.argv.slice(2);
if (!rootDir || !podcastDir) { console.error("usage: <rootTracksDir> <podcastTracksDir> [--dry]"); process.exit(1); }
const dry = flag === "--dry";

// Parse TRACK_FILES straight from the source so this never drifts from the app.
const src = readFileSync("lib/server/trendingAudioPack.ts", "utf8");
const entries = [...src.matchAll(/file: "([^"]*)"(?:[^}]*?folder: "([^"]*)")?/g)].map((m) => ({ file: m[1], folder: m[2] ?? "" }));
if (entries.length === 0) { console.error("no TRACK_FILES entries parsed"); process.exit(1); }

const client = new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto",
});
const endpoint = (key: string) =>
  `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function main() {
  let uploaded = 0, skipped = 0, missing = 0;
  for (const { file, folder } of entries) {
    const local = folder ? join(podcastDir, file) : join(rootDir, file);
    if (!existsSync(local)) { console.warn(`MISSING locally: ${local}`); missing++; continue; }
    const size = statSync(local).size;
    const key = `trending-audio/${folder ? `${folder}/` : ""}${file}`;
    const head = await client.fetch(endpoint(key), { method: "HEAD" });
    if (head.ok && Number(head.headers.get("content-length")) === size) { skipped++; continue; }
    if (dry) { console.log(`would upload ${key} (${(size / 1e6).toFixed(1)} MB)`); uploaded++; continue; }
    const res = await client.fetch(endpoint(key), {
      method: "PUT",
      headers: { "Content-Type": "audio/mpeg", "Content-Length": String(size), "x-amz-content-sha256": "UNSIGNED-PAYLOAD" },
      body: createReadStream(local) as unknown as BodyInit,
      // @ts-expect-error duplex required by Node fetch for streaming bodies
      duplex: "half",
    });
    if (!res.ok) throw new Error(`PUT ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    console.log(`uploaded ${key} (${(size / 1e6).toFixed(1)} MB)`);
    uploaded++;
  }
  console.log(`\ndone: ${uploaded} uploaded, ${skipped} already present, ${missing} missing locally`);
  console.log(`set TRENDING_AUDIO_BASE_URL=${process.env.R2_PUBLIC_BASE_URL!.replace(/\/+$/, "")}/trending-audio`);
}
main().catch((e) => { console.error(e); process.exit(1); });
