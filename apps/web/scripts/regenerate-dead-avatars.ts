/**
 * Regenerate avatars for agents whose images died with the Supabase project.
 *
 *   npx tsx scripts/regenerate-dead-avatars.ts [--dry-run] [--limit N] [--mint <mintAddress>]
 *
 * Why: the Supabase project (slmlubxaclmoqxivcurz) is quota-restricted — every
 * storage object answers HTTP 402 — and 63 minted agents had ALL their avatar
 * files (display GIF + reference stills) there. The bytes cannot be fetched, so
 * migrating them is impossible; instead each agent gets a NEW portrait rendered
 * from its persona (name / niche / archetype / description / personality) with
 * the same Kie image model the builder uses, stored on R2, and the row is
 * re-pointed (avatarUrl + avatarStills + any other dead URL in the row).
 *
 * Safety:
 *  - Before any rewrite, the full {row id → dead URLs} map is written to R2 at
 *    `supabase/legacy-url-map/<timestamp>.json` so the originals can still be
 *    migrated if the Supabase plan is ever paid (scripts/migrate-supabase-images-to-r2.ts).
 *  - Only rows with NO live http still are touched; rows that already have a
 *    live R2 image only get their dead URLs swapped for that live image.
 *  - Resumable: re-running skips rows with no dead URLs left.
 *
 * Env (reads .env.local): NEXT_PUBLIC_CONVEX_URL, INTERNAL_CRON_SECRET, KIE_API_KEY,
 * R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.
 */
import "./loadEnv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { isDeadMediaUrl } from "../lib/deadMediaHosts";
import { createNftTask, pollNftTaskOnce, sleep } from "../lib/server/nftKie";
import { putImage } from "../lib/server/imageStorage";

const DRY = process.argv.includes("--dry-run");
const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LIMIT = Number(argOf("--limit") ?? Infinity);
const ONLY_MINT = argOf("--mint");

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

const URL_RE = /https?:\/\/[^\s"'\\<>)\]}|,]+/g;
const STILL_RE = /\.(png|jpe?g|webp)(\?|#|$)/i;

type Row = Record<string, unknown> & { _id: string; mintAddress?: string; name?: string; avatarUrl?: string; avatarStills?: string[] };

function collectUrls(v: unknown, out: Set<string>): void {
  if (typeof v === "string") {
    for (const m of v.match(URL_RE) ?? []) out.add(m);
  } else if (Array.isArray(v)) {
    v.forEach((x) => collectUrls(x, out));
  } else if (v && typeof v === "object") {
    Object.values(v as Record<string, unknown>).forEach((x) => collectUrls(x, out));
  }
}

function buildPrompt(r: Row): string {
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  const name = s("name") || "the agent";
  const niche = s("niche") || "viral short-form";
  const vibe = [s("archetype"), s("personality"), s("description")].filter(Boolean).join(". ");
  const isClipping = r.agentType === "clipping";
  return isClipping
    ? [
        `Design a vibrant, collectible profile-picture (PFP) style avatar for "${name}", a ${niche} clip creator.`,
        vibe ? `Character & vibe (make THIS the star): ${vibe}.` : "",
        `One bold, expressive character with a strong readable silhouette, centered hero portrait, confident personality and a fun facial expression.`,
        `Punchy saturated palette with 1-2 accent colors, dynamic rim + cinematic key lighting, clean depth, polished poster-grade illustration.`,
        `Ultra-detailed, sharp focus. No text, no logos, no watermark, no borders.`,
      ].filter(Boolean).join(" ")
    : [
        `Photorealistic portrait of ${name}, a ${niche} content creator and on-camera host.`,
        vibe ? `Personality and look: ${vibe}.` : "",
        `Natural confident expression looking at camera, studio key light + soft rim light, shallow depth of field, clean modern background, ultra-detailed skin and hair, editorial quality.`,
        `No text, no logos, no watermark, no borders.`,
      ].filter(Boolean).join(" ");
}

async function renderPortrait(prompt: string): Promise<string> {
  const taskId = await createNftTask(prompt);
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await sleep(4000);
    const r = await pollNftTaskOnce(taskId);
    if (r.status === "success") return r.url;
    if (r.status === "fail") throw new Error(`Kie task failed: ${r.error}`);
  }
  throw new Error("Kie task timed out");
}

async function persistToR2(rawUrl: string, mint: string): Promise<string> {
  const res = await fetch(rawUrl);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = (res.headers.get("content-type") ?? "image/png").split(";")[0];
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  const { url } = await putImage(buf, mime, { key: `avatars/regen/${mint}.${ext}` });
  return url;
}

async function main() {
  const convex = new ConvexHttpClient(need("NEXT_PUBLIC_CONVEX_URL"));
  const secret = need("INTERNAL_CRON_SECRET");
  const rows = (await convex.query(api.influencers.listAll, {})) as Row[];

  const work: Array<{ row: Row; dead: string[]; live: string | null }> = [];
  for (const r of rows) {
    if (ONLY_MINT && r.mintAddress !== ONLY_MINT) continue;
    const urls = new Set<string>();
    collectUrls(r, urls);
    const dead = [...urls].filter(isDeadMediaUrl);
    if (dead.length === 0) continue;
    const avatarish = [r.avatarUrl, ...(r.avatarStills ?? [])].filter((u): u is string => typeof u === "string");
    const live = avatarish.find((u) => /^https?:\/\//i.test(u) && !isDeadMediaUrl(u) && STILL_RE.test(u)) ?? null;
    work.push({ row: r, dead, live });
  }
  console.log(`${rows.length} agents; ${work.length} carry dead URLs; ${work.filter((w) => !w.live).length} need a NEW portrait`);
  if (work.length === 0) return;

  // Durable backup of the originals before anything is rewritten.
  const backup = Object.fromEntries(work.map((w) => [w.row._id, { mint: w.row.mintAddress, name: w.row.name, dead: w.dead }]));
  if (!DRY) {
    const { url } = await putImage(Buffer.from(JSON.stringify(backup, null, 2)), "application/json", {
      key: `supabase/legacy-url-map/${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    });
    console.log(`legacy url map → ${url}`);
  }

  let done = 0, failed = 0;
  for (const w of work.slice(0, LIMIT)) {
    const label = `${w.row.name ?? "?"} (${w.row.mintAddress ?? w.row._id})`;
    try {
      let target = w.live;
      if (!target) {
        const prompt = buildPrompt(w.row);
        if (DRY) { console.log(`[dry] would render: ${label}\n      ${prompt.slice(0, 160)}…`); continue; }
        const raw = await renderPortrait(prompt);
        target = await persistToR2(raw, w.row.mintAddress ?? w.row._id);
        console.log(`rendered ${label} → ${target}`);
      } else if (DRY) {
        console.log(`[dry] would re-point ${w.dead.length} dead urls of ${label} → existing ${target}`);
        continue;
      }
      const pairs = w.dead.map((from) => ({ from, to: target! }));
      const res = await convex.mutation(api.storageMigration.rewriteUrls, { authSecret: secret, table: "influencers", id: w.row._id, pairs });
      console.log(`rewrote ${label}: ${JSON.stringify(res)}`);
      done++;
    } catch (e) {
      failed++;
      console.error(`FAILED ${label}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`done=${done} failed=${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
