/**
 * Where the media packs (trending audio, reaction SFX, gameplay loops, stickers)
 * are hosted.
 *
 * WHY THIS EXISTS: each pack read its own `*_BASE_URL` env var and returned "" when
 * unset, which every caller treats as "unavailable" and silently drops the op. The
 * readiness check that tells the operator "✓ Trending Audio ready" runs in the
 * CONVEX action, while the code that actually resolves the track URL runs in the
 * NEXT process — so the two must agree on ONE resolution rule, which lives here.
 *
 * The packs used to live in public buckets of the app's Supabase project, and this
 * helper derived the bucket URL from NEXT_PUBLIC_SUPABASE_URL when the var was
 * unset. That project is dead (HTTP 402, quota-restricted since 2026-09-02), so
 * the derivation is gone: a pack is configured ONLY by an explicit `*_BASE_URL`
 * (point it at an R2 public prefix, e.g. `${R2_PUBLIC_BASE_URL}/trending-audio`),
 * and a var still pointing at the dead host counts as unconfigured — otherwise
 * every render would fetch the track, get 402, and either fail or ship silent.
 */
import { isDeadMediaUrl } from "../deadMediaHosts";

/**
 * Resolve a pack's base URL from its explicit env var. "" when unset, or when the
 * configured host no longer serves anything.
 */
/** Pack prefixes that scripts/upload-*-to-r2.ts have populated on R2. Add a
 *  bucket here once its files are uploaded; until then it needs an explicit var. */
export const R2_HOSTED_PACKS: ReadonlySet<string> = new Set(["trending-audio", "sfx"]);

export function mediaPackBase(envVar: string, bucket: string): string {
  const env = globalThis.process?.env ?? {};
  const explicit = (env[envVar] ?? "").trim().replace(/\/+$/, "");
  // An explicit var still pointing at the dead Supabase host is IGNORED (not a
  // hard ""), so it falls through to the R2 derivation below. Railway kept the old
  // `TRENDING_AUDIO_BASE_URL=…supabase.co/…` value, which silenced every track in
  // prod even though the files were already on R2.
  if (explicit && !isDeadMediaUrl(explicit) && !isDeadMediaUrl(`${explicit}/`)) return explicit;
  // No explicit var: the packs now live on the app's own R2 bucket under a
  // prefix named after the old Supabase bucket (`trending-audio/`, `sfx/`, …),
  // uploaded by scripts/upload-trending-audio-to-r2.ts. Deriving from
  // R2_PUBLIC_BASE_URL means every environment that can store videos can also
  // play music — no per-pack env var to forget on Railway.
  // Only packs that have actually been uploaded to R2 derive this way —
  // otherwise `mediaPackConfigured` would report an empty prefix as ready and
  // hide the "pack not configured" diagnostic the health check exists for.
  const b = bucket.replace(/^\/+|\/+$/g, "");
  if (!R2_HOSTED_PACKS.has(b)) return "";
  const r2 = (env.R2_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!r2 || isDeadMediaUrl(r2)) return "";
  return `${r2}/${b}`;
}

/** True when a pack can be resolved at all — for readiness reporting. */
export function mediaPackConfigured(envVar: string, bucket: string): boolean {
  return mediaPackBase(envVar, bucket).length > 0;
}
