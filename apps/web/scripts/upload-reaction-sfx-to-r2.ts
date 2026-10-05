/**
 * Upload the Reaction SFX pack (lib/server/reactionSfxPack.ts SFX_FILES) from a
 * local folder to R2 under `sfx/`, where mediaPackBase derives it from
 * R2_PUBLIC_BASE_URL (no REACTION_SFX_BASE_URL needed).
 *
 * Why: the pack only ever lived in the dead Supabase `sfx` bucket, so every sound
 * resolved to "" — the Editor's Sound Effect drawer and the Meme SFX skill were
 * silent. The files are original, royalty-free stings synthesized by
 * scripts/generate-reaction-sfx.sh (ffmpeg + macOS `say`).
 *
 * Usage (from apps/web, reads .env.local for R2_*):
 *   bash scripts/generate-reaction-sfx.sh /tmp/sfx
 *   npx tsx scripts/upload-reaction-sfx-to-r2.ts /tmp/sfx [--dry] [--force]
 *
 * Idempotent: an object that already exists with the same size is skipped
 * (--force re-uploads anyway, e.g. after regenerating a sound).
 */
import { readFileSync, statSync, existsSync } from "node:fs";
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

const [dir, ...flags] = process.argv.slice(2);
if (!dir) { console.error("usage: <sfxDir> [--dry] [--force]"); process.exit(1); }
const dry = flags.includes("--dry");
const force = flags.includes("--force");

// Parse SFX_FILES straight from the source so this never drifts from the app.
const src = readFileSync("lib/server/reactionSfxPack.ts", "utf8");
const files = [...src.matchAll(/file: "([^"]+\.mp3)"/g)].map((m) => m[1]);
if (files.length === 0) { console.error("no SFX_FILES entries parsed"); process.exit(1); }

const client = new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto",
});
const endpoint = (key: string) =>
  `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;

async function main() {
  let uploaded = 0, skipped = 0, missing = 0;
  for (const file of files) {
    const local = join(dir, file);
    if (!existsSync(local)) { console.warn(`MISSING locally: ${local}`); missing++; continue; }
    const size = statSync(local).size;
    const key = `sfx/${file}`;
    if (!force) {
      const head = await client.fetch(endpoint(key), { method: "HEAD" });
      if (head.ok && Number(head.headers.get("content-length")) === size) { skipped++; continue; }
    }
    if (dry) { console.log(`would upload ${key} (${(size / 1e3).toFixed(0)} KB)`); uploaded++; continue; }
    const res = await client.fetch(endpoint(key), {
      method: "PUT",
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000" },
      body: readFileSync(local),
    });
    if (!res.ok) throw new Error(`PUT ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    console.log(`uploaded ${key} (${(size / 1e3).toFixed(0)} KB)`);
    uploaded++;
  }
  console.log(`\ndone: ${uploaded} uploaded, ${skipped} already present, ${missing} missing locally`);
}
main().catch((e) => { console.error(e); process.exit(1); });
