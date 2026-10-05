import { mediaPackBase } from "@/lib/server/mediaPackBase";
// Built-in music library for the clip.trendingaudio ("Trending Audio") skill. Each
// track is hosted at TRENDING_AUDIO_BASE_URL/<file>; that env MUST be set for the
// skill to emit audio. With no base URL, trendingAudioUrl() returns "" — the catalog
// floor then emits NO audio_overlay op (the render is unchanged), so the feature
// degrades gracefully instead of pointing ffmpeg at a missing input. Mirrors the
// reactionSfxPack / gameplayPack pattern.
//
// The `file` is the EXACT object name in the Supabase `trending-audio` bucket
// (regenerated from the bucket via scripts/gen-trending-audio.mjs). `mood` drives the
// auto-pick: pickTrendingTrackByMood maps each video's emotion to a mood bucket so the
// best-fitting track is chosen per video ("hype" | "funny" | "emotional"; other moods
// participate only in the no-mood rotation fallback). `license` is operator-supplied:
// confirm each is cleared/royalty-free since the skill re-uploads it into user clips.

export interface TrendingAudioEntry {
  /** Stable id the inspector stores as config.musicTrackId; also the file stem. */
  id: string;
  /** Human label for the inspector picker. */
  label: string;
  /** Resolved absolute URL of the track, or "" when the base env is unset. */
  url: string;
  /** Auto-pick bucket. The picker maps emotion → "hype" | "funny" | "emotional";
   *  any other tag (e.g. "chill") participates only in the no-mood rotation fallback. */
  mood: string;
  /** Bucket subfolder shown in the inspector picker (e.g. "Podcast"). Root tracks
   *  (no folder) render ungrouped, same as before this field existed. */
  folder?: string;
  /** No sung lyrics/vocal melody — a pure music bed. Auto-pick filters to these
   *  when the clip is dialogue-heavy (see pickTrendingTrackByMood's
   *  preferInstrumental) so a vocal song's singing never fights the speaker's
   *  own voice. Unset = has vocals (the safe default for the catalog's many
   *  real pop-song licenses). */
  instrumental?: boolean;
}

/** id → file + metadata. THE place the operator registers each supplied track. A map
 *  (not `${id}.mp3`) so renaming the public file doesn't churn the id. The `file` is
 *  the EXACT object name in the TRENDING_AUDIO_BASE_URL bucket; it's URL-encoded at
 *  resolution time, so spaces / punctuation are fine.
 *
 *  Hosted in the public Supabase `trending-audio` bucket. Moods were inferred from the
 *  titles (the auto-pick maps emotion → hype|funny|emotional; anything else is
 *  rotation-only) — adjust per the actual sound. `license` is operator-supplied:
 *  confirm each is cleared/royalty-free since the skill re-uploads it into user clips. */
const TRACK_FILES: Record<string, { label: string; file: string; mood: string; folder?: string; license?: string; instrumental?: boolean }> = {
  // ── Podcast folder (trending-audio/podcast/…) — background beds for talking-head
  // / interview content, pulled straight from what's actually in the bucket
  // (checked via the Supabase storage list API, not guessed). Moods inferred from
  // title/genre same as the root pack.
  "podcast-chill-dream-lofi": { label: "Chill Dream — Lo-Fi (Relax/Study/Sleep)", file: "Chill Dream _ Royalty Free Lo-Fi Music for Relax, Study & Sleep.mp3", mood: "chill", folder: "podcast", license: "operator-supplied — verify cleared", instrumental: true },
  "podcast-dl": { label: "DL", file: "dl.mp3", mood: "chill", folder: "podcast", license: "operator-supplied — verify cleared" },
  "podcast-echo-sax-end": { label: "Echo Sax End — Caleb Arredondo", file: "Echo Sax End (Original) by Caleb Arredondo.mp3", mood: "chill", folder: "podcast", license: "operator-supplied — verify cleared", instrumental: true },
  "podcast-funny-quirky-comedy": { label: "Funny Quirky Comedy", file: "Funny Quirky Comedy (Free Download Background Music).mp3", mood: "funny", folder: "podcast", license: "operator-supplied — verify cleared", instrumental: true },
  "podcast-lakey-inspired-chill-day": { label: "Chill Day — LAKEY INSPIRED", file: "LAKEY INSPIRED - Chill Day.mp3", mood: "chill", folder: "podcast", license: "operator-supplied — verify cleared", instrumental: true },
  "podcast-love-story-instrumental": { label: "Love Story (Instrumental)", file: "Love Story (instrumental version).mp3", mood: "emotional", folder: "podcast", license: "operator-supplied — verify cleared", instrumental: true },
  "podcast-richard-carter-le-monde": { label: "Le Monde — Richard Carter", file: "Richard Carter - Le Monde.mp3", mood: "chill", folder: "podcast", license: "operator-supplied — verify cleared", instrumental: true },
  "podcast-synthwave-blade-runner": { label: "Blade Runner 2049 — Synthwave Goose", file: "Synthwave goose - Blade Runner 2049.mp3", mood: "chill", folder: "podcast", license: "operator-supplied — verify cleared", instrumental: true },
  "podcast-viral-fun-gold-tiger": { label: "Viral Fun Track — Gold Tiger", file: "Viral Fun Track for Reels, TikTok & Shorts  Gold Tiger - Funny  Full Version 2024.mp3", mood: "funny", folder: "podcast", license: "operator-supplied — verify cleared" },
  "podcast-carmen-prelude-funny": { label: "Carmen Prelude (Funny TikTok Song)", file: "yo suzuki akisai - Carmen Prelude (Funny Tiktok Song) FULL.mp3", mood: "funny", folder: "podcast", license: "operator-supplied — verify cleared" },
  "brazil-dance": { label: "Brazil Dance", file: "brazil dance.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "break-my-heart-dua-lipa": { label: "Break My Heart — Dua Lipa", file: "Break My Heart Dua Lipa.mp3", mood: "emotional", license: "operator-supplied — verify cleared" },
  "calvin-harris-feels": { label: "Feels — Calvin Harris ft Pharrell, Katy Perry, Big Sean", file: "Calvin Harris-Feels ft Pharrell Williams,Katy Perry,Big Sean.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "chanel-tyla": { label: "Chanel — Tyla", file: "chanel -tyla.mp3", mood: "emotional", license: "operator-supplied — verify cleared" },
  "dj-obh-combi-sachet": { label: "DJ OBH Combi Sachet", file: "DJ OBH Combi Sachet.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "dracula-tame-impala": { label: "Dracula — Tame Impala", file: "Dracula- Tame Impala.mp3", mood: "chill", license: "operator-supplied — verify cleared" },
  "du-bist-gut-genug": { label: "Du Bist Gut Genug", file: "du bist gut genug.mp3", mood: "emotional", license: "operator-supplied — verify cleared" },
  "everyday-ariana-grande": { label: "Everyday — Ariana Grande", file: "Everyday - Ariana Grande.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "freaked-out": { label: "Freaked Out", file: "freaked out.mp3", mood: "funny", license: "operator-supplied — verify cleared" },
  "in-this-darkness-clara-la-san": { label: "In This Darkness — Clara La San", file: "In this darkness- Clara La san.mp3", mood: "emotional", license: "operator-supplied — verify cleared" },
  "kicau-mania": { label: "Kicau Mania", file: "Kicau Mania.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "naykilla-mmg": { label: "Naykilla — MMG (My Mine Gueh)", file: "Naykilla-MMG (my Mine Gueh).mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "no-lie-seal-dua-lipa": { label: "No Lie — Sean Paul & Dua Lipa", file: "No lie - Seal Paul & Dua Lipa.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "obsessed-mariah-carey": { label: "Obsessed — Mariah Carey", file: "obsessed mariah carey.mp3", mood: "funny", license: "operator-supplied — verify cleared" },
  "on-the-floor-jlo-pitbull": { label: "On The Floor — Jennifer Lopez & Pitbull", file: "On the floor - Jennifer Lopez & Pitbull.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "positions-ariana-grande": { label: "Positions — Ariana Grande", file: "positions ariana grande.mp3", mood: "emotional", license: "operator-supplied — verify cleared" },
  "raindance-terms-and-dave": { label: "Raindance — Terms and Dave", file: "Raindance - Terms and Dave Lyrics.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "stereo-love": { label: "Stereo Love — Edward Maya & Vika Jigulina", file: "Stereo Love.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
  "sure-thing-miguel": { label: "Sure Thing — Miguel", file: "sure thing - miguel.mp3", mood: "emotional", license: "operator-supplied — verify cleared" },
  "sza-saturn": { label: "Saturn — SZA", file: "sza saturn.mp3", mood: "emotional", license: "operator-supplied — verify cleared" },
  "titanium": { label: "Titanium — David Guetta ft Sia", file: "titanium.mp3", mood: "hype", license: "operator-supplied — verify cleared" },
};

/** Join the env base with a filename, tolerating a trailing slash. Returns "" when no
 *  base is configured (caller treats that as "unavailable"). */
function joinBase(file: string): string {
  // Falls back to the app's Supabase project + bucket when the env var is unset, so
  // the pack resolves in every process rather than only where the var was set.
  const base = mediaPackBase("TRENDING_AUDIO_BASE_URL", "trending-audio");
  if (!base) return "";
  // Encode EACH path segment separately (not the whole `file` string in one shot) —
  // a folder track's `file` is "podcast/Some Name.mp3"; encoding the joined string
  // as one component would turn the "/" into "%2F", pointing at a literal filename
  // that doesn't exist instead of the podcast/ subfolder. Splitting first keeps the
  // "/" as a real path separator while still escaping spaces/punctuation per segment.
  const encodedPath = file.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/+$/, "")}/${encodedPath}`;
}

/** `file` is the bucket-root object name; a folder track (e.g. `folder: "podcast"`)
 *  lives at `<folder>/<file>` in the bucket, but TRACK_FILES entries store `file`
 *  WITHOUT that prefix — every folder track (10 of them, all "podcast") 404'd
 *  ("Object not found") because joinBase was called on the bare filename. */
function bucketPath(file: string, folder?: string): string {
  return folder ? `${folder}/${file}` : file;
}

/** Resolved URL for a track id, or "" if the id is unknown or the base env is unset. */
export function trendingAudioUrl(id: string): string {
  const entry = TRACK_FILES[id];
  if (!entry) return "";
  return joinBase(bucketPath(entry.file, entry.folder));
}

/** The full track list, each url resolved against TRENDING_AUDIO_BASE_URL (or ""). */
export const TRENDING_AUDIO: TrendingAudioEntry[] = Object.entries(TRACK_FILES).map(
  ([id, { label, file, mood, folder, instrumental }]) => ({
    id, label, mood, url: joinBase(bucketPath(file, folder)),
    ...(folder ? { folder } : {}), ...(instrumental ? { instrumental: true } : {}),
  }),
);

/** Stable list of track ids — the inspector picker values. */
export const TRENDING_AUDIO_IDS = Object.keys(TRACK_FILES);

/** Default track when none is picked (kept for callers / tests; "" on an empty pack). */
export const DEFAULT_TRENDING_AUDIO_ID = TRENDING_AUDIO_IDS[0] ?? "";

/** Whether a track id is one of the curated set. */
export const isTrendingAudioId = (id: unknown): id is string =>
  typeof id === "string" && id in TRACK_FILES;

/** PURE auto-pick: emotion → mood subset → seeded rotation within it. Falls back to the
 *  WHOLE library when no mood matches, so auto always adds music while the pack is
 *  loaded. Returns "" only when the pack is empty. No Math.random / Date.now.
 *
 *  `preferInstrumental` (Auto Music + dialogue-heavy clips — see
 *  clipEditPlanner's speech-density check): restricts the candidate pool to
 *  tracks with NO sung vocals first. A singing voice competing with the
 *  speaker's own voice is the exact "many voice sound" clash the operator
 *  wants avoided on a dialogue-dense clip. Falls back mood→instrumental-any→
 *  the whole library in that order, so instrumental preference NEVER results
 *  in silence — it only ever narrows the pool, same graceful-degrade shape as
 *  the mood fallback below it. */
export function pickTrendingTrackByMood(emotion: string | undefined, seed: number, preferInstrumental = false): string {
  const ids = TRENDING_AUDIO_IDS;
  if (!ids.length) return "";
  const e = (emotion ?? "").toLowerCase();
  const wantMood =
    /dance|party|club|banger|beat|drop|bounce|groove|workout|gym|sport|energy|epic|hype|insane|crazy|wtf|shock|controvers|surpris/.test(e) ? "hype"
      : /funny|fun|comed|laugh|meme|silly|awkward|prank|troll/.test(e) ? "funny"
        : /love|romance|romantic|date|couple|crush|heart/.test(e) ? "emotional"
          : /sad|emotion|tears|touching|heartfelt|inspir|wow|amaz|beautiful/.test(e) ? "emotional"
            : /calm|chill|relax|peace|sooth|tranquil|soft|ambient|lofi|sleep|study|focus/.test(e) ? "chill"
              : "";
  const instrumentalIds = preferInstrumental ? ids.filter((id) => TRACK_FILES[id].instrumental === true) : [];
  const moodPool = wantMood ? ids.filter((id) => TRACK_FILES[id].mood === wantMood) : [];
  const moodInstrumentalPool = wantMood && preferInstrumental ? moodPool.filter((id) => TRACK_FILES[id].instrumental === true) : [];
  // Priority: mood + instrumental > instrumental-any > mood-any > whole library.
  const use = moodInstrumentalPool.length ? moodInstrumentalPool
    : instrumentalIds.length ? instrumentalIds
      : moodPool.length ? moodPool
        : ids;
  const i = ((seed % use.length) + use.length) % use.length;
  return use[i];
}

/** clipJobs "wired-but-default" injection for clip.trendingaudio. Given the raw node
 *  config of a WIRED skill row, returns the music fields to merge into the planner
 *  skill: a picked track is kept as-is; a genuinely-wired-but-untouched node (no track,
 *  no explicit autoMusic) defaults to autoMusic:true so an accept-the-defaults node
 *  still adds a mood-matched bed (mirrors the Brain Rot bgId:"random" default). The
 *  upstream wired!==false filter keeps a stale/removed row from ever reaching here, so
 *  defaulting auto ON is leak-safe. Returns {} for any other skill. Pure. */
export function resolveWiredTrendingAudio(
  skillId: string,
  cfg: Record<string, unknown>,
): { musicTrackId?: string; autoMusic?: boolean; customAudioUrl?: string } {
  if (skillId !== "clip.trendingaudio") return {};
  const out: { musicTrackId?: string; autoMusic?: boolean; customAudioUrl?: string } = {};
  const hasCustom = typeof cfg.customAudioUrl === "string" && cfg.customAudioUrl.trim().length > 0;
  if (hasCustom) { out.customAudioUrl = (cfg.customAudioUrl as string).trim(); return out; }
  const hasTrack = typeof cfg.musicTrackId === "string" && cfg.musicTrackId.length > 0;
  if (hasTrack) out.musicTrackId = cfg.musicTrackId as string;
  if (typeof cfg.autoMusic === "boolean") out.autoMusic = cfg.autoMusic;
  else if (!hasTrack) out.autoMusic = true;
  return out;
}
