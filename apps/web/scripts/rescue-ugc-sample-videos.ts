/**
 * One-off rescue: UGC sample videos still hosted on ephemeral/dead hosts.
 *
 *   npx tsx scripts/rescue-ugc-sample-videos.ts --dry-run   # list what would move
 *   npx tsx scripts/rescue-ugc-sample-videos.ts             # copy to R2 + patch slots
 *
 * Why: pre-R2 ugcSampleRuns kept slot videoUrls pointing at
 * tempfile.aiquickdraw.com (KIE temp storage — expires without notice) or the
 * dead bold-ram-39 Convex deployment. Rows survive but the videos rot away.
 * This copies every still-fetchable non-R2 video into the vello-videos bucket
 * under renders/rescued/ and patches the slot via ugcSampleRuns.updateSlot.
 *
 * Env (reads apps/web/.env.local automatically):
 *   NEXT_PUBLIC_CONVEX_URL, INTERNAL_CRON_SECRET,
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { config as dotenv } from "dotenv";
import { AwsClient } from "aws4fetch";
import { randomUUID } from "node:crypto";
import path from "node:path";

dotenv({ path: path.join(__dirname, "..", ".env.local") });

const DRY = process.argv.includes("--dry-run");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const {
  NEXT_PUBLIC_CONVEX_URL, INTERNAL_CRON_SECRET,
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL,
} = process.env;

function need(name: string, v: string | undefined): string {
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

async function main() {
  const convex = new ConvexHttpClient(need("NEXT_PUBLIC_CONVEX_URL", NEXT_PUBLIC_CONVEX_URL));
  const secret = need("INTERNAL_CRON_SECRET", INTERNAL_CRON_SECRET);
  const r2 = new AwsClient({
    accessKeyId: need("R2_ACCESS_KEY_ID", R2_ACCESS_KEY_ID),
    secretAccessKey: need("R2_SECRET_ACCESS_KEY", R2_SECRET_ACCESS_KEY),
  });
  const bucketBase = `https://${need("R2_ACCOUNT_ID", R2_ACCOUNT_ID)}.r2.cloudflarestorage.com/${need("R2_BUCKET", R2_BUCKET)}`;
  const publicBase = need("R2_PUBLIC_BASE_URL", R2_PUBLIC_BASE_URL).replace(/\/+$/, "");

  const runs = await convex.query(api.ugcSampleRuns.listRecent, { limit: 100 });
  let moved = 0, dead = 0, kept = 0;

  for (const run of runs) {
    for (let i = 0; i < run.slots.length; i++) {
      const slot = run.slots[i];
      const url = slot.videoUrl;
      if (!url) continue;
      if (url.startsWith(publicBase)) { kept++; continue; } // already on R2

      const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
      if (!res || !res.ok) {
        dead++;
        console.log(`DEAD  ${run.websiteUrl} [${i}] ${slot.type} — ${res ? res.status : "fetch failed"} ${url.slice(0, 80)}`);
        continue;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      const key = `renders/rescued/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.mp4`;
      console.log(`${DRY ? "WOULD MOVE" : "MOVE"}  ${run.websiteUrl} [${i}] ${slot.type} — ${(bytes.length / 1e6).toFixed(1)}MB → ${key}`);
      if (DRY) { moved++; continue; }

      const put = await r2.fetch(`${bucketBase}/${key}`, {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": res.headers.get("content-type") ?? "video/mp4" },
      });
      if (!put.ok) throw new Error(`R2 PUT ${put.status}: ${await put.text()}`);

      await convex.mutation(api.ugcSampleRuns.updateSlot, {
        runId: run._id, index: i, videoUrl: `${publicBase}/${key}`, authSecret: secret,
      });
      moved++;
    }
  }
  console.log(`\n${DRY ? "dry-run: " : ""}moved=${moved} already-r2=${kept} dead=${dead}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
