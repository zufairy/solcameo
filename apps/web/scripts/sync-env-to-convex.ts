/**
 * One-off: push every backend-used env var from .env.local to the CURRENT
 * Convex prod deployment (per CONVEX_DEPLOYMENT in .env.local).
 *
 *   cd apps/web && npx tsx scripts/sync-env-to-convex.ts
 *
 * Skips CONVEX_* / NEXT_PUBLIC_CONVEX_URL (deployment identity) and R2_*
 * (already set). Uses `npx convex env set --prod` per var.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const names = new Set(
  readFileSync("/private/tmp/claude-501/-Users-along-Documents-GitHub-vello/cb959aa7-29e5-471b-be2b-cc20b13f61a0/scratchpad/envnames.txt", "utf8")
    .split("\n").map((s) => s.trim()).filter(Boolean),
);
const envFile = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
const skip = (n: string) => n.startsWith("CONVEX_") || n === "NEXT_PUBLIC_CONVEX_URL" || n.startsWith("R2_");

let count = 0;
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  const [, name, raw] = m;
  if (!names.has(name) || skip(name)) continue;
  const val = raw.replace(/\s+#.*$/, "").trim();
  if (!val) continue;
  try {
    execFileSync("npx", ["convex", "env", "set", "--prod", name, val], { stdio: "pipe", env: { ...process.env, CONVEX_DEPLOY_KEY: "" } });
    console.log(`set ${name}`);
    count++;
  } catch (e) {
    console.error(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(`done — ${count} vars set`);
