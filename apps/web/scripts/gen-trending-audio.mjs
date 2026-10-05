// Generate the TRACK_FILES map for the Trending Audio skill from a Supabase bucket.
// Reads the EXACT uploaded filenames (so spaces / messy names are correct) and prints
// a ready-to-paste block + the TRENDING_AUDIO_BASE_URL.
//
//   node scripts/gen-trending-audio.mjs                 # no arg → lists your buckets
//   node scripts/gen-trending-audio.mjs <bucket>        # prints TRACK_FILES for that bucket
//   node scripts/gen-trending-audio.mjs <bucket> <sub>  # if the files are in a subfolder
//
// Then paste the output back to me (or into lib/server/trendingAudioPack.ts) and I'll
// set the moods + redeploy steps. The filename is URL-encoded by the skill at runtime,
// so spaces / punctuation are fine — no renaming needed.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const l = env.split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, "") : ""; };

const url = get("NEXT_PUBLIC_SUPABASE_URL");
const key = get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }

const sb = createClient(url, key);

const bucket = process.argv[2];
const prefix = process.argv[3] || "";

if (!bucket) {
  const { data, error } = await sb.storage.listBuckets();
  if (error) { console.error("listBuckets failed:", error.message); process.exit(1); }
  console.log("Buckets on this project:");
  for (const b of data || []) console.log(`  - ${b.name}${b.public ? "  (public ✓)" : "  (PRIVATE ✗ — make it public)"}`);
  console.log("\nThen run:  node scripts/gen-trending-audio.mjs <bucket> [subfolder]");
  process.exit(0);
}

const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
if (error) { console.error(`list("${bucket}") failed:`, error.message); process.exit(1); }

const AUDIO = /\.(mp3|m4a|aac|wav|ogg)$/i;
const files = (data || []).filter((f) => f?.name && AUDIO.test(f.name)).map((f) => f.name);
if (!files.length) { console.error(`No audio files in "${bucket}${prefix ? "/" + prefix : ""}". Check the bucket / subfolder name.`); process.exit(1); }

const slug = (n) => n.replace(AUDIO, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "track";
const label = (n) => n.replace(AUDIO, "").replace(/[_]+/g, " ").trim();
const seen = new Map();
const id = (n) => { const s = slug(n); const c = seen.get(s) || 0; seen.set(s, c + 1); return c ? `${s}-${c + 1}` : s; };

const base = `${url}/storage/v1/object/public/${bucket}${prefix ? "/" + prefix : ""}`;
console.log(`\n// ── Set this env (Railway + Convex), no trailing slash: ──`);
console.log(`// TRENDING_AUDIO_BASE_URL=${base}\n`);
console.log("const TRACK_FILES: Record<string, { label: string; file: string; mood: string; license?: string }> = {");
for (const name of files) {
  console.log(`  ${JSON.stringify(id(name))}: { label: ${JSON.stringify(label(name))}, file: ${JSON.stringify(name)}, mood: "chill", license: "TODO confirm cleared" },`);
}
console.log("};");
console.log(`\n// ${files.length} tracks. Set each mood → "hype" | "funny" | "emotional" (else = rotation-only).`);
