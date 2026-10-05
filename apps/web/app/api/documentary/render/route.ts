import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { callClaudeJSON } from "@/lib/server/kie-claude";
import { searchStockPhoto } from "@/lib/server/imageSearch";
import { searchStockVideo } from "@/lib/server/videoStockSearch";
import { crawlProductImageCandidates } from "@/lib/server/productImageCrawl";
import { synthesizeVoiceover } from "@/lib/server/elevenTts";
import { searchMoodMusic } from "@/lib/server/documentaryMusic";
import { resolveFfmpegPath } from "@/lib/server/ffmpegBin";
import { putVideo } from "@/lib/server/videoStorage";

// The Documentary worker: story plan → internet stock photos (keyless
// Openverse) + crawled product shots → ElevenLabs voiceover → ffmpeg Ken Burns
// slideshow with a ducked music bed. Deliberately LOW-RESOURCE: no AI image or
// video generation anywhere — every visual comes off the open internet.
export const runtime = "nodejs";
export const maxDuration = 300;

const execFileP = promisify(execFile);

interface Scene { narration: string; query: string; imageUrl?: string }

// Deterministic dark hue for the gradient-card fallback so consecutive
// fallback frames never render as the same color.
function hslToHex(hue: number): string {
  const s = 0.45, l = 0.14;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `0x${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseDuration(stderr: string): number {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function probeDurationSec(ffmpeg: string, path: string): Promise<number> {
  try {
    const r = await execFileP(ffmpeg, ["-hide_banner", "-i", path], { timeout: 20_000 });
    return parseDuration(String(r.stderr ?? ""));
  } catch (e) {
    return parseDuration(String((e as { stderr?: string })?.stderr ?? ""));
  }
}

async function fetchToFile(url: string, dest: string, timeoutMs = 20_000, maxBytes = 30_000_000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; VelloBot/1.0)" } });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000 || buf.length > maxBytes) return false;
    await writeFile(dest, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort page text for product grounding (same tag-strip approach the
// carousel ideate route uses).
async function fetchWebsiteText(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "";
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_CRON_SECRET ?? "";
  if (!secret || req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const id = body.id as Id<"documentaryProjects"> | undefined;
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return NextResponse.json({ ok: false, error: "Convex not configured" }, { status: 503 });
  const convex = new ConvexHttpClient(CONVEX_URL);
  const job = (await convex.query(api.documentaryProjects.get, { id })) as
    | { prompt: string; productUrl?: string; voiceId: string; musicMood: string; status: string; durationSec?: number }
    | null;
  if (!job) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (job.status !== "generating") return NextResponse.json({ ok: true, skipped: true });

  const patch = (p: Record<string, unknown>) =>
    convex.mutation(api.documentaryProjects.patch, { id, authSecret: secret, ...p }).catch(() => {});
  const fail = async (message: string) => {
    await patch({ status: "failed", error: message, statusMessage: `Failed: ${message.slice(0, 160)}` });
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  };

  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) return fail("ffmpeg unavailable");
  const dir = await mkdtemp(join(tmpdir(), "vello-doc-"));

  try {
    // ── 1. Product grounding (optional) ──────────────────────────────────────
    let productText = "";
    let productImages: string[] = [];
    if (job.productUrl) {
      await patch({ statusMessage: "Studying your product link…" });
      [productText, productImages] = await Promise.all([
        fetchWebsiteText(job.productUrl),
        crawlProductImageCandidates(job.productUrl, 4).catch(() => [] as string[]),
      ]);
    }

    // ── 2. Story plan ────────────────────────────────────────────────────────
    // Scene count scales with the requested duration so b-roll frequency keeps
    // pace with runtime instead of staying fixed at 6 regardless of length —
    // roughly one fresh visual every ~9s of spoken narration.
    const durationSec = Math.min(180, Math.max(20, job.durationSec ?? 60));
    const sceneCount = Math.min(18, Math.max(4, Math.round(durationSec / 9)));
    await patch({ statusMessage: "Writing the story…" });
    const plan = await callClaudeJSON<{ title?: string; scenes?: Scene[] }>({
      system: `You are an award-winning documentary writer. Turn the user's idea into a documentary narration of roughly ${durationSec} seconds spoken, split into exactly ${sceneCount} scenes. Each scene: "narration" — 1-2 spoken sentences in a warm documentary-narrator voice that flow seamlessly from the previous scene and advance the story (never restate the previous scene), and "query" — a 2-4 word STOCK-FOOTAGE search phrase of a CONCRETE, visually generic subject that stock video/photo libraries actually have (places, objects, nature, people doing things — never brand names or abstract concepts).

STORY (critical): build a real emotional arc across all ${sceneCount} scenes — a hook that poses a question or tension in the first scene, context, development, a turn (surprise, obstacle, or shift in perspective), resolution, and a closing thought that answers the opening hook. Use specific, sensory detail over generalities; one concrete image beats three adjectives. Each scene must move the story forward to a NEW beat — never pad with a scene that just restates the previous one.

B-ROLL VARIETY (critical): every scene's "query" must depict a DIFFERENT concrete subject than every other scene — vary location, subject matter, and shot type (wide establishing shots, close-ups, hands, faces, objects, landscapes) so the footage visually follows the story beat by beat instead of looping the same kind of shot. Never reuse the same query or a near-synonym of one already used in another scene.

DELIVERY / INTONATION (critical — this text is read aloud by a TTS narrator): write for the EAR. Short sentences. Vary rhythm — follow a long sentence with a three-word one. Use punctuation to shape the read: em dashes for suspended beats, ellipses for a trailing thought, a question for the hook. Never write bullet-ish or listy prose; it must sound like a person telling a story.${productText ? "\n\nGround the story in the REAL product described in the context — what it is, who it's for, why it matters — like a mini brand documentary." : ""} Respond ONLY with JSON: {"title": string, "scenes": [{"narration": string, "query": string}]}.`,
      user: `Idea: ${job.prompt}${productText ? `\n\nProduct/page context (crawled):\n${productText}` : ""}`,
      maxTokens: 400 + sceneCount * 120,
    });
    const scenes = (plan.scenes ?? []).filter((s) => s?.narration?.trim() && s?.query?.trim()).slice(0, sceneCount + 2);
    if (scenes.length < 3) return await fail("Story generation produced too few scenes");
    const title = (plan.title ?? "").trim() || job.prompt.slice(0, 60);
    const script = scenes.map((s) => s.narration.trim()).join(" ");
    await patch({ title, script, scenes: JSON.stringify(scenes), statusMessage: "Finding real footage & photos…" });

    // ── 3. Visuals — REAL stock b-roll video first (Pexels/Pixabay when a key
    //      is configured), then stock photos + crawled product shots ──────────
    type SceneMedia = { path: string; isVideo: boolean };
    const media: SceneMedia[] = [];
    // Every accepted asset's URL goes here so a later scene never silently
    // repeats an earlier one — this is what makes b-roll follow the story
    // instead of looping the same shot.
    const usedUrls = new Set<string>();
    // Evergreen, always-stocked subjects to cycle through as a last resort —
    // rotated by scene index so back-to-back fallbacks still look different
    // from each other instead of converging on one generic shot.
    const EVERGREEN_QUERIES = [
      "city street people", "nature landscape", "ocean waves", "forest trees",
      "sunset sky", "office workspace", "hands working", "mountain view",
      "busy market", "quiet countryside", "urban architecture", "flowing river",
    ];
    for (let i = 0; i < scenes.length; i++) {
      let saved = false;
      // Best case: real footage matching the scene. The provider chain is
      // Pexels/Pixabay (keys) → Wikimedia Commons (keyless), so this is always
      // worth trying — plenty of real video exists online for generic queries.
      {
        const hit = await searchStockVideo(scenes[i].query).catch(() => null);
        if (hit && !usedUrls.has(hit.url)) {
          const ext = /\.(webm|ogv)(\?|#|$)/i.exec(hit.url)?.[1]?.toLowerCase() ?? "mp4";
          const p = join(dir, `clip${i}.${ext}`);
          if (await fetchToFile(hit.url, p, 35_000, 80_000_000)) {
            media.push({ path: p, isVideo: true });
            scenes[i].imageUrl = hit.url;
            usedUrls.add(hit.url);
            saved = true;
          }
        }
      }
      // Product images (when crawled) carry the middle scenes; everything else
      // comes from the stock-photo chain (Pexels → Openverse → Wikimedia).
      if (!saved) {
        const productSlot = productImages.length > 0 && i >= 2 && i - 2 < productImages.length;
        const candidates = productSlot
          ? [productImages[i - 2], null]
          : [await searchStockPhoto(scenes[i].query).catch(() => null)];
        for (const url of candidates) {
          if (!url || usedUrls.has(url)) continue;
          const p = join(dir, `img${i}`);
          if (await fetchToFile(url, p)) {
            media.push({ path: p, isVideo: false });
            scenes[i].imageUrl = url;
            usedUrls.add(url);
            saved = true;
            break;
          }
        }
      }
      if (!saved) {
        // Widen the net: single keyword, then narration keywords, then the
        // rotating evergreen pool — the story must never die over one
        // unmatchable query, and a duplicate hit is skipped rather than reused.
        const broadeners = [
          scenes[i].query.split(/\s+/)[0],
          scenes[i].narration.split(/\s+/).filter((w) => w.length > 5).slice(0, 2).join(" "),
          EVERGREEN_QUERIES[i % EVERGREEN_QUERIES.length],
          EVERGREEN_QUERIES[(i + 5) % EVERGREEN_QUERIES.length],
        ].filter(Boolean);
        for (const q of broadeners) {
          const alt = await searchStockPhoto(q).catch(() => null);
          if (!alt || usedUrls.has(alt)) continue;
          const p = join(dir, `img${i}`);
          if (await fetchToFile(alt, p)) {
            media.push({ path: p, isVideo: false });
            scenes[i].imageUrl = alt;
            usedUrls.add(alt);
            saved = true;
            break;
          }
        }
      }
      if (!saved) {
        // ABSOLUTE last resort (every provider down or exhausted): render a
        // slow-moving gradient card whose hue shifts by scene index, so the
        // timeline never silently repeats a prior frame even when it has to
        // fall back to a generated placeholder.
        const hue = (i * 47) % 360;
        const p = join(dir, `img${i}.png`);
        await execFileP(ffmpeg, [
          "-y", "-f", "lavfi",
          "-i", `gradients=s=1080x1920:c0=0x0b0b10:c1=${hslToHex(hue)}:type=linear`,
          "-frames:v", "1", p,
        ], { timeout: 30_000 }).catch(() => {});
        try {
          await stat(p);
          media.push({ path: p, isVideo: false });
        } catch {
          return await fail("Could not find any usable stock imagery for the story");
        }
      }
      await patch({ scenes: JSON.stringify(scenes), statusMessage: `Found visuals ${i + 1}/${scenes.length}…` });
    }

    // ── 4. Voiceover (ElevenLabs) ────────────────────────────────────────────
    await patch({ statusMessage: "Recording the narrator…" });
    const voPath = join(dir, "vo.mp3");
    // A short breath between scenes — multilingual_v2 honors <break/> tags, and
    // the pause is what makes the read land as narration instead of a run-on.
    const ttsText = scenes.map((s) => s.narration.trim()).join(' <break time="0.45s" /> ');
    await writeFile(voPath, await synthesizeVoiceover({ text: ttsText, voiceId: job.voiceId }));
    const voSec = await probeDurationSec(ffmpeg, voPath);
    if (voSec <= 1) return await fail("Voiceover synthesis produced no audio");

    // ── 5. Music bed (optional, best-effort) ─────────────────────────────────
    await patch({ statusMessage: "Laying the soundtrack…" });
    let musicPath: string | null = null;
    const musicUrl = await searchMoodMusic(job.musicMood).catch(() => null);
    if (musicUrl) {
      const p = join(dir, "music");
      if (await fetchToFile(p ? musicUrl : musicUrl, p, 25_000)) musicPath = p;
    }

    // ── 6. Assemble — Ken Burns slideshow timed to the narration ─────────────
    await patch({ statusMessage: "Assembling the documentary…" });
    // Scene lengths proportional to narration text share of the total.
    const chars = scenes.map((s) => Math.max(20, s.narration.length));
    const totalChars = chars.reduce((a, b) => a + b, 0);
    const secs = chars.map((c) => Math.max(2.5, (c / totalChars) * voSec));
    const FPS = 25;
    const W = 1080, H = 1920;
    const inputs: string[] = [];
    const filters: string[] = [];
    media.forEach((m, i) => {
      if (m.isVideo) {
        // Real b-roll: loop if the clip is shorter than the scene, trim to the
        // scene length, fill the 9:16 frame. Clip audio is never mapped.
        inputs.push("-stream_loop", "-1", "-t", secs[i].toFixed(2), "-i", m.path);
        filters.push(
          `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
          `fps=${FPS},trim=duration=${secs[i].toFixed(2)},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${i}]`,
        );
      } else {
        inputs.push("-loop", "1", "-t", secs[i].toFixed(2), "-i", m.path);
        const frames = Math.max(2, Math.round(secs[i] * FPS));
        // Slow push-in Ken Burns; scale up first so zoompan has pixels to move.
        filters.push(
          `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
          `zoompan=z='min(zoom+0.0009,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},` +
          `format=yuv420p,setsar=1[v${i}]`,
        );
      }
    });
    const concat = media.map((_, i) => `[v${i}]`).join("") + `concat=n=${media.length}:v=1:a=0[vout]`;
    const voIdx = media.length;
    const musIdx = voIdx + 1;
    const audioFilter = musicPath
      ? `[${musIdx}:a]volume=0.14,aloop=loop=-1:size=2e9[mus];[${voIdx}:a][mus]amix=inputs=2:duration=first:dropout_transition=2[aout]`
      : `[${voIdx}:a]anull[aout]`;
    const out = join(dir, "out.mp4");
    const args = [
      "-y",
      ...inputs,
      "-i", voPath,
      ...(musicPath ? ["-i", musicPath] : []),
      "-filter_complex", `${filters.join(";")};${concat};${audioFilter}`,
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-t", String(voSec + 1.2),
      "-movflags", "+faststart",
      out,
    ];
    await execFileP(ffmpeg, args, { timeout: 200_000, maxBuffer: 8 * 1024 * 1024 });
    const { size } = await stat(out);
    if (size < 50_000) return await fail("Render produced an empty video");

    // ── 7. Host the result (R2, Convex fallback) ─────────────────────────────
    await patch({ statusMessage: "Uploading your documentary…" });
    const { url: videoUrl } = await putVideo(await readFile(out), { keyPrefix: "videos" });

    await patch({ status: "ready", videoUrl, statusMessage: "Documentary ready." });
    return NextResponse.json({ ok: true, videoUrl });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "documentary render failed");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
