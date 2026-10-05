#!/usr/bin/env node
/**
 * Deploy guard: fail the build if any NEXT_PUBLIC_*_URL is insecure.
 *
 * NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so an
 * `http://` or localhost value baked here ships to users and triggers
 * mixed-content / "Not secure" warnings on the HTTPS site (with no runtime fix
 * possible — it requires a rebuild). This catches it before it ships.
 *
 * Only enforced on deploy builds (Railway / CI / Vercel) so a local
 * `npm run build` against a local Convex/dev stack still works.
 */

const isDeployBuild =
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_SERVICE_ID ||
  process.env.CI ||
  process.env.VERCEL;

if (!isDeployBuild) {
  console.log("[check-public-urls] local build — skipping HTTPS guard");
  process.exit(0);
}

const offenders = [];
for (const [key, rawValue] of Object.entries(process.env)) {
  if (!key.startsWith("NEXT_PUBLIC_")) continue;
  if (!/URL$/.test(key)) continue;

  const value = (rawValue ?? "").trim();
  if (value.length === 0) continue;

  const insecureScheme = value.startsWith("http://");
  const isLocalhost = /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(value);

  if (insecureScheme || isLocalhost) {
    offenders.push({ key, value });
  }
}

if (offenders.length > 0) {
  console.error("\n✗ Insecure NEXT_PUBLIC_*_URL detected for a deploy build:\n");
  for (const { key, value } of offenders) {
    console.error(`  ${key}=${value}`);
  }
  console.error(
    "\nThese are baked into the client bundle and will cause mixed-content / " +
      '"Not secure" errors over HTTPS.\n' +
      "Set them to https:// production values in Railway, then rebuild.\n",
  );
  process.exit(1);
}

console.log("[check-public-urls] all NEXT_PUBLIC_*_URL values are secure ✓");
